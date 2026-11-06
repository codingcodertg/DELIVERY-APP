import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `/api/driver-reports` y el cron del rastro (D-NEXT): quién entra.
 *
 * Supabase y TrackSolid son falsos: aquí no hay red. Lo que se guarda es la puerta —sin sesión 401, sin rol 403, sin
 * rango 400— y que a quien no pasa NO se le llega a crear el cliente de servicio ni a preguntar nada a TrackSolid.
 */

let usuario: { id: string } | null = null;
let perfil: Record<string, unknown> | null = null;
let errorDePerfil: { message: string } | null = null;
const tablasConSesion: string[] = [], tablasDeServicio: string[] = [];

const CHOFER = "9db2d07a-804d-4ac3-a19a-93cec7090270";
const ORDEN = {
  id: "o1", order_code: "FW1", order_type: "Customer", store: "RDZ Pharr", account: "Casa", pickup_name: "RDZ Pharr", delivery_name: "Casa", assigned_driver: "Ana", delivery_date: "2026-11-05", stage: "delivered",
  route_seq: 1, delivery_windows: "0830-1730", pickup_duration: "10", delivery_duration: "15", delivery_lat: 26.25, delivery_lng: -98.2, pickup_point_lat: null, pickup_point_lng: null,
  pickup_lat: null, pickup_lng: null, pod_lat: null, pod_lng: null, pickup_gps_at: null, pod_delivered_at: "2026-11-05T16:00:00Z", is_training: false,
};

function base(apuntaEn: string[], filas: Record<string, unknown>) {
  const consulta = (tabla: string) => {
    apuntaEn.push(tabla);
    const fin = async () => ({ data: filas[tabla] ?? [], error: null });
    const q: Record<string, unknown> = {};
    const mismo = () => q;
    Object.assign(q, {
      select: mismo, eq: mismo, neq: mismo, in: mismo, not: mismo, gte: mismo, lte: mismo, lt: mismo, order: mismo, limit: mismo, range: mismo, or: mismo, update: mismo,
      maybeSingle: async () => (tabla === "profiles" ? { data: perfil, error: errorDePerfil } : { data: (filas[tabla] as unknown[] | undefined)?.[0] ?? filas[`${tabla}:una`] ?? null, error: null }),
      upsert: async () => ({ error: null }),
      then: (ok: (v: unknown) => unknown) => fin().then(ok),
    });
    return q;
  };
  return { from: consulta };
}

const FILAS = {
  "settings:una": { stores: [{ name: "RDZ Pharr", lat: 26.2041, lng: -98.1686 }], order_type_rules: {} },
  profiles: [{ id: CHOFER, full_name: "Ana" }],
  deliveries: [ORDEN],
  order_events: [{ delivery_id: "o1", kind: "delivered", created_by: CHOFER, created_at: "2026-11-05T16:00:00Z" }],
  delivery_eta_plans: [{ delivery_id: "o1", plan_date: "2026-11-05", kind: "D", eta: "09:30", created_at: "2026-11-05T13:00:00Z" }],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: usuario } }) }, ...base(tablasConSesion, FILAS) }),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => base(tablasDeServicio, {}) }));

import { GET } from "@/app/api/driver-reports/route";
import { GET as CRON } from "@/app/api/cron/truck-tracks/route";

const fetchDeRed = vi.fn(async () => { throw new Error("la suite no llama a TrackSolid"); });
const pide = (q: string) => GET(new Request(`http://x/api/driver-reports${q}`));

