import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { todayISO } from "@/lib/utils";

/**
 * /api/tracksolid/assignments (D-NEXT): quién puede ver y quién puede cambiar el camión de cada chofer.
 *
 * Supabase y TrackSolid son falsos: aquí no hay red (la lectura de posiciones sale de la «base», fresca, y la suite
 * falla si alguien llama fuera). Lo que se guarda: cambiar es de quien planifica rutas y se decide EN EL SERVIDOR; la
 * posición del camión de un chofer la ven solo los que ya leen la de su teléfono, y solo con el turno abierto; un camión
 * no acaba con dos choferes.
 */

const T1 = "111111111111111", T2 = "222222222222222", T3 = "333333333333333";
const ANA = "aaaaaaaa-0000-4000-8000-000000000001", LUIS = "aaaaaaaa-0000-4000-8000-000000000002", EVA = "aaaaaaaa-0000-4000-8000-000000000003";
const HOY = todayISO();

let usuario: { id: string } | null = null;
let perfil: Record<string, unknown> | null = null;
let delDia: { driver_id: string; imei: string | null }[] = [];
let enTurno: string[] = [];
let sinTabla261 = false;
let errorAlEscribir: { code: string } | null = null;
const escrituras: { tabla: string; op: string; fila?: Record<string, unknown>; filtros?: Record<string, unknown> }[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: perfil, error: null }) }) }) }),
  }),
}));

const camion = (imei: string, nombre: string) => ({ imei, nombre, lat: 26.1, lng: -98.2, velocidadKmh: 0, posicionEn: new Date().toISOString(), contactoEn: new Date().toISOString(), encendido: true });

function baseFalsa() {
  const consulta = (tabla: string) => {
    const filtros: Record<string, unknown> = {};
    let op = "select";
    const fin = async () => {
      if (op === "delete") { escrituras.push({ tabla, op, filtros: { ...filtros } }); return { error: errorAlEscribir }; }
      if (tabla === "tracksolid_state") return { data: { access_token: "tok", refresh_token: "r", token_expires_at: new Date(Date.now() + 3600_000).toISOString(), positions: [camion(T1, "EDINBURG"), camion(T2, "MCALLEN"), camion(T3, "PHARR")], positions_at: new Date().toISOString() }, error: null };
      if (tabla === "tracksolid_devices") return { data: [{ imei: T1, driver_id: ANA, device_name: "EDINBURG" }, { imei: T2, driver_id: LUIS, device_name: "MCALLEN" }], error: null };
      if (tabla === "truck_day_assignments") return sinTabla261 ? { data: null, error: { code: "PGRST205" } } : { data: delDia, error: null };
      if (tabla === "profiles") return { data: [{ id: ANA, full_name: "Ana" }, { id: LUIS, full_name: "Luis" }, { id: EVA, full_name: "Eva" }], error: null };
      if (tabla === "driver_shifts") return { data: enTurno.map((driver_id) => ({ driver_id })), error: null };
      return { data: [], error: null };
    };
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q, in: () => q, or: () => q, is: () => q,
      eq: (k: string, v: unknown) => { filtros[k] = v; return q; },
      maybeSingle: fin,
      then: (ok: (v: unknown) => unknown, mal?: (e: unknown) => unknown) => fin().then(ok, mal),
      update: () => q,
      delete: () => { op = "delete"; return q; },
      upsert: (fila: Record<string, unknown>) => { escrituras.push({ tabla, op: "upsert", fila }); return Promise.resolve({ error: errorAlEscribir }); },
    });
    return q;
  };
  return { from: consulta };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => baseFalsa() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => baseFalsa() }));

import { GET, PUT } from "@/app/api/tracksolid/assignments/route";

const VARIABLES = { TRACKSOLID_APP_KEY: "k", TRACKSOLID_APP_SECRET: "secreto-que-no-sale", TRACKSOLID_ACCOUNT: "a", TRACKSOLID_PASSWORD_MD5: "m", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "srv" };
const fetchDeRed = vi.fn(async () => { throw new Error("la suite no llama a TrackSolid"); });

