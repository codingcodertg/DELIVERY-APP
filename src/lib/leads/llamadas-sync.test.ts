import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_PAGINAS, sincronizarLlamadasDeLeads, TAMANO_PAGINA, VENTANA_MS } from "./llamadas-sync";

// ============================================================
// D-1130: el primer barrido (un mes de llamadas de TODA la empresa) no terminaba nunca: se pedían hasta 30 páginas de 100
// contra un límite de 10 peticiones por minuto y, al primer 429, se tiraba todo lo leído. Estas pruebas fijan el arreglo:
// ventanas de una semana, presupuesto de peticiones, y el cursor avanza con cada ventana terminada.
// ============================================================

const AHORA = new Date("2026-11-22T21:40:00Z");
const TELEFONO = "+19565550100";

type Estado = { cursor_at: string | null; last_run_at: string | null; last_error_code: string | null } | null;

/** Una base de mentira: lo justo que usa el sincronizador. Guarda el estado y las filas que le escriben. */
function baseFalsa(estado: Estado, cola = 0) {
  const guardado = { estado, filas: [] as { rc_call_id: string }[] };
  const from = (tabla: string) => {
    const q: { op: string; payload?: unknown; cuenta?: boolean } = { op: "select" };
    const resuelve = () => {
      if (tabla === "rc_lead_sync_state") {
        if (q.op === "upsert") { guardado.estado = q.payload as Estado; return { error: null }; }
        return { data: guardado.estado, error: null };
      }
      if (tabla === "leads") return { data: [{ owner_phone: TELEFONO, owner_phone_manual: null, tenant_phone: null, tenant_phone_manual: null }], error: null };
      if (tabla === "rc_lead_calls") {
        if (q.op === "upsert") { guardado.filas.push(...(q.payload as { rc_call_id: string }[])); return { error: null }; }
        return q.cuenta ? { count: cola, error: null } : { data: [], error: null };
      }
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = new Proxy({}, {
      get(_, prop: string) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(resuelve()).then(ok);
        return (...args: unknown[]) => {
          if (prop === "upsert" || prop === "update") { q.op = prop; q.payload = args[0]; }
          if (prop === "select" && (args[1] as { head?: boolean } | undefined)?.head) q.cuenta = true;
          return b;
        };
      },
    });
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, guardado };
}

/** RingCentral de mentira: cada petición de listado devuelve `porPagina` llamadas del teléfono del lead; `falla429En` corta. */
function ringcentralFalso(opciones: { porVentana?: number; falla429En?: number } = {}) {
  const pedidas: { desde: string; hasta: string; pagina: number; perPage: number }[] = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
    n++;
    if (opciones.falla429En === n) return new Response("{}", { status: 429 });
    const pagina = Number(u.searchParams.get("page"));
    pedidas.push({ desde: u.searchParams.get("dateFrom")!, hasta: u.searchParams.get("dateTo")!, pagina, perPage: Number(u.searchParams.get("perPage")) });
    const total = opciones.porVentana ?? 1;
    const yaDadas = (pagina - 1) * TAMANO_PAGINA;
    const cuantas = Math.max(0, Math.min(TAMANO_PAGINA, total - yaDadas));
    const records = Array.from({ length: cuantas }, (_, i) => ({ id: `${u.searchParams.get("dateFrom")}-${yaDadas + i}`, startTime: u.searchParams.get("dateFrom"), direction: "Outbound", to: { phoneNumber: TELEFONO }, from: { extensionNumber: "101" } }));
    return new Response(JSON.stringify({ records, navigation: yaDadas + cuantas < total ? { nextPage: {} } : {} }), { status: 200 });
  }));
  return pedidas;
}

const credenciales = { clientId: "a", clientSecret: "b", jwt: "c" };
afterEach(() => vi.unstubAllGlobals());

