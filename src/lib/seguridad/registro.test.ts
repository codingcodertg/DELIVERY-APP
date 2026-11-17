import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { construyeFila, ipSegura, registraEvento, registraSesionActiva, hashUa } from "./registro";

type Consulta = Record<string, unknown>;

// Cliente falso: anota los inserts y responde a las lecturas de sec_events y profiles que usa el registro.
function clienteFalso(opts: { insertError?: { message: string } | null; lanza?: boolean; ultima?: { ts: string; ip_pais: string | null }[]; rol?: string } = {}) {
  const inserts: { tabla: string; fila: Record<string, unknown> }[] = [];
  const from = (tabla: string) => {
    const consulta: Consulta = {};
    const self = () => consulta;
    Object.assign(consulta, {
      insert(fila: Record<string, unknown>) {
        if (opts.lanza) throw new Error("boom");
        inserts.push({ tabla, fila });
        return Promise.resolve({ error: opts.insertError ?? null });
      },
      select: self,
      eq: self,
      order: self,
      limit: async () => ({ data: opts.ultima ?? [] }),
      maybeSingle: async () => ({ data: { role: opts.rol ?? "driver" } }),
    });
    return consulta;
  };
  return { cliente: { from } as unknown as SupabaseClient, inserts };
}

function cab(valores: Record<string, string>): Headers {
  return new Headers(valores);
}

const USUARIO = "11111111-1111-4111-8111-111111111111";
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  errorSpy.mockRestore();
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("construyeFila", () => {
  it("saca la IP y el país de las cabeceras de Vercel, y hashea el agente", () => {
    const f = construyeFila({ categoria: "auth", cabeceras: cab({ "x-vercel-forwarded-for": "8.8.8.8", "x-vercel-ip-country": "us", "user-agent": "Mozilla/5.0" }) });
    expect(f.ip).toBe("8.8.8.8");
    expect(f.ip_pais).toBe("US");
    expect(f.ua_hash).toBe(hashUa("Mozilla/5.0"));
    expect(String(f.ua_hash)).toHaveLength(16);
  });

  it("nunca manda a la columna inet algo que no sea una IP (el marcador ip-desconocida)", () => {
    expect(construyeFila({ categoria: "auth", ip: "ip-desconocida" }).ip).toBeNull();
    expect(ipSegura("2001:db8::1")).toBe("2001:db8::1");
  });

  it("un usuario que no es un uuid se deja en null, no rompe el insert", () => {
    expect(construyeFila({ categoria: "admin", usuario_id: "no-es-uuid" }).usuario_id).toBeNull();
  });

  it("acota la severidad a 1..5 y los textos largos", () => {
    const f = construyeFila({ categoria: "api_denied", severidad: 9, ruta: "x".repeat(500) });
    expect(f.severidad).toBe(5);
    expect(String(f.ruta)).toHaveLength(200);
  });
});

describe("registraEvento", () => {
  it("escribe la fila en sec_events y devuelve true", async () => {
    const { cliente, inserts } = clienteFalso();
    const ok = await registraEvento({ categoria: "ratelimit", ip: "1.2.3.4" }, { cliente: () => cliente });
    expect(ok).toBe(true);
    expect(inserts[0]).toMatchObject({ tabla: "sec_events", fila: { categoria: "ratelimit", ip: "1.2.3.4" } });
  });

  it("nunca lanza: si la base lanza o rechaza, devuelve false", async () => {
    const lanza = clienteFalso({ lanza: true });
    await expect(registraEvento({ categoria: "auth" }, { cliente: () => lanza.cliente })).resolves.toBe(false);
    const rechaza = clienteFalso({ insertError: { message: "permiso" } });
    await expect(registraEvento({ categoria: "auth" }, { cliente: () => rechaza.cliente })).resolves.toBe(false);
  });

  it("sin llave de servicio en el entorno, tampoco lanza", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(registraEvento({ categoria: "cron" })).resolves.toBe(false);
  });
});

describe("registraSesionActiva: escribe poco", () => {
  const cabeceras = cab({ "x-vercel-forwarded-for": "9.9.9.9", "x-vercel-ip-country": "MX" });

  it("escribe si nunca hubo sesión registrada, con el rol de la persona", async () => {
    const { cliente, inserts } = clienteFalso({ ultima: [], rol: "admin" });
    expect(await registraSesionActiva({ usuario_id: USUARIO, cabeceras }, { cliente: () => cliente })).toBe(true);
    expect(inserts[0].fila).toMatchObject({ categoria: "auth", metodo: "sesion", rol: "admin", ip_pais: "MX" });
  });

  it("no escribe si la última sesión es del mismo país y de hace menos de una hora", async () => {
    const reciente = new Date(Date.now() - 10 * 60_000).toISOString();
    const { cliente, inserts } = clienteFalso({ ultima: [{ ts: reciente, ip_pais: "MX" }] });
    expect(await registraSesionActiva({ usuario_id: USUARIO, cabeceras }, { cliente: () => cliente })).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("escribe si cambió el país aunque la sesión anterior sea reciente", async () => {
    const reciente = new Date(Date.now() - 5 * 60_000).toISOString();
    const { cliente, inserts } = clienteFalso({ ultima: [{ ts: reciente, ip_pais: "US" }] });
    expect(await registraSesionActiva({ usuario_id: USUARIO, cabeceras }, { cliente: () => cliente })).toBe(true);
    expect(inserts).toHaveLength(1);
  });

  it("nunca lanza aunque la lectura reviente", async () => {
    const roto = { from: () => { throw new Error("red"); } } as unknown as SupabaseClient;
    await expect(registraSesionActiva({ usuario_id: USUARIO, cabeceras }, { cliente: () => roto })).resolves.toBe(false);
  });
});