const como = (role: string, id = "u1", permissions: string[] = []) => { usuario = { id }; perfil = { role, permissions, module_access: ["deliveries"] }; };
const lee = (consulta: string) => GET(new Request(`http://x/api/tracksolid/assignments?${consulta}`));
const pide = (cuerpo: unknown) => PUT(new Request("http://x/api/tracksolid/assignments", { method: "PUT", body: JSON.stringify(cuerpo) }));
const filasEscritas = () => escrituras.filter((e) => e.tabla === "truck_day_assignments");

beforeEach(() => {
  como("logistics");
  delDia = []; enTurno = [ANA, LUIS]; sinTabla261 = false; errorAlEscribir = null; escrituras.length = 0; fetchDeRed.mockClear();
  for (const [k, v] of Object.entries(VARIABLES)) vi.stubEnv(k, v);
  vi.stubGlobal("fetch", fetchDeRed);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("GET /api/tracksolid/assignments — quién ve qué", () => {
  it("sin sesión 401; sin el módulo de Entregas 403; fecha mala 400", async () => {
    usuario = null;
    expect((await lee(`date=${HOY}`)).status).toBe(401);
    usuario = { id: "u1" }; perfil = { role: "sales", permissions: [], module_access: [] };
    expect((await lee(`date=${HOY}`)).status).toBe(403);
    como("logistics");
    expect((await lee("date=2026-02-31")).status).toBe(400);
  });

  it("sin las variables de TrackSolid: enabled false, en silencio", async () => {
    vi.stubEnv("TRACKSOLID_APP_KEY", "");
    expect(await (await lee(`date=${HOY}`)).json()).toEqual({ enabled: false });
  });

  it("quien planifica: el camión de cada chofer, la lista para elegir y las posiciones de los que están en turno", async () => {
    enTurno = [ANA];
    const r = await lee(`date=${HOY}&live=1`);
    const texto = JSON.stringify(await r.json());
    const j = JSON.parse(texto);
    expect(j).toMatchObject({ enabled: true, canAssign: true });
    expect(j.assignments).toEqual([
      { driverId: ANA, driver: "Ana", imei: T1, truck: "EDINBURG", origin: "usual", usualImei: T1, usualTruck: "EDINBURG" },
      { driverId: LUIS, driver: "Luis", imei: T2, truck: "MCALLEN", origin: "usual", usualImei: T2, usualTruck: "MCALLEN" },
    ]);
    expect(j.trucks.map((c: { name: string }) => c.name)).toEqual(["EDINBURG", "MCALLEN", "PHARR"]);
    // Luis no ha abierto turno: su camión no lo sitúa.
    expect(j.positions.map((p: { driverId: string }) => p.driverId)).toEqual([ANA]);
    expect(j.positions[0]).toMatchObject({ imei: T1, lat: 26.1, lng: -98.2 });
    expect(texto).not.toMatch(/secreto-que-no-sale|"tok"|access_token|srv/);
    expect(fetchDeRed).not.toHaveBeenCalled();
  });

  it("las posiciones son solo de HOY y solo si se piden", async () => {
    expect((await (await lee(`date=${HOY}`)).json()).positions).toBeUndefined();
    expect((await (await lee("date=2020-01-01&live=1")).json()).positions).toBeUndefined();
  });

  it("almacén y gerencia (leen driver_locations) ven posiciones pero no eligen; ventas ve el nombre del camión y ninguna posición", async () => {
    for (const rol of ["warehouse", "manager"]) {
      como(rol);
      const j = await (await lee(`date=${HOY}&live=1`)).json();
      expect(j.canAssign).toBe(false);
      expect(j.trucks).toBeUndefined();
      expect(j.positions).toHaveLength(2);
    }
    como("sales");
    const j = await (await lee(`date=${HOY}&live=1`)).json();
    expect(j.assignments).toHaveLength(2);
    expect(j.positions).toEqual([]);
  });

  it("un chofer ve SOLO su camión y solo su posición", async () => {
    como("driver", LUIS);
    const j = await (await lee(`date=${HOY}&live=1`)).json();
    expect(j.assignments.map((a: { driver: string }) => a.driver)).toEqual(["Luis"]);
    expect(j.positions.map((p: { driverId: string }) => p.driverId)).toEqual([LUIS]);
    expect(j.canAssign).toBe(false);
    expect(j.trucks).toBeUndefined();
  });

  it("lo del día manda sobre el habitual", async () => {
    delDia = [{ driver_id: EVA, imei: T1 }];
    const j = await (await lee(`date=${HOY}`)).json();
    expect(j.assignments.map((a: { driver: string; truck: string; origin: string }) => [a.driver, a.truck, a.origin])).toEqual([["Eva", "EDINBURG", "day"], ["Luis", "MCALLEN", "usual"]]);
  });

  it("sin la migración 261: los habituales siguen valiendo y no se ofrece cambiar", async () => {
    sinTabla261 = true;
    const j = await (await lee(`date=${HOY}`)).json();
    expect(j).toMatchObject({ enabled: true, canAssign: false });
    expect(j.assignments).toHaveLength(2);
  });
});

describe("PUT /api/tracksolid/assignments — quién cambia el camión", () => {
  it("sin sesión 401; sin route_plan (ventas, chofer, almacén, gerencia) 403 y no se escribe", async () => {
    usuario = null;
    expect((await pide({ date: HOY, driver_id: EVA, imei: T3 })).status).toBe(401);
    for (const rol of ["sales", "driver", "warehouse", "manager"]) {
      como(rol);
      expect((await pide({ date: HOY, driver_id: EVA, imei: T3 })).status, rol).toBe(403);
    }
    expect(escrituras).toHaveLength(0);
  });

  it("a quien un admin le concedió route_plan, sí", async () => {
    como("manager", "u1", ["route_plan"]);
    expect((await pide({ date: HOY, driver_id: EVA, imei: T3 })).status).toBe(200);
  });

  it("quien planifica da un camión libre: una fila, con quién lo hizo", async () => {
    expect((await pide({ date: HOY, driver_id: EVA, imei: T3 })).status).toBe(200);
    expect(filasEscritas()).toEqual([{ tabla: "truck_day_assignments", op: "upsert", fila: expect.objectContaining({ day: HOY, driver_id: EVA, imei: T3, updated_by: "u1" }) }]);
  });

  it("el camión que lleva otro chofer ese día: 409 con quién, y NO se escribe", async () => {
    const r = await pide({ date: HOY, driver_id: ANA, imei: T2 });
    expect(r.status).toBe(409);
    expect((await r.json()).conflict).toEqual({ driverId: LUIS, driver: "Luis", imei: T2, truck: "MCALLEN", inReturn: "EDINBURG" });
    expect(escrituras).toHaveLength(0);
  });

  it("con swap se intercambian: primero se suelta, después se reparte", async () => {
    expect((await pide({ date: HOY, driver_id: ANA, imei: T2, swap: true })).status).toBe(200);
    expect(filasEscritas().map((e) => [e.fila?.driver_id, e.fila?.imei])).toEqual([[LUIS, null], [ANA, T2], [LUIS, T1]]);
  });

  it("«el habitual» borra la excepción de ese chofer y de ese día, nada más", async () => {
    delDia = [{ driver_id: ANA, imei: T3 }];
    expect((await pide({ date: HOY, driver_id: ANA, imei: "usual" })).status).toBe(200);
    expect(filasEscritas()).toEqual([{ tabla: "truck_day_assignments", op: "delete", filtros: { day: HOY, driver_id: ANA } }]);
  });

  it("lo que no existe: 400 (chofer que no es chofer, camión desconocido, cuerpo roto)", async () => {
    expect((await pide({ date: HOY, driver_id: "aaaaaaaa-0000-4000-8000-00000000ffff", imei: T3 })).status).toBe(400);
    expect((await pide({ date: HOY, driver_id: EVA, imei: "999999999999999" })).status).toBe(400);
    expect((await pide({ date: HOY, driver_id: EVA, imei: "x" })).status).toBe(400);
    expect((await pide("nada")).status).toBe(400);
    expect(escrituras).toHaveLength(0);
  });

  it("dos personas a la vez: el índice único de la base lo para y se dice (409)", async () => {
    errorAlEscribir = { code: "23505" };
    expect((await pide({ date: HOY, driver_id: EVA, imei: T3 })).status).toBe(409);
  });

  it("sin la migración 261: 503, no un error mudo", async () => {
    sinTabla261 = true;
    expect((await pide({ date: HOY, driver_id: EVA, imei: T3 })).status).toBe(503);
  });
});
