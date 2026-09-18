import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { misParadas, type ParadaMia } from "./mis-paradas";

/** El chofer lee SUS paradas del plan publicado (D-NEXT): la función pura, la ruta, la pantalla y la 134. */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

const fila = (seq: number, kind: "P" | "D", order_ref: string, load_after: number | string, extra: Partial<ParadaMia> = {}): ParadaMia => ({
  plan_version: 3, published_at: "2026-03-04T12:00:00.123456+00:00", seq, kind, delivery_id: order_ref.split("#")[0], order_ref, label: `${kind}${seq}`, place: null,
  window_start: null, window_end: null, is_hard: false, eta: 480 + seq * 20, etd: 490 + seq * 20, load_after, ...extra,
});

describe("de lo que devuelve la base a lo que pinta «Mi ruta»", () => {
  it("sin filas no hay plan", () => {
    expect(misParadas([])).toBeNull();
  });

  it("en orden de `seq` lleguen como lleguen, con el viaje y los pallets a bordo — los `numeric` pueden venir como texto", () => {
    const plan = misParadas([fila(3, "D", "b", "0"), fila(0, "P", "a", "2.50"), fila(2, "P", "b", 4, { place: "Tienda Norte" }), fila(1, "D", "a", 0, { window_start: 510, window_end: 600, is_hard: true })])!;
    expect(plan.paradas.map((p) => [p.seq, p.kind, p.order_ref, p.aBordoAlLlegar, p.load_after, p.viaje])).toEqual([
      [0, "P", "a", 0, 2.5, 1], [1, "D", "a", 2.5, 0, 1], [2, "P", "b", 0, 4, 2], [3, "D", "b", 4, 0, 2],
    ]);
    expect([plan.version, plan.publishedAt, plan.entregas, plan.viajes, plan.inicio, plan.fin]).toEqual([3, "2026-03-04T12:00:00.123456+00:00", 2, 2, 480, 550]);
    expect(plan.paradas[1]).toMatchObject({ window_start: 510, window_end: 600, is_hard: true, eta: 500, etd: 510 });
    expect(plan.paradas[2].place).toBe("Tienda Norte");
  });

  it("lo que se le da al chofer NO lleva minutos tarde, espera ni tramos: son horas sin contrastar", () => {
    const plan = misParadas([fila(0, "P", "a", 1), fila(1, "D", "a", 0)])!;
    expect(Object.keys(plan.paradas[0]).sort()).toEqual(["aBordoAlLlegar", "delivery_id", "eta", "etd", "is_hard", "kind", "label", "load_after", "order_ref", "place", "seq", "viaje", "window_end", "window_start"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
const falso = vi.hoisted(() => ({
  sesion: true,
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
  tablas: [] as string[],
  respuesta: { data: [] as unknown, error: null as { code?: string; message: string } | null },
}));
vi.mock("@/lib/api-auth", () => ({
  requireUser: async () => (falso.sesion ? {
    ok: true, user: { id: "chofer-a" },
    supabase: {
      from: (tabla: string) => { falso.tablas.push(tabla); throw new Error("esta ruta no lee tablas"); },
      rpc: async (fn: string, args: Record<string, unknown>) => { falso.rpc.push({ fn, args }); return falso.respuesta; },
    },
  } : { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) }),
}));
import { GET } from "@/app/api/route-plan/mine/route";

const pide = (q: string) => GET(new Request(`http://localhost/api/route-plan/mine${q}`));
beforeEach(() => { falso.sesion = true; falso.rpc = []; falso.tablas = []; falso.respuesta = { data: [], error: null }; });

describe("/api/route-plan/mine", () => {
  it("sin sesión, 401; sin fecha válida, 400 — y en ninguno se llama a la base", async () => {
    falso.sesion = false;
    expect((await pide("?date=2026-03-04")).status).toBe(401);
    falso.sesion = true;
    expect((await pide("")).status).toBe(400);
    expect((await pide("?date=hoy")).status).toBe(400);
    expect(falso.rpc).toEqual([]);
  });

  it("llama a `my_published_stops` SOLO con la fecha: no hay parámetro de chofer que mandar", async () => {
    falso.respuesta = { data: [fila(0, "P", "a", 1), fila(1, "D", "a", 0)], error: null };
    const res = await pide("?date=2026-03-04&driver=otro-chofer&driver_id=otro");
    expect(falso.rpc).toEqual([{ fn: "my_published_stops", args: { p_date: "2026-03-04" } }]);
    expect(falso.tablas).toEqual([]);
    const b = await res.json();
    expect([res.status, b.ok, b.plan.paradas.length, b.plan.version]).toEqual([200, true, 2, 3]);
  });

  it("sin plan publicado: `plan: null`, no un error", async () => {
    const b = await (await pide("?date=2026-03-04")).json();
    expect(b).toEqual({ ok: true, plan: null });
  });

  it("si la 134 aún no está (PGRST202) se contesta «sin plan»; cualquier OTRO error es un 500 y se dice", async () => {
    falso.respuesta = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    expect(await (await pide("?date=2026-03-04")).json()).toEqual({ ok: true, plan: null, sinFuncion: true });
    falso.respuesta = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const res = await pide("?date=2026-03-04");
    expect([res.status, (await res.json()).detail]).toEqual([500, "canceling statement due to statement timeout"]);
  });

  it("la ruta no usa la llave de servicio, no lee tablas y no escribe", () => {
    const ruta = sinComentarios(leer("src/app/api/route-plan/mine/route.ts"));
    expect(ruta).not.toMatch(/createAdminClient|admin\s*\.|\.from\(|\.(insert|update|delete|upsert)\(/);
  });
});

describe("la pantalla: horas ESTIMADAS, y nada de retrasos en rojo", () => {
  const vista = sinComentarios(leer("src/components/MiPlanPublicado.tsx"));
  it("cada hora va con «≈» y dice «estimado»; no hay minutos tarde, ni rojo, ni nada que tocar", () => {
    expect(plano(vista)).toContain("≈ {horaDeReloj(p.eta)}");
    expect(plano(vista)).toContain('({t("estimated", "estimado")})');
    expect(vista).toContain("Las horas son estimaciones del plan, no promesas.");
    expect(vista).not.toMatch(/late|tarde|var\(--red\)|wait_min|late_min/);
    expect(vista).not.toMatch(/method:|PATCH|POST|supabase|updateDelivery|setStage/);
  });
  it("sin plan no pinta nada", () => {
    expect(plano(vista)).toContain("if (!plan) return null;");
  });
});

describe("134: la base dice lo mismo", () => {
  const sql = leer("supabase/migrations/134_my_published_stops.sql");
  const e = plano(sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n"));
  const funcion = e.slice(e.indexOf("create or replace function public.my_published_stops("), e.indexOf("revoke execute on function public.my_published_stops"));

  it("una función y NADA más: ni políticas, ni grants de tabla, ni tablas tocadas", () => {
    expect(e).not.toMatch(/create policy|drop policy|alter table|create table|grant (select|insert|update|delete|all)/i);
    expect([...e.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1])).toEqual(["my_published_stops"]);
  });

  it("security definer CON search_path fijo; filtra por quien llama DENTRO, exige sesión, y solo lo publicado de esa fecha", () => {
    expect(funcion).toContain("language sql stable security definer set search_path = public as $$");
    const donde = funcion.slice(funcion.indexOf(" where "), funcion.indexOf(" order by "));
    expect(donde.replace(/^ where /, "").split(" and ").map((c) => c.trim()).sort()).toEqual([
      "(select auth.uid()) is not null", "p.plan_date = p_date", "p.status = 'published'", "s.driver_id = (select auth.uid())",
    ]);
    // El único parámetro es la fecha: no hay forma de pedir las paradas de otro.
    expect(funcion).toContain("my_published_stops(p_date date) returns table");
  });

  it("devuelve EXACTAMENTE las columnas que espera el código, y ninguna que abra el día entero", () => {
    const columnas = [...funcion.slice(funcion.indexOf("returns table ("), funcion.indexOf(") language sql")).matchAll(/(\w+) (integer|timestamptz|text|uuid|boolean|numeric)/g)].map((m) => m[1]);
    const delCodigo = Object.keys(fila(0, "P", "a", 0));
    expect([...columnas].sort()).toEqual([...delCodigo].sort());
    expect(columnas.filter((c) => /^(input|writes|result|params|driver_id|driver_name|lat|lng|late_min|wait_min)$/.test(c))).toEqual([]);
  });

  it("anon fuera, authenticated dentro; sin transacción propia, con autocomprobación, ensayo, ledger y sin el marcador", () => {
    expect(e).toContain("revoke execute on function public.my_published_stops(date) from public, anon;");
    expect(e).toContain("grant execute on function public.my_published_stops(date) to authenticated;");
    expect(e.indexOf("revoke execute")).toBeLessThan(e.indexOf("grant execute"));
    expect(e).not.toMatch(/(^|[\s;])(begin|commit)\s*;/i);
    expect(sql).toContain("debe ser security definer");
    expect(sql).toContain("debe fijar search_path");
    expect(sql).toContain("anon no debe poder ejecutar");
    expect(sql).toContain("MENOS que `total`");
    expect(sql).toMatch(/-- @ledger-below\ninsert into public\.schema_migrations \(name, checksum\)\n {2}values \('134_my_published_stops\.sql', '[0-9a-f]{64}'\)/);
  });
});
