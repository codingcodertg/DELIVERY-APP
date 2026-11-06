import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Las dos rutas de TrackSolid (D-NEXT): quién entra y qué sale.
 *
 * Supabase y TrackSolid son falsos: aquí no hay red. Lo que se guarda es la puerta —sin sesión 401, sin
 * `route_plan` 403, enlazar solo el admin— y que, sin las variables o sin la migración 257, la ruta diga
 * `enabled: false` SIN haber intentado hablar con TrackSolid.
 */

let usuario: { id: string } | null = null;
let perfil: Record<string, unknown> | null = null;
let errorDePerfil: { message: string } | null = null;
const escrituras: { tabla: string; op: string; fila?: unknown }[] = [];
let estadoRoto = false;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: perfil, error: errorDePerfil }) }) }) }),
  }),
}));

/** Un PostgREST de mentira, lo justo para las dos rutas. */
function baseFalsa() {
  const consulta = (tabla: string) => {
    const q: Record<string, unknown> = {};
    const fin = async () => {
      if (tabla === "tracksolid_state" && estadoRoto) return { data: null, error: { code: "42P01" } };
      if (tabla === "tracksolid_state") return { data: { access_token: "tok", refresh_token: "r", token_expires_at: new Date(Date.now() + 3600_000).toISOString(), positions: [{ imei: "863240070017882", nombre: "MCALLEN", lat: 26.1, lng: -98, velocidadKmh: 0, posicionEn: null, contactoEn: null, encendido: null }], positions_at: new Date().toISOString() }, error: null };
      if (tabla === "profiles") return { data: { id: "acf43ad5-0000-4000-8000-000000000000" }, error: null };
      return { data: [], error: null };
    };
    Object.assign(q, {
      select: () => q, eq: () => q, in: () => q, or: () => q, maybeSingle: fin,
      then: (ok: (v: unknown) => unknown) => fin().then(ok),
      update: (fila: unknown) => { escrituras.push({ tabla, op: "update", fila }); return q; },
      upsert: (fila: unknown) => { escrituras.push({ tabla, op: "upsert", fila }); return Promise.resolve({ error: null }); },
      delete: () => { escrituras.push({ tabla, op: "delete" }); return q; },
    });
    return q;
  };
  return { from: consulta };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => baseFalsa() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => baseFalsa() }));

import { GET } from "@/app/api/tracksolid/trucks/route";
import { PUT } from "@/app/api/tracksolid/links/route";

const VARIABLES = { TRACKSOLID_APP_KEY: "k", TRACKSOLID_APP_SECRET: "secreto-que-no-sale", TRACKSOLID_ACCOUNT: "a", TRACKSOLID_PASSWORD_MD5: "m", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "srv" };
const fetchDeRed = vi.fn(async () => { throw new Error("la suite no llama a TrackSolid"); });

beforeEach(() => {
  usuario = { id: "u1" }; perfil = { role: "logistics", permissions: [], module_access: ["deliveries"] }; errorDePerfil = null;
  escrituras.length = 0; estadoRoto = false; fetchDeRed.mockClear();
  for (const [k, v] of Object.entries(VARIABLES)) vi.stubEnv(k, v);
  vi.stubGlobal("fetch", fetchDeRed);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("GET /api/tracksolid/trucks", () => {
  it("sin sesión: 401", async () => {
    usuario = null;
    expect((await GET()).status).toBe(401);
  });

  it("sin route_plan (ventas, chofer, almacén): 403, y no se toca TrackSolid", async () => {
    for (const role of ["sales", "driver", "warehouse"]) {
      perfil = { role, permissions: [], module_access: ["deliveries"] };
      expect((await GET()).status).toBe(403);
    }
    expect(fetchDeRed).not.toHaveBeenCalled();
  });

  it("si no se pudo leer el perfil: 503, no 403", async () => {
    perfil = null; errorDePerfil = { message: "timeout" };
    expect((await GET()).status).toBe(503);
  });

  it("sin las variables: enabled false, en silencio", async () => {
    vi.stubEnv("TRACKSOLID_APP_SECRET", "");
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enabled: false });
    expect(fetchDeRed).not.toHaveBeenCalled();
  });

  it("sin la migración 257 (no hay dónde guardar el token): enabled false, y NO se pide token", async () => {
    estadoRoto = true;
    expect(await (await GET()).json()).toEqual({ enabled: false });
    expect(fetchDeRed).not.toHaveBeenCalled();
  });

  it("con permiso: los camiones de la caché, sin llaves ni token en la respuesta", async () => {
    const r = await GET();
    const texto = JSON.stringify(await r.json());
    const j = JSON.parse(texto);
    expect(j.enabled).toBe(true);
    expect(j.trucks).toHaveLength(1);
    expect(j.trucks[0]).toMatchObject({ imei: "863240070017882", nombre: "MCALLEN", chofer: null, tienda: null });
    expect(texto).not.toMatch(/secreto-que-no-sale|"tok"|access_token|srv/);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchDeRed).not.toHaveBeenCalled(); // lectura fresca en la base: ni una llamada fuera
  });
});

describe("PUT /api/tracksolid/links", () => {
  const pide = (cuerpo: unknown) => PUT(new Request("http://x/api/tracksolid/links", { method: "PUT", body: JSON.stringify(cuerpo) }));
  const ENLACE = { imei: "863240070017882", driver_id: "acf43ad5-0000-4000-8000-000000000000", home_store: "RDZ Pharr", device_name: "MCALLEN" };

  it("logística ve los camiones pero no los enlaza: 403, y no se escribe", async () => {
    expect((await pide(ENLACE)).status).toBe(403);
    expect(escrituras).toHaveLength(0);
  });

  it("el admin guarda el enlace, con quién lo hizo", async () => {
    perfil = { role: "admin" };
    expect((await pide(ENLACE)).status).toBe(200);
    expect(escrituras).toEqual([{ tabla: "tracksolid_devices", op: "upsert", fila: expect.objectContaining({ imei: ENLACE.imei, driver_id: ENLACE.driver_id, home_store: "RDZ Pharr", device_name: "MCALLEN", updated_by: "u1" }) }]);
  });

  it("sin chofer ni tienda, el enlace se borra", async () => {
    perfil = { role: "admin" };
    expect((await pide({ imei: ENLACE.imei, driver_id: null, home_store: "" })).status).toBe(200);
    expect(escrituras).toEqual([{ tabla: "tracksolid_devices", op: "delete" }]);
  });

  it("un IMEI que no lo es: 400", async () => {
    perfil = { role: "admin" };
    expect((await pide({ imei: "x" })).status).toBe(400);
    expect(escrituras).toHaveLength(0);
  });
});
