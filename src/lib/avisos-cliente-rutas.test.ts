import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// Las rutas de los avisos al cliente (D-NEXT, 150): el cron de la noche antes exige el secreto, «en camino» exige
// sesión, y la baja es pública pero solo con un token con forma. La base es falsa, el proveedor un stub que cuenta, y
// `fetch` revienta: si algo se saltara el stub, la prueba fallaría en vez de mandar un SMS.

const h = vi.hoisted(() => ({
  db: null as unknown as { from: (t: string) => unknown; tablas: Record<string, Record<string, unknown>[]> },
  envios: [] as unknown[],
  creados: 0,
  sesion: true,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { h.creados++; return h.db; } }));
vi.mock("@/lib/api-auth", () => ({
  requireUser: async () => (h.sesion
    ? { ok: true, user: { id: "u1" }, supabase: null }
    : { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) }),
}));
vi.mock("@/lib/mensajeria", async (orig) => {
  const real = await orig<typeof import("@/lib/mensajeria")>();
  return {
    ...real,
    proveedorDelEntorno: () => ({
      sms: async (to: string, texto: string) => { h.envios.push({ canal: "sms", to, texto }); return { ok: false, dryRun: true, motivo: "stub" }; },
      correo: async (to: string, asunto: string, texto: string) => { h.envios.push({ canal: "correo", to, asunto, texto }); return { ok: false, dryRun: true, motivo: "stub" }; },
    }),
  };
});

import { baseFalsa } from "@/lib/avisos-cliente.fake-db";
import { GET as cron } from "@/app/api/cron/avisos-noche-antes/[franja]/route";
import { POST as enCamino } from "@/app/api/avisos-cliente/en-camino/route";
import { POST as baja } from "@/app/api/avisos-cliente/baja/route";

const fetchQueRevienta = vi.fn(async () => { throw new Error("una prueba intentó salir a la red"); });
const params = (franja: string) => ({ params: Promise.resolve({ franja }) });
const AJUSTES = { id: 1, notify_night_before_enabled: true, notify_on_the_way_enabled: true, notify_night_before_hour: 12, order_type_rules: { Customer: { storeToStore: false } } };

beforeEach(() => {
  h.db = baseFalsa({ settings: [AJUSTES], deliveries: [] }) as never;
  h.envios = []; h.creados = 0; h.sesion = true;
  vi.stubEnv("CRON_SECRET", "s3creto");
  vi.stubGlobal("fetch", fetchQueRevienta);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expect(fetchQueRevienta).not.toHaveBeenCalled(); });

describe("cron de la noche antes", () => {
  it("sin el secreto: 401 y ni se crea el cliente de servicio", async () => {
    const r = await cron(new Request("http://x/api/cron/avisos-noche-antes/23"), params("23"));
    expect(r.status).toBe(401);
    expect(h.creados).toBe(0);
  });
  it("verify=1 confirma el secreto sin leer nada", async () => {
    const r = await cron(new Request("http://x/api/cron/avisos-noche-antes/23?verify=1", { headers: { authorization: "Bearer s3creto" } }), params("23"));
    expect(r.status).toBe(200);
    expect(h.creados).toBe(0);
  });
  it("con el secreto corre, y con el aviso apagado no manda nada", async () => {
    h.db = baseFalsa({ settings: [{ ...AJUSTES, notify_night_before_enabled: false }] }) as never;
    const r = await cron(new Request("http://x/api/cron/avisos-noche-antes/23", { headers: { authorization: "Bearer s3creto" } }), params("23"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, apagado: true });
    expect(h.envios).toEqual([]);
  });
  it("sin la 150 (settings sin columnas → error de lectura): 502 y nada enviado", async () => {
    h.db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "column settings.notify_night_before_enabled does not exist" } }) }) }) }), tablas: {} };
    const r = await cron(new Request("http://x/api/cron/avisos-noche-antes/23", { headers: { authorization: "Bearer s3creto" } }), params("23"));
    expect(r.status).toBe(502);
    expect(h.envios).toEqual([]);
  });
});

describe("en camino", () => {
  it("sin sesión: 401", async () => {
    h.sesion = false;
    const r = await enCamino(new Request("http://x/api/avisos-cliente/en-camino", { method: "POST", body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }) }));
    expect(r.status).toBe(401);
    expect(h.creados).toBe(0);
  });
  it("un id que no es uuid: 400 antes de tocar la base", async () => {
    const r = await enCamino(new Request("http://x/api/avisos-cliente/en-camino", { method: "POST", body: JSON.stringify({ id: "1; drop" }) }));
    expect(r.status).toBe(400);
    expect(h.creados).toBe(0);
  });
  it("con sesión: rehace la ruta y avisa a la siguiente, por el stub", async () => {
    const base = { order_no: 1, order_type: "Customer", assigned_driver: "Uno", delivery_date: "2026-09-29", is_training: false, notify_pref: "both", delivery_windows: null, morning_priority: false, route_miles: null };
    h.db = baseFalsa({ settings: [AJUSTES], deliveries: [
      { ...base, id: "11111111-1111-4111-8111-111111111111", stage: "delivered", route_seq: 1, delivery_phone: "9565550101" },
      { ...base, id: "22222222-2222-4222-8222-222222222222", stage: "picked_up", route_seq: 2, delivery_phone: "9565550102" },
    ] }) as never;
    const r = await enCamino(new Request("https://rtg-hub.vercel.app/api/avisos-cliente/en-camino", { method: "POST", body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }) }));
    expect(r.status).toBe(200);
    expect((await r.json()).siguiente).toBe("22222222-2222-4222-8222-222222222222");
    expect(h.envios).toHaveLength(1);
  });
});

describe("baja", () => {
  it("token con mala forma: 400 y no se toca la base", async () => {
    const r = await baja(new Request("http://x/api/avisos-cliente/baja", { method: "POST", body: JSON.stringify({ token: "x" }) }));
    expect(r.status).toBe(400);
  });
  it("token que no existe: 404", async () => {
    const r = await baja(new Request("http://x/api/avisos-cliente/baja", { method: "POST", body: JSON.stringify({ token: "AbCdEfGh12345678" }) }));
    expect(r.status).toBe(404);
  });
  it("token bueno: 200 y la baja queda", async () => {
    h.db = baseFalsa({ customer_notifications: [{ id: "n1", delivery_id: "a", kind: "night_before", sms_to: "+19565550101", email_to: null, unsub_token: "AbCdEfGh12345678" }] }) as never;
    const r = await baja(new Request("http://x/api/avisos-cliente/baja", { method: "POST", body: JSON.stringify({ token: "AbCdEfGh12345678" }) }));
    expect(r.status).toBe(200);
    expect(h.db.tablas.customer_notify_optouts.map((f) => f.contact)).toEqual(["+19565550101"]);
  });
});