beforeEach(() => {
  usuario = { id: "u1" }; perfil = { role: "logistics", store: null, permissions: [], module_access: ["deliveries"] }; errorDePerfil = null;
  tablasConSesion.length = 0; tablasDeServicio.length = 0; fetchDeRed.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "srv");
  for (const k of ["TRACKSOLID_APP_KEY", "TRACKSOLID_APP_SECRET", "TRACKSOLID_ACCOUNT", "TRACKSOLID_PASSWORD_MD5"]) vi.stubEnv(k, "x");
  vi.stubEnv("CRON_SECRET", "s3creto");
  vi.stubGlobal("fetch", fetchDeRed);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("GET /api/driver-reports: la puerta", () => {
  it("sin sesión: 401, y no se lee nada", async () => {
    usuario = null;
    const r = await pide("?from=2026-11-05&to=2026-11-05");
    expect(r.status).toBe(401);
    expect(tablasConSesion).toEqual([]); expect(tablasDeServicio).toEqual([]);
  });

  it.each(["driver", "sales", "warehouse", "accounting", "office"])("rol %s: 403, sin tocar la llave de servicio ni las órdenes", async (role) => {
    perfil = { role, store: null, permissions: [], module_access: ["deliveries"] };
    const r = await pide("?from=2026-11-05&to=2026-11-05");
    expect(r.status).toBe(403);
    expect(tablasConSesion).toEqual(["profiles"]);
    expect(tablasDeServicio).toEqual([]);
    expect(fetchDeRed).not.toHaveBeenCalled();
  });

  it("un gerente sin el módulo de Entregas: 403", async () => {
    perfil = { role: "manager", store: "RDZ Pharr", permissions: [], module_access: ["timetracker"] };
    expect((await pide("?from=2026-11-05&to=2026-11-05")).status).toBe(403);
    expect(tablasDeServicio).toEqual([]);
  });

  it("si no se puede leer el perfil: 503, no 403 — y tampoco se concede nada", async () => {
    perfil = null; errorDePerfil = { message: "caída" };
    expect((await pide("?from=2026-11-05&to=2026-11-05")).status).toBe(503);
    expect(tablasDeServicio).toEqual([]);
  });

  it("rango malo, chofer que no es un id, o mapa de más de un día: 400", async () => {
    expect((await pide("")).status).toBe(400);
    expect((await pide("?from=2026-09-01&to=2026-11-05")).status).toBe(400);
    expect((await pide("?from=2026-11-05&to=2026-11-05&driver=1%20or%201=1")).status).toBe(400);
    expect((await pide(`?from=2026-11-04&to=2026-11-05&driver=${CHOFER}&map=1`)).status).toBe(400);
    expect((await pide("?from=2026-11-05&to=2026-11-05&map=1")).status).toBe(400);
    expect(tablasDeServicio).toEqual([]);
  });

  it.each(["admin", "logistics", "manager"])("rol %s con Entregas: 200, con los días y sin ninguna llave en la respuesta", async (role) => {
    perfil = { role, store: role === "manager" ? "RDZ Pharr" : null, permissions: [], module_access: ["deliveries"] };
    const r = await pide("?from=2026-11-05&to=2026-11-05");
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const texto = await r.text(), b = JSON.parse(texto);
    expect(b.ok).toBe(true);
    expect(b.dias).toHaveLength(1);
    expect(b.dias[0]).toMatchObject({ fecha: "2026-11-05", chofer: "Ana", choferId: CHOFER });
    // Sin rastro (la base falsa no tiene posiciones): la hora sale del toque del chofer, y lo dice.
    expect(b.dias[0].rastro.fuente).toBeNull();
    expect(b.dias[0].paradas.find((p: { clave: string }) => p.clave === "D:o1")).toMatchObject({ fuente: "toque_cierre", eta: 570, difPlan: 30 });
    expect(b.mapa).toBeNull();
    expect(texto).not.toMatch(/srv|access_token|TRACKSOLID/);
    // TrackSolid no tiene camiones enlazados en la base falsa: no se le pregunta nada.
    expect(fetchDeRed).not.toHaveBeenCalled();
  });

  it("un chofer que no existe: 404; con uno que sí y `map=1`, la respuesta trae el mapa", async () => {
    expect((await pide("?from=2026-11-05&to=2026-11-05&driver=00000000-0000-4000-8000-000000000000")).status).toBe(404);
    const r = await pide(`?from=2026-11-05&to=2026-11-05&driver=${CHOFER}&map=1`);
    expect(r.status).toBe(200);
    expect((await r.json()).mapa).toEqual({ trazos: [], plan: [[26.25, -98.2]] });
  });
});

describe("GET /api/cron/truck-tracks", () => {
  it("sin el secreto: 401, sin tocar nada", async () => {
    expect((await CRON(new Request("http://x/api/cron/truck-tracks"))).status).toBe(401);
    expect((await CRON(new Request("http://x/api/cron/truck-tracks?key=otro"))).status).toBe(401);
    expect(tablasDeServicio).toEqual([]); expect(fetchDeRed).not.toHaveBeenCalled();
  });
  it("sin CRON_SECRET configurado no pasa nadie", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await CRON(new Request("http://x/api/cron/truck-tracks", { headers: { authorization: "Bearer " } }))).status).toBe(401);
  });
  it("`?verify=1` confirma el secreto sin leer ni escribir", async () => {
    const r = await CRON(new Request("http://x/api/cron/truck-tracks?verify=1", { headers: { authorization: "Bearer s3creto" } }));
    expect(await r.json()).toEqual({ ok: true, verify: true });
    expect(tablasDeServicio).toEqual([]);
  });
  it("con el secreto y sin camiones enlazados: no llama a TrackSolid", async () => {
    const r = await CRON(new Request("http://x/api/cron/truck-tracks", { headers: { authorization: "Bearer s3creto" } }));
    expect(await r.json()).toMatchObject({ ok: true, enabled: true, trucks: 0, calls: 0 });
    expect(fetchDeRed).not.toHaveBeenCalled();
  });
});
