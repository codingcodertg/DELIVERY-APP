import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FetchFn } from "./api";
import { aHoraDeJimi, horaDeJimi, type AlmacenDeHistorial, type DiaDeCamion } from "./historial";
import type { AlmacenDeToken } from "./token";
import type { PuntoDeRastro } from "@/lib/reportes-choferes/rastro";

/**
 * GET /api/tracksolid/trails y lo que hay detrás (D-NEXT): quién entra, qué ve cada uno, y cuánto se le pregunta a
 * TrackSolid. Supabase y TrackSolid son falsos: aquí no hay red.
 */

let usuario: { id: string } | null = null;
let perfil: Record<string, unknown> | null = null;
let errorDePerfil: { message: string } | null = null;
let estadoRoto = false;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: perfil, error: errorDePerfil }) }) }) }),
  }),
}));

const JULIO = "57b59dcc-b15d-40cf-bc72-e1b5fbe310ab", ERNESTO = "9db2d07a-804d-4ac3-a19a-93cec7090270", MAXIMO = "11111111-1111-4111-8111-111111111111";
const FREITHLINER = "863240070017882", PETERBIL = "863240070018328";
const ENLACES = [{ imei: FREITHLINER, driver_id: JULIO, device_name: "MCALLEN FREITHLINER" }, { imei: PETERBIL, driver_id: ERNESTO, device_name: "EDINBURG PETERBIL" }];

/** Un PostgREST de mentira: los enlaces de los camiones, las excepciones del día y el estado de TrackSolid. */
function baseFalsa(delDia: { driver_id: string; imei: string | null }[] = []) {
  const consulta = (tabla: string) => {
    const q: Record<string, unknown> = {};
    const fin = async () => {
      if (tabla === "tracksolid_state" && estadoRoto) return { data: null, error: { code: "42P01" } };
      if (tabla === "tracksolid_devices") return { data: ENLACES, error: null };
      if (tabla === "truck_day_assignments") return { data: delDia, error: null };
      return { data: [], error: null };
    };
    Object.assign(q, { select: () => q, eq: () => q, in: () => q, gte: () => q, lte: () => q, maybeSingle: fin, then: (ok: (v: unknown) => unknown) => fin().then(ok) });
    return q;
  };
  return { from: consulta };
}
vi.mock("@supabase/supabase-js", () => ({ createClient: () => baseFalsa() }));

const servicio = vi.hoisted(() => ({ rastrosDelDia: vi.fn() }));
vi.mock("@/lib/tracksolid/rastro-en-mapa-servicio", async (original) => ({ ...(await original<typeof import("./rastro-en-mapa-servicio")>()), rastrosDelDia: servicio.rastrosDelDia }));

import { GET } from "@/app/api/tracksolid/trails/route";
import { todayISO, shiftDateISO } from "@/lib/utils";

const VARIABLES = { TRACKSOLID_APP_KEY: "k", TRACKSOLID_APP_SECRET: "secreto-que-no-sale", TRACKSOLID_ACCOUNT: "a", TRACKSOLID_PASSWORD_MD5: "m", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "srv-que-no-sale" };
const fetchDeRed = vi.fn(async () => { throw new Error("la suite no llama a TrackSolid"); });
const LINEA: [number, number, number][] = [[1_793_973_600, 26.2, -98.2], [1_793_973_660, 26.21, -98.2]];
const RASTROS = [
  { driverId: JULIO, imei: FREITHLINER, truck: "MCALLEN FREITHLINER", points: 959, miles: 99.2, line: LINEA },
  { driverId: ERNESTO, imei: PETERBIL, truck: "EDINBURG PETERBIL", points: 1070, miles: 89.7, line: LINEA },
];
const pide = (fecha: string | null = todayISO()) => GET(new Request(`http://x/api/tracksolid/trails${fecha == null ? "" : `?date=${fecha}`}`));