describe("barrido de llamadas de leads sin pasarse del límite de RingCentral (D-1130)", () => {
  it("la primera vez recorre el mes por semanas, con páginas de 1000, y deja el cursor en «ahora»", async () => {
    const pedidas = ringcentralFalso();
    const { db, guardado } = baseFalsa(null);
    const r = await sincronizarLlamadasDeLeads({ db, credenciales, ahora: AHORA, server: "https://rc.test" });
    expect(r).toMatchObject({ ok: true, llamadas: 5 });
    expect(pedidas).toHaveLength(5); // 30 días = 4 semanas y 2 días
    expect(pedidas.every((p) => p.perPage === TAMANO_PAGINA && p.pagina === 1)).toBe(true);
    expect(Date.parse(pedidas[0].hasta) - Date.parse(pedidas[0].desde)).toBe(VENTANA_MS);
    expect(pedidas[1].desde).toBe(pedidas[0].hasta); // sin huecos entre ventanas
    expect(guardado.estado).toMatchObject({ cursor_at: AHORA.toISOString(), last_error_code: null });
    expect(pedidas.length).toBeLessThanOrEqual(MAX_PAGINAS);
  });

  it("un 429 a medias NO tira lo ya leído: guarda las ventanas terminadas y el cursor queda donde se cortó", async () => {
    const pedidas = ringcentralFalso({ falla429En: 3 });
    const { db, guardado } = baseFalsa(null);
    const r = await sincronizarLlamadasDeLeads({ db, credenciales, ahora: AHORA, server: "https://rc.test" });
    expect(r).toMatchObject({ ok: false, motivo: "limite", llamadas: 2 });
    expect(guardado.filas).toHaveLength(2);
    expect(guardado.estado).toMatchObject({ cursor_at: pedidas[1].hasta, last_error_code: "limite" });
  });

  it("si una ventana pide más páginas que el presupuesto, corta sin error y la siguiente corrida sigue donde se quedó", async () => {
    ringcentralFalso({ porVentana: TAMANO_PAGINA * 4 }); // cada semana, 4 páginas: el presupuesto alcanza para una y media
    const { db, guardado } = baseFalsa(null);
    const r = await sincronizarLlamadasDeLeads({ db, credenciales, ahora: AHORA, server: "https://rc.test" });
    expect(r).toMatchObject({ ok: false, motivo: "listado" });
    const trasLaPrimera = guardado.estado!.cursor_at!;
    expect(Date.parse(trasLaPrimera)).toBe(AHORA.getTime() - 30 * 86_400_000 + VENTANA_MS); // la primera semana quedó hecha
    // Diez minutos después: aunque no han pasado 2 horas, sigue porque falta ponerse al día.
    const luego = new Date(AHORA.getTime() + 10 * 60_000);
    const r2 = await sincronizarLlamadasDeLeads({ db, credenciales, ahora: luego, server: "https://rc.test" });
    expect(r2).not.toBeNull();
    expect(Date.parse(guardado.estado!.cursor_at!)).toBeGreaterThan(Date.parse(trasLaPrimera));
  });

  it("al día y sin que toque (menos de 2 horas), no barre", async () => {
    const pedidas = ringcentralFalso();
    const hace10 = new Date(AHORA.getTime() - 10 * 60_000).toISOString();
    const { db } = baseFalsa({ cursor_at: hace10, last_run_at: hace10, last_error_code: null });
    expect(await sincronizarLlamadasDeLeads({ db, credenciales, ahora: AHORA, server: "https://rc.test" })).toBeNull();
    expect(pedidas).toHaveLength(0);
  });

  it("al día pero con grabaciones en cola: no barre, pero sí entra a bajarlas (D-1131)", async () => {
    const pedidas = ringcentralFalso();
    const hace10 = new Date(AHORA.getTime() - 10 * 60_000).toISOString();
    const { db, guardado } = baseFalsa({ cursor_at: hace10, last_run_at: hace10, last_error_code: null }, 3);
    const r = await sincronizarLlamadasDeLeads({ db, credenciales, ahora: AHORA, server: "https://rc.test" });
    expect(r).toMatchObject({ ok: true, llamadas: 0, pendientes: 3 });
    expect(pedidas).toHaveLength(0); // ningún listado
    expect(guardado.estado).toMatchObject({ last_run_at: hace10 }); // el estado del barrido no se toca
  });
});
