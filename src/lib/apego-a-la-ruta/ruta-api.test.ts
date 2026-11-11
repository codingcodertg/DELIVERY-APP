import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `/api/route-adherence` (D-910): quién entra, y que contesta el apego del día con el mismo motor que los reportes.
 *
 * Supabase y TrackSolid son falsos: aquí no hay red. La puerta es la de `/api/tracksolid/trails` (D-909): con Entregas,
 * admin, logística, gerencia y almacén ven a todos; el chofer, solo lo suyo; los demás, 403.
 */

let usuario: { id: string } | null = null;
let perfil: Record<string, unknown> | null = null;
let errorDePerfil: { message: string } | null = null;
const tablasConSesion: string[] = [], tablasDeServicio: string[] = [];

const ANA = "9db2d07a-804d-4ac3-a19a-93cec7090270", BETO = "1db2d07a-804d-4ac3-a19a-93cec7090271";
const HOY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const AYER = new Date(Date.parse(`${HOY}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const ORDEN = {
  id: "o1", order_code: "FW1", order_type: "Customer", store: "RDZ Pharr", account: "Casa", pickup_name: "RDZ Pharr", delivery_name: "Casa", assigned_driver: "Ana", delivery_date: AYER, stage: "delivered",
  route_seq: 1, delivery_windows: "0830-1730", pickup_duration: "10", delivery_duration: "15", delivery_lat: 26.25, delivery_lng: -98.2, pickup_point_lat: null, pickup_point_lng: null,
  pickup_lat: null, pickup_lng: null, pod_lat: null, pod_lng: null, pickup_gps_at: `${AYER}T14:20:00Z`, pod_delivered_at: `${AYER}T16:00:00Z`, is_training: false,
};
/** Beto tiene una orden pero el Gestor no le puso horas: sin plan. */
const ORDEN_SIN_PLAN = { ...ORDEN, id: "o2", order_code: "FW2", assigned_driver: "Beto", delivery_lat: 26.3, delivery_lng: -98.1 };

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
  profiles: [{ id: ANA, full_name: "Ana" }, { id: BETO, full_name: "Beto" }],
  perfiles_publicos: [{ id: ANA, full_name: "Ana", role: "driver" }, { id: BETO, full_name: "Beto", role: "driver" }],
  deliveries: [ORDEN, ORDEN_SIN_PLAN],
  order_events: [
    { delivery_id: "o1", kind: "picked_up", created_by: ANA, created_at: `${AYER}T14:20:00Z` },
    { delivery_id: "o1", kind: "delivered", created_by: ANA, created_at: `${AYER}T16:00:00Z` },
  ],
  delivery_eta_plans: [
    { delivery_id: "o1", plan_date: AYER, kind: "P", eta: "08:10", created_at: `${AYER}T13:00:00Z` },
    { delivery_id: "o1", plan_date: AYER, kind: "D", eta: "09:30", created_at: `${AYER}T13:00:00Z` },
  ],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: usuario } }) }, ...base(tablasConSesion, FILAS) }),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => base(tablasDeServicio, {}) }));

import { GET } from "@/app/api/route-adherence/route";

const fetchDeRed = vi.fn(async () => { throw new Error("la suite no llama a TrackSolid"); });
const pide = (q: string) => GET(new Request(`http://x/api/route-adherence${q}`));

beforeEach(() => {
  usuario = { id: "u1" }; perfil = { role: "logistics", store: null, permissions: [], module_access: ["deliveries"] }; errorDePerfil = null;
  tablasConSesion.length = 0; tablasDeServicio.length = 0; fetchDeRed.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "srv");
  for (const k of ["TRACKSOLID_APP_KEY", "TRACKSOLID_APP_SECRET", "TRACKSOLID_ACCOUNT", "TRACKSOLID_PASSWORD_MD5"]) vi.stubEnv(k, "x");
  vi.stubGlobal("fetch", fetchDeRed);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("GET /api/route-adherence: la puerta", () => {
  it("sin sesión: 401, y no se lee nada", async () => {
    usuario = null;
    expect((await pide(`?date=${AYER}`)).status).toBe(401);
    expect(tablasConSesion).toEqual([]); expect(tablasDeServicio).toEqual([]);
  });

  it.each(["sales", "accounting", "office"])("rol %s: 403, sin tocar la llave de servicio ni las órdenes", async (role) => {
    perfil = { role, store: null, permissions: [], module_access: ["deliveries"] };
    expect((await pide(`?date=${AYER}`)).status).toBe(403);
    expect(tablasConSesion).toEqual(["profiles"]);
    expect(tablasDeServicio).toEqual([]);
  });

  it("un gerente sin el módulo de Entregas: 403", async () => {
    perfil = { role: "manager", store: "RDZ Pharr", permissions: [], module_access: ["timetracker"] };
    expect((await pide(`?date=${AYER}`)).status).toBe(403);
  });

  it("si no se puede leer el perfil: 503", async () => {
    perfil = null; errorDePerfil = { message: "caída" };
    expect((await pide(`?date=${AYER}`)).status).toBe(503);
  });

  it("fecha mala: 400; un día futuro: vacío sin leer nada", async () => {
    expect((await pide("")).status).toBe(400);
    expect((await pide("?date=2026-13-40")).status).toBe(400);
    const r = await pide("?date=2099-01-01");
    expect(await r.json()).toEqual({ date: "2099-01-01", drivers: [], live: false });
    // Tres peticiones, tres lecturas del perfil, y ninguna de órdenes ni de la llave de servicio.
    expect(tablasConSesion).toEqual(["profiles", "profiles", "profiles"]); expect(tablasDeServicio).toEqual([]);
  });

  it.each(["admin", "logistics", "warehouse"])("rol %s con Entregas: 200, un apego por chofer con órdenes, y sin ninguna llave en la respuesta", async (role) => {
    perfil = { role, store: null, permissions: [], module_access: ["deliveries"] };
    const r = await pide(`?date=${AYER}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const texto = await r.text(), b = JSON.parse(texto);
    expect(b.date).toBe(AYER); expect(b.live).toBe(false);
    expect(b.drivers).toHaveLength(2);
    const ana = b.drivers.find((d: { driverId: string }) => d.driverId === ANA), beto = b.drivers.find((d: { driverId: string }) => d.driverId === BETO);
    // Ana: dos paradas del plan (tienda, casa), las dos hechas por los toques del chofer (sin rastro en la base falsa).
    expect(ana).toMatchObject({ chofer: "Ana", fecha: AYER, hayPlan: true });
    expect(ana.orden).toMatchObject({ planeadas: 2, visitadas: 2, enOrden: 2, pct: 100, fueraDeOrden: [], noVisitadas: [] });
    expect(ana.paradas.map((p: { lugar: string; eta: number }) => [p.lugar, p.eta])).toEqual([["RDZ Pharr", 490], ["Casa", 570]]);
    expect(ana.plan).toMatchObject({ tramos: 1, tramosEstimados: 1, estimado: true, minutosServicio: 25 });
    expect(ana.plan.millas).toBeGreaterThan(0);
    expect(ana.real).toMatchObject({ millas: null, minutosTotal: null, enVivo: false });
    expect(ana.lineaDelPlan).toEqual([[26.2041, -98.1686], [26.25, -98.2]]);
    // Beto: órdenes sin horas del Gestor → sin ruta programada.
    expect(beto).toMatchObject({ chofer: "Beto", hayPlan: false });
    expect(beto.orden.pct).toBeNull();
    expect(texto).not.toMatch(/srv|access_token|TRACKSOLID/);
    expect(fetchDeRed).not.toHaveBeenCalled();
  });

  it("el chofer solo recibe lo suyo", async () => {
    usuario = { id: ANA }; perfil = { role: "driver", store: null, permissions: [], module_access: ["deliveries"] };
    const r = await pide(`?date=${AYER}`);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.drivers.map((d: { driverId: string }) => d.driverId)).toEqual([ANA]);
  });

  it("un chofer sin perfil de chofer en la lista: vacío, no 404", async () => {
    usuario = { id: "00000000-0000-4000-8000-000000000000" }; perfil = { role: "driver", store: null, permissions: [], module_access: ["deliveries"] };
    const r = await pide(`?date=${AYER}`);
    expect(r.status).toBe(200);
    expect((await r.json()).drivers).toEqual([]);
  });
});