beforeEach(() => {
  usuario = { id: "u1" }; perfil = { role: "logistics", permissions: [], module_access: ["deliveries"] }; errorDePerfil = null; estadoRoto = false;
  fetchDeRed.mockClear();
  servicio.rastrosDelDia.mockReset();
  servicio.rastrosDelDia.mockResolvedValue({ rastros: RASTROS, pendientes: 0 });
  for (const [k, v] of Object.entries(VARIABLES)) vi.stubEnv(k, v);
  vi.stubGlobal("fetch", fetchDeRed);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("GET /api/tracksolid/trails: quién entra", () => {
  it("sin sesión: 401", async () => {
    usuario = null;
    expect((await pide()).status).toBe(401);
    expect(servicio.rastrosDelDia).not.toHaveBeenCalled();
  });

  it("sin el módulo de Entregas: 403", async () => {
    perfil = { role: "logistics", permissions: [], module_access: ["clockin"] };
    expect((await pide()).status).toBe(403);
    expect(servicio.rastrosDelDia).not.toHaveBeenCalled();
  });

  it("quien no puede ver dónde están los choferes (ventas, caja): 403, y no se lee nada", async () => {
    for (const role of ["sales", "cashier", "accounting"]) {
      perfil = { role, permissions: [], module_access: ["deliveries"] };
      expect((await pide()).status).toBe(403);
    }
    expect(servicio.rastrosDelDia).not.toHaveBeenCalled();
  });

  it("si no se pudo leer el perfil: 503, no 403", async () => {
    perfil = null; errorDePerfil = { message: "timeout" };
    expect((await pide()).status).toBe(503);
  });

  it("admin, logística, gerencia y almacén ven los rastros de todos", async () => {
    for (const role of ["admin", "logistics", "manager", "warehouse"]) {
      perfil = { role, permissions: [], module_access: ["deliveries"] };
      const r = await pide();
      expect(r.status).toBe(200);
      expect((await r.json()).trails.map((t: { driverId: string }) => t.driverId)).toEqual([JULIO, ERNESTO]);
    }
  });

  it("el chofer ve SOLO el suyo; el que no lleva camión, ninguno", async () => {
    perfil = { role: "driver", permissions: [], module_access: ["deliveries"] };
    usuario = { id: ERNESTO };
    expect((await (await pide()).json()).trails.map((t: { driverId: string }) => t.driverId)).toEqual([ERNESTO]);
    usuario = { id: MAXIMO };
    expect((await (await pide()).json()).trails).toEqual([]);
  });

  it("la fecha: sin ella o inventada, 400; un día que no ha llegado, vacío sin preguntar", async () => {
    expect((await pide(null)).status).toBe(400);
    expect((await pide("2026-02-31")).status).toBe(400);
    expect((await pide("ayer")).status).toBe(400);
    const r = await pide(shiftDateISO(todayISO(), 1));
    expect(await r.json()).toMatchObject({ enabled: true, trails: [] });
    expect(servicio.rastrosDelDia).not.toHaveBeenCalled();
  });

  it("un día pasado: quien ve todo el historial lo recibe; quien no, 403 fuera de su ventana (D-239)", async () => {
    const hace10 = shiftDateISO(todayISO(), -10);
    expect((await pide(hace10)).status).toBe(200);
    expect(servicio.rastrosDelDia).toHaveBeenLastCalledWith(expect.anything(), hace10);
    perfil = { role: "manager", permissions: [], module_access: ["deliveries"] };
    expect((await pide(hace10)).status).toBe(403);
    expect((await pide(shiftDateISO(todayISO(), -1))).status).toBe(200);
    perfil = { role: "manager", permissions: ["history"], module_access: ["deliveries"] };
    expect((await pide(hace10)).status).toBe(200);
  });
});

describe("GET /api/tracksolid/trails: qué sale y qué no", () => {
  it("ni llaves ni token ni llave de servicio en la respuesta, y sin caché del navegador", async () => {
    const r = await pide();
    const texto = JSON.stringify(await r.json());
    expect(JSON.parse(texto)).toMatchObject({ enabled: true, date: todayISO(), delayed: false });
    expect(JSON.parse(texto).trails[0]).toEqual(RASTROS[0]);
    expect(texto).not.toMatch(/secreto-que-no-sale|srv-que-no-sale|access_token|"tok"/);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });

  it("sin las variables de TrackSolid: enabled false, en silencio", async () => {
    vi.stubEnv("TRACKSOLID_APP_SECRET", "");
    const r = await pide();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enabled: false });
    expect(servicio.rastrosDelDia).not.toHaveBeenCalled();
  });

  it("sin llave de servicio: enabled false", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(await (await pide()).json()).toEqual({ enabled: false });
  });

  it("si leer los rastros truena, NO es un 500: llega vacío y `delayed`, y la pantalla dibuja el teléfono", async () => {
    servicio.rastrosDelDia.mockRejectedValue(new Error("tracksolid_devices"));
    const r = await pide();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ enabled: true, trails: [], delayed: true });
  });

  it("si un camión se quedó sin leer, lo dice (`delayed`) y manda los que sí", async () => {
    servicio.rastrosDelDia.mockResolvedValue({ rastros: [RASTROS[1]], pendientes: 1 });
    expect(await (await pide()).json()).toMatchObject({ delayed: true, trails: [RASTROS[1]] });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// El servicio de verdad (sin el mock de arriba): qué camión, de dónde sale el rastro y cuántas veces se pregunta.
// ---------------------------------------------------------------------------------------------------------------

const CONFIG = { appKey: "k", appSecret: "secreto-que-no-sale", cuenta: "a", claveMd5: "m" };
const ZONA = "America/Chicago", HOY = "2026-11-06";
const AHORA = Date.parse("2026-11-06T21:00:00Z");           // las 3 de la tarde del 6 en Texas
const tokenFijo: AlmacenDeToken = { leeToken: async () => ({ accessToken: "tok", refreshToken: "r", caducaEn: AHORA + 3_600_000 }), guardaToken: async () => {}, reservaPeticion: async () => true };

/** Un TrackSolid de mentira: un punto cada 10 s de las 8:00 a las 9:00 de Texas (el camión anduvo una hora). */
function tracksolid(falla = false) {
  const pedidas: Record<string, string>[] = [];
  const fetch: FetchFn = vi.fn(async (_url, init) => {
    const q = Object.fromEntries(new URLSearchParams(init.body));
    pedidas.push(q);
    if (falla) return { json: async () => ({ code: 1006, message: "too frequent" }) };
    const a = Math.max(horaDeJimi(q.begin_time)!, Date.parse("2026-11-06T14:00:00Z")), b = Math.min(horaDeJimi(q.end_time)!, Date.parse("2026-11-06T15:00:00Z"));
    const result: Record<string, unknown>[] = [];
    for (let t = a, i = 0; t <= b; t += 10_000, i++) result.push({ lat: 26.2, lng: -98.2 + i * 0.0015, gpsTime: aHoraDeJimi(t), gpsSpeed: 50, posType: 1 });
    return { json: async () => ({ code: 0, message: "success", result }) };
  });
  return { fetch, pedidas };
}
function guardado(inicial: DiaDeCamion[] = []): AlmacenDeHistorial & { dias: DiaDeCamion[] } {
  const dias = [...inicial];
  return { dias, lee: async (imeis, desde, hasta) => dias.filter((d) => imeis.includes(d.imei) && d.fecha >= desde && d.fecha <= hasta), guarda: async (n) => { for (const d of n) { const i = dias.findIndex((x) => x.imei === d.imei && x.fecha === d.fecha); if (i >= 0) dias[i] = d; else dias.push(d); } } };
}
const horaDeCamino = (): PuntoDeRastro[] => Array.from({ length: 361 }, (_, i) => ({ t: Date.parse("2026-11-06T14:00:00Z") + i * 10_000, lat: 26.2, lng: -98.2 + i * 0.0015, mph: 30 }));

describe("rastrosDelDia: de dónde sale la línea", async () => {
  const real = await vi.importActual<typeof import("./rastro-en-mapa-servicio")>("./rastro-en-mapa-servicio");
  const deps = (ts: ReturnType<typeof tracksolid>, historial: AlmacenDeHistorial | null, extra: Partial<Parameters<typeof real.rastrosDelDia>[0]> = {}) => ({
    db: baseFalsa() as unknown as SupabaseClient, config: CONFIG, almacen: tokenFijo, historial, fetch: ts.fetch, zona: ZONA,
    ahora: () => AHORA, memoria: { leidos: new Map(), enCurso: new Map() }, ...extra,
  });

  it("un rastro por chofer con camión (el habitual), con todos sus puntos contados y la línea adelgazada", async () => {
    const ts = tracksolid(), h = guardado();
    const { rastros, pendientes } = await real.rastrosDelDia(deps(ts, h), HOY);
    expect(pendientes).toBe(0);
    expect(rastros.map((r) => [r.driverId, r.imei, r.truck])).toEqual([[JULIO, FREITHLINER, "MCALLEN FREITHLINER"], [ERNESTO, PETERBIL, "EDINBURG PETERBIL"]]);
    expect(rastros[0].points).toBe(361);
    expect(rastros[0].miles).toBeGreaterThan(33);
    expect(rastros[0].line.length).toBeLessThan(100);
    expect(ts.pedidas).toHaveLength(2);                       // una llamada por camión
    expect(h.dias.map((d) => d.completo)).toEqual([false, false]);   // hoy no está terminado: se volverá a pedir
  });

  it("el camión DEL DÍA manda sobre el habitual: si hoy Máximo lleva el de Julio, el rastro es de Máximo", async () => {
    const ts = tracksolid();
    const db = baseFalsa([{ driver_id: MAXIMO, imei: FREITHLINER }]) as unknown as SupabaseClient;
    const { rastros } = await real.rastrosDelDia(deps(ts, guardado(), { db }), HOY);
    expect(rastros.map((r) => [r.driverId, r.imei])).toEqual([[MAXIMO, FREITHLINER], [ERNESTO, PETERBIL]]);
  });

  it("diez pantallas a la vez son UNA lectura; y dentro de la memoria ni se mira la base", async () => {
    const ts = tracksolid(), h = guardado(), d = deps(ts, h);
    const todas = await Promise.all(Array.from({ length: 10 }, () => real.rastrosDelDia(d, HOY)));
    expect(new Set(todas).size).toBe(1);
    expect(ts.pedidas).toHaveLength(2);
    await real.rastrosDelDia(d, HOY);
    expect(ts.pedidas).toHaveLength(2);
  });

  it("otra instancia (otra memoria) usa lo guardado en la base mientras tenga menos de 3 minutos: cero llamadas", async () => {
    const ts = tracksolid(), h = guardado();
    await real.rastrosDelDia(deps(ts, h), HOY);
    const mas = { ...deps(ts, h), ahora: () => AHORA + 2 * 60_000 };
    expect((await real.rastrosDelDia(mas, HOY)).rastros).toHaveLength(2);
    expect(ts.pedidas).toHaveLength(2);
    // Pasados los 3 minutos sí se vuelve a pedir: una vez por camión.
    await real.rastrosDelDia({ ...deps(ts, h), ahora: () => AHORA + 4 * 60_000 }, HOY);
    expect(ts.pedidas).toHaveLength(4);
  });

  it("sin dónde guardar (sin la 264), la memoria aguanta los 3 minutos: no es una llamada por refresco", async () => {
    const ts = tracksolid(), d = deps(ts, null);
    let reloj = AHORA;
    const con = { ...d, ahora: () => reloj };
    await real.rastrosDelDia(con, HOY);
    reloj += 100_000; await real.rastrosDelDia(con, HOY);
    expect(ts.pedidas).toHaveLength(2);
    reloj += 100_000; await real.rastrosDelDia(con, HOY);
    expect(ts.pedidas).toHaveLength(4);
  });

  it("TrackSolid falla y no hay nada guardado: sin rastros, pendientes, y NO lanza (se dibuja el teléfono)", async () => {
    const ts = tracksolid(true);
    expect(await real.rastrosDelDia(deps(ts, guardado()), HOY)).toEqual({ rastros: [], pendientes: 2 });
  });

  it("TrackSolid falla pero hay una copia vieja de hoy: vale la copia (mejor la línea de hace un rato que ninguna)", async () => {
    const ts = tracksolid(true);
    const h = guardado([{ imei: FREITHLINER, fecha: HOY, puntos: horaDeCamino(), completo: false, leidoEn: AHORA - 40 * 60_000 }]);
    const r = await real.rastrosDelDia(deps(ts, h), HOY);
    expect(r.pendientes).toBe(2);
    expect(r.rastros.map((x) => x.driverId)).toEqual([JULIO]);
    expect(r.rastros[0].points).toBe(361);
  });

  it("un día pasado ya guardado como completo no se vuelve a pedir nunca", async () => {
    const ts = tracksolid();
    const ayer = "2026-11-05";
    const puntos = horaDeCamino().map((p) => ({ ...p, t: p.t - 86_400_000 }));
    const h = guardado([{ imei: FREITHLINER, fecha: ayer, puntos, completo: true, leidoEn: AHORA - 3_600_000 }, { imei: PETERBIL, fecha: ayer, puntos, completo: true, leidoEn: AHORA - 3_600_000 }]);
    expect((await real.rastrosDelDia(deps(ts, h), ayer)).rastros).toHaveLength(2);
    expect(ts.pedidas).toHaveLength(0);
  });

  it("un camión que casi no se movió (pocos puntos) no manda rastro: ese chofer se dibuja con el teléfono", async () => {
    const ts = tracksolid();
    const h = guardado([{ imei: FREITHLINER, fecha: HOY, puntos: horaDeCamino().slice(0, 10), completo: false, leidoEn: AHORA - 10_000 }]);
    const { rastros } = await real.rastrosDelDia(deps(ts, h), HOY);
    expect(rastros.map((r) => r.driverId)).toEqual([ERNESTO]);
  });

  it("si no se puede leer qué camión lleva cada chofer, lanza (y la ruta contesta vacío)", async () => {
    const rota = { from: () => { const q: Record<string, unknown> = {}; Object.assign(q, { select: () => q, eq: () => q, then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "XX000" } }).then(ok) }); return q; } } as unknown as SupabaseClient;
    await expect(real.rastrosDelDia(deps(tracksolid(), guardado(), { db: rota }), HOY)).rejects.toThrow();
  });
});
