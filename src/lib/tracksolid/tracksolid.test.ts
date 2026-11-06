import { describe, it, expect, vi, beforeEach } from "vitest";
import { firma, marcaDeTiempo } from "./firma";
import { configDeTracksolid, cuerpoFirmado, ErrorDeTracksolid, llamaTracksolid, URL_DE_TRACKSOLID, type ConfigDeTracksolid, type FetchFn } from "./api";
import { tokenDeTracksolid, MARGEN_DE_CADUCIDAD_MS, type TokenGuardado } from "./token";
import { CACHE_DE_POSICIONES_MS, posicionesDeCamiones, type AlmacenDePosiciones, type LecturaDePosiciones, type MemoriaDePosiciones } from "./posiciones";
import {
  camionDesdeJimi, estadoDelCamion, fechaDeJimi, haceCuanto, horaLocal, kmhAMph, MINUTOS_SIN_SENAL, puedeEnlazarCamiones, puedeVerCamiones, textoDelCamion,
  type CamionDeTracksolid,
} from "./camiones";
import { conEnlaces, enlaceValido } from "./servicio";
import { svgDelCamion, tarjetaDelCamion } from "./marca";
import { tocaRefrescar } from "./useCamiones";

/**
 * TrackSolid Pro en el Gestor de Rutas (D-900).
 *
 * NINGUNA prueba de aquí sale a la red: `fetch` es siempre uno falso que se inyecta, y la base es una de
 * memoria. Lo que se guarda: la firma (si cambia, Jimi rechaza todo), que el token NO se pida de más (Jimi
 * deja una petición por minuto y castiga con 1006), la caché de 30 s, qué es «sin señal», las unidades y
 * quién puede mirar.
 */

const CONFIG: ConfigDeTracksolid = { appKey: "KEY", appSecret: "SEC", cuenta: "cuenta", claveMd5: "abc123" };
const T0 = Date.UTC(2026, 10, 6, 14, 39, 26); // 2026-11-06 14:39:26 UTC
const t = (en: string) => en;

/** La base, en memoria. Cuenta las reservas para poder afirmar que no se pidió turno de más. */
function almacenFalso(inicial: { token?: TokenGuardado | null; posiciones?: LecturaDePosiciones | null; pedidoEn?: number | null } = {}) {
  const e = { token: inicial.token ?? null, posiciones: inicial.posiciones ?? null, pedidoEn: inicial.pedidoEn ?? null as number | null, reservas: 0 };
  const almacen: AlmacenDePosiciones = {
    leeToken: async () => e.token,
    guardaToken: async (tk) => { e.token = tk; },
    reservaPeticion: async (ahora, ventana) => {
      if (e.pedidoEn != null && ahora - e.pedidoEn < ventana) return false;
      e.pedidoEn = ahora; e.reservas++;
      return true;
    },
    leePosiciones: async () => e.posiciones,
    guardaPosiciones: async (l) => { e.posiciones = l; },
  };
  return { almacen, e };
}

/** Un TrackSolid falso: contesta por `method` y apunta cada llamada. */
function jimiFalso(respuestas: Record<string, (p: URLSearchParams, n: number) => unknown>) {
  const llamadas: { method: string; params: URLSearchParams }[] = [];
  const fetchFalso: FetchFn = async (url, init) => {
    expect(url).toBe(URL_DE_TRACKSOLID);
    const params = new URLSearchParams(init.body);
    const method = params.get("method")!;
    llamadas.push({ method, params });
    const n = llamadas.filter((l) => l.method === method).length;
    return { json: async () => respuestas[method]?.(params, n) ?? { code: 1001, message: "unexpected" } };
  };
  return { fetch: fetchFalso, llamadas, de: (m: string) => llamadas.filter((l) => l.method === m).length };
}

const TOKEN_OK = (_p: URLSearchParams, n: number) => ({ code: 0, result: { accessToken: `tok-${n}`, refreshToken: `ref-${n}`, expiresIn: 7200 } });
const EQUIPO = { imei: "863240070017882", deviceName: "MCALLEN FREITHLINER", lat: 26.19, lng: -98.08, speed: "64", gpsTime: "2026-11-06 14:39:20", hbTime: "2026-11-06 14:37:22", accStatus: "1" };
const sinEspera = async () => {};

describe("la firma", () => {
  it("es el MD5 en mayúsculas de secreto + claves ordenadas pegadas a su valor + secreto", () => {
    // Valor calculado aparte con md5sum sobre la cadena escrita a mano.
    expect(firma({ method: "jimi.user.device.location.list", timestamp: "2026-11-06 14:39:26", app_key: "KEY", sign_method: "md5", v: "1.0", format: "json" }, "SEC"))
      .toBe("703ADD77428F703F75B42CA785A8726A");
  });

  it("no depende del orden en que se pasan los parámetros", () => {
    expect(firma({ b: "2", a: "1" }, "s")).toBe(firma({ a: "1", b: "2" }, "s"));
  });

  it("la hora va en UTC, «yyyy-MM-dd HH:mm:ss»", () => {
    expect(marcaDeTiempo(new Date(T0))).toBe("2026-11-06 14:39:26");
  });

  it("el cuerpo lleva los parámetros comunes y su firma", () => {
    const q = cuerpoFirmado(CONFIG, { method: "jimi.user.device.location.list" }, new Date(T0));
    expect(q).toMatchObject({ app_key: "KEY", sign_method: "md5", v: "1.0", format: "json", timestamp: "2026-11-06 14:39:26", sign: "703ADD77428F703F75B42CA785A8726A" });
    expect(JSON.stringify(q)).not.toContain("SEC");
  });
});

describe("la configuración", () => {
  it("sin alguna de las cuatro variables no hay TrackSolid", () => {
    const todas = { TRACKSOLID_APP_KEY: "k", TRACKSOLID_APP_SECRET: "s", TRACKSOLID_ACCOUNT: "a", TRACKSOLID_PASSWORD_MD5: "ABC" };
    expect(configDeTracksolid(todas)).toEqual({ appKey: "k", appSecret: "s", cuenta: "a", claveMd5: "abc" });
    for (const k of Object.keys(todas)) expect(configDeTracksolid({ ...todas, [k]: "" })).toBeNull();
    expect(configDeTracksolid({})).toBeNull();
  });

  it("un error de TrackSolid no lleva las llaves, ni el de red", async () => {
    const e1 = await llamaTracksolid(CONFIG, { method: "x" }, { fetch: async () => ({ json: async () => ({ code: 1001, message: "bad sign" }) }) }).catch((e: ErrorDeTracksolid) => e) as ErrorDeTracksolid;
    const e2 = await llamaTracksolid(CONFIG, { method: "x" }, { fetch: async () => { throw new Error("fetch failed app_key=KEY SEC"); } }).catch((e: ErrorDeTracksolid) => e) as ErrorDeTracksolid;
    for (const e of [e1, e2]) {
      expect(e).toBeInstanceOf(ErrorDeTracksolid);
      expect(String(e.message)).not.toMatch(/SEC|KEY|abc123/);
    }
    expect(e1.codigo).toBe(1001);
    expect(e2.codigo).toBe(-2);
  });
});

describe("el token", () => {
  it("sin token guardado pide uno, lo guarda con su caducidad y manda la cuenta y la clave", async () => {
    const { almacen, e } = almacenFalso();
    const jimi = jimiFalso({ "jimi.oauth.token.get": TOKEN_OK });
    expect(await tokenDeTracksolid({ config: CONFIG, almacen, fetch: jimi.fetch, ahora: () => T0, espera: sinEspera })).toBe("tok-1");
    expect(e.token).toEqual({ accessToken: "tok-1", refreshToken: "ref-1", caducaEn: T0 + 7200_000 });
    const p = jimi.llamadas[0].params;
    expect([p.get("user_id"), p.get("user_pwd_md5"), p.get("expires_in")]).toEqual(["cuenta", "abc123", "7200"]);
  });

  it("con uno vigente NO llama a TrackSolid — ni una vez en cien", async () => {
    const { almacen } = almacenFalso({ token: { accessToken: "guardado", refreshToken: "r", caducaEn: T0 + 3600_000 } });
    const jimi = jimiFalso({});
    for (let i = 0; i < 100; i++) expect(await tokenDeTracksolid({ config: CONFIG, almacen, fetch: jimi.fetch, ahora: () => T0 + i * 1000, espera: sinEspera })).toBe("guardado");
    expect(jimi.llamadas).toHaveLength(0);
  });

  it("uno caducado (o a punto: dentro del margen) no se usa: se pide otro", async () => {
    for (const caducaEn of [T0 - 1, T0 + MARGEN_DE_CADUCIDAD_MS - 1]) {
      const { almacen } = almacenFalso({ token: { accessToken: "viejo", refreshToken: "r", caducaEn } });
      const jimi = jimiFalso({ "jimi.oauth.token.get": TOKEN_OK });
      expect(await tokenDeTracksolid({ config: CONFIG, almacen, fetch: jimi.fetch, ahora: () => T0, espera: sinEspera })).toBe("tok-1");
    }
  });

  it("cerca de caducar se renueva con refresh; si el refresh falla, sigue con el que hay", async () => {
    const cerca = { accessToken: "actual", refreshToken: "ref", caducaEn: T0 + 10 * 60_000 };
    const a = almacenFalso({ token: cerca });
    const bien = jimiFalso({ "jimi.oauth.token.refresh": () => ({ code: 0, result: { accessToken: "renovado", refreshToken: "ref2", expiresIn: 7200 } }) });
    expect(await tokenDeTracksolid({ config: CONFIG, almacen: a.almacen, fetch: bien.fetch, ahora: () => T0, espera: sinEspera })).toBe("renovado");
    expect(bien.llamadas[0].params.get("refresh_token")).toBe("ref");
    expect(a.e.token?.caducaEn).toBe(T0 + 7200_000);

    const b = almacenFalso({ token: cerca });
    const mal = jimiFalso({ "jimi.oauth.token.refresh": () => ({ code: 1006, message: "too frequent" }) });
    expect(await tokenDeTracksolid({ config: CONFIG, almacen: b.almacen, fetch: mal.fetch, ahora: () => T0, espera: sinEspera })).toBe("actual");
    expect(mal.de("jimi.oauth.token.get")).toBe(0);
  });

  it("dos invocaciones a la vez: pide UNA; la otra espera y lee el que guardó la primera", async () => {
    const { almacen } = almacenFalso();
    const jimi = jimiFalso({ "jimi.oauth.token.get": TOKEN_OK });
    const deps = { config: CONFIG, almacen, fetch: jimi.fetch, ahora: () => T0, espera: sinEspera };
    const [a, b] = await Promise.all([tokenDeTracksolid(deps), tokenDeTracksolid(deps)]);
    expect([a, b]).toEqual(["tok-1", "tok-1"]);
    expect(jimi.de("jimi.oauth.token.get")).toBe(1);
  });

  it("si otra invocación pidió hace menos de un minuto y aún no hay token, contesta «ahora no» sin llamar", async () => {
    const { almacen } = almacenFalso({ pedidoEn: T0 - 20_000 });
    const jimi = jimiFalso({ "jimi.oauth.token.get": TOKEN_OK });
    expect(await tokenDeTracksolid({ config: CONFIG, almacen, fetch: jimi.fetch, ahora: () => T0, espera: sinEspera })).toBeNull();
    expect(jimi.llamadas).toHaveLength(0);
  });

  it("1006 y 1005 («demasiado seguido») no lanzan ni se reintentan: «ahora no»", async () => {
    for (const code of [1005, 1006]) {
      const { almacen } = almacenFalso();
      const jimi = jimiFalso({ "jimi.oauth.token.get": () => ({ code, message: "Illegal access, request frequency is too high" }) });
      expect(await tokenDeTracksolid({ config: CONFIG, almacen, fetch: jimi.fetch, ahora: () => T0, espera: sinEspera })).toBeNull();
      expect(jimi.de("jimi.oauth.token.get")).toBe(1);
    }
  });

  it("una clave mala (otro código) sí es un error, y no se guarda nada", async () => {
    const { almacen, e } = almacenFalso();
    const jimi = jimiFalso({ "jimi.oauth.token.get": () => ({ code: 1002, message: "illegal user" }) });
    await expect(tokenDeTracksolid({ config: CONFIG, almacen, fetch: jimi.fetch, ahora: () => T0, espera: sinEspera })).rejects.toMatchObject({ codigo: 1002 });
    expect(e.token).toBeNull();
  });
});

describe("las posiciones y su caché de 30 s", () => {
  const LISTA = () => ({ code: 0, result: [EQUIPO, { imei: "", deviceName: "sin imei" }] });
  let memoria: MemoriaDePosiciones;
  beforeEach(() => { memoria = { ultima: null }; vi.spyOn(console, "warn").mockImplementation(() => {}); });

  it("lee, limpia y guarda; el segundo que pregunta dentro de 30 s no llama a TrackSolid", async () => {
    const { almacen, e } = almacenFalso();
    const jimi = jimiFalso({ "jimi.oauth.token.get": TOKEN_OK, "jimi.user.device.location.list": LISTA });
    let ahora = T0;
    const deps = { config: CONFIG, almacen, fetch: jimi.fetch, ahora: () => ahora, espera: sinEspera, memoria };
    const r1 = await posicionesDeCamiones(deps);
    expect(r1?.atrasado).toBe(false);
    expect(r1?.camiones).toHaveLength(1);
    expect(r1?.camiones[0]).toMatchObject({ imei: EQUIPO.imei, nombre: "MCALLEN FREITHLINER", velocidadKmh: 64, encendido: true, posicionEn: "2026-11-06T14:39:20.000Z" });
    expect(jimi.llamadas.at(-1)!.params.get("target")).toBe("cuenta");
    expect(e.posiciones?.leidoEn).toBe(T0);

    ahora = T0 + CACHE_DE_POSICIONES_MS - 1;
    await posicionesDeCamiones(deps);
    expect(jimi.de("jimi.user.device.location.list")).toBe(1);

    ahora = T0 + CACHE_DE_POSICIONES_MS + 1;
    await posicionesDeCamiones(deps);
    expect(jimi.de("jimi.user.device.location.list")).toBe(2);
    expect(jimi.de("jimi.oauth.token.get")).toBe(1); // el token sigue siendo el mismo
  });

  it("otra instancia (memoria vacía) usa la lectura fresca de la base en vez de llamar", async () => {
    const lectura = { camiones: [camionDesdeJimi(EQUIPO)!], leidoEn: T0 - 5_000 };
    const { almacen } = almacenFalso({ posiciones: lectura });
    const jimi = jimiFalso({});
    const r = await posicionesDeCamiones({ config: CONFIG, almacen, fetch: jimi.fetch, ahora: () => T0, espera: sinEspera, memoria });
    expect(r).toEqual({ ...lectura, atrasado: false });
    expect(jimi.llamadas).toHaveLength(0);
  });

  it("token rechazado (1004): se tira, se pide otro UNA vez y se reintenta", async () => {
    const { almacen, e } = almacenFalso({ token: { accessToken: "revocado", refreshToken: "r", caducaEn: T0 + 3600_000 } });
    const jimi = jimiFalso({
      "jimi.oauth.token.get": TOKEN_OK,
      "jimi.user.device.location.list": (p) => (p.get("access_token") === "revocado" ? { code: 1004, message: "invalid token" } : LISTA()),
    });
    const r = await posicionesDeCamiones({ config: CONFIG, almacen, fetch: jimi.fetch, ahora: () => T0, espera: sinEspera, memoria });
    expect(r?.camiones).toHaveLength(1);
    expect(e.token?.accessToken).toBe("tok-1");
    expect(jimi.de("jimi.oauth.token.get")).toBe(1);
  });

  it("si TrackSolid falla, sirve lo último que tenía, marcado como atrasado; sin nada previo, null", async () => {
    const vieja = { camiones: [camionDesdeJimi(EQUIPO)!], leidoEn: T0 - 5 * 60_000 };
    const caido = jimiFalso({ "jimi.oauth.token.get": TOKEN_OK, "jimi.user.device.location.list": () => ({ code: -1, message: "system busy" }) });
    const con = almacenFalso({ posiciones: vieja });
    expect(await posicionesDeCamiones({ config: CONFIG, almacen: con.almacen, fetch: caido.fetch, ahora: () => T0, espera: sinEspera, memoria })).toEqual({ ...vieja, atrasado: true });
    const sin = almacenFalso();
    expect(await posicionesDeCamiones({ config: CONFIG, almacen: sin.almacen, fetch: caido.fetch, ahora: () => T0, espera: sinEspera, memoria: { ultima: null } })).toBeNull();
  });

  it("sin token disponible (1006) tampoco lanza: lo último, atrasado", async () => {
    const vieja = { camiones: [], leidoEn: T0 - 90_000 };
    const { almacen } = almacenFalso({ posiciones: vieja });
    const jimi = jimiFalso({ "jimi.oauth.token.get": () => ({ code: 1006, message: "too frequent" }) });
    expect(await posicionesDeCamiones({ config: CONFIG, almacen, fetch: jimi.fetch, ahora: () => T0, espera: sinEspera, memoria })).toEqual({ ...vieja, atrasado: true });
    expect(jimi.de("jimi.user.device.location.list")).toBe(0);
  });
});

describe("unidades y fechas", () => {
  it("km/h a mph, al entero", () => {
    expect(kmhAMph(64)).toBe(40);
    expect(kmhAMph("100")).toBe(62);
    expect(kmhAMph(8)).toBe(5);
    expect(kmhAMph(0)).toBe(0);
    for (const raro of [null, undefined, "", "x", -5, NaN]) expect(kmhAMph(raro as number)).toBe(0);
  });

  it("la hora de Jimi es UTC", () => {
    expect(fechaDeJimi("2026-11-06 14:39:21")).toBe("2026-11-06T14:39:21.000Z");
    for (const mala of [null, "", "ayer", "2026-11-06"]) expect(fechaDeJimi(mala)).toBeNull();
  });

  it("se enseña en la hora local de la empresa: solo la hora si es de hoy, con el día si no", () => {
    // 14:39 UTC del 6 de noviembre = 8:39 AM en el Valle (CST).
    expect(horaLocal("2026-11-06T14:39:21.000Z", T0)).toBe("8:39 AM");
    expect(horaLocal("2026-10-26T23:00:41.000Z", T0)).toBe("Oct 26, 6:00 PM");
    expect(horaLocal(null, T0)).toBe("—");
  });

  it("«hace cuánto», de minutos a días", () => {
    expect([0.4, 4, 59, 180, 14400].map((m) => haceCuanto(m, t))).toEqual(["just now", "4 min ago", "59 min ago", "3 h ago", "10 d ago"]);
  });

  it("un equipo con 0,0 no tiene posición, pero sigue saliendo (para poder enlazarlo)", () => {
    const c = camionDesdeJimi({ imei: "123456789012345", deviceName: "X", lat: 0, lng: 0 })!;
    expect([c.lat, c.lng, c.contactoEn, c.encendido]).toEqual([null, null, null, null]);
    expect(camionDesdeJimi({ deviceName: "sin imei" })).toBeNull();
  });
});

describe("qué está haciendo el camión — y qué es «sin señal»", () => {
  const camion = (e: Record<string, unknown>): CamionDeTracksolid => ({ ...camionDesdeJimi({ imei: "863240070021389", deviceName: "CAMION", lat: 26.2, lng: -98.2, ...e })!, choferId: null, chofer: null, tienda: null });
  const min = (n: number) => marcaDeTiempo(new Date(T0 - n * 60_000));

  it("en movimiento, detenido con motor, estacionado", () => {
    expect(estadoDelCamion(camion({ speed: "64", accStatus: "1", gpsTime: min(0), hbTime: min(2) }), T0)).toBe("moving");
    expect(estadoDelCamion(camion({ speed: "0", accStatus: "1", gpsTime: min(1), hbTime: min(1) }), T0)).toBe("idling");
    expect(estadoDelCamion(camion({ speed: "2", accStatus: "1", gpsTime: min(1), hbTime: min(1) }), T0)).toBe("idling"); // 1 mph: baile del GPS
    expect(estadoDelCamion(camion({ speed: "0", accStatus: "0", gpsTime: min(1), hbTime: min(1) }), T0)).toBe("parked");
  });

  it("la frontera: 15 minutos sin reportar es señal; un poco más, no", () => {
    expect(estadoDelCamion(camion({ accStatus: "0", gpsTime: min(MINUTOS_SIN_SENAL), hbTime: null }), T0)).toBe("parked");
    expect(estadoDelCamion(camion({ accStatus: "0", gpsTime: min(MINUTOS_SIN_SENAL + 0.1), hbTime: null }), T0)).toBe("stale");
    expect(estadoDelCamion(camion({ gpsTime: null, hbTime: null }), T0)).toBe("stale");
  });

  it("caso real: estacionado hace 3 días pero latiendo — NO es sin señal, y lo dice", () => {
    // INTERNATIONAL PHARR el 2026-11-06: último punto el día 3, latido hace 5 segundos, motor apagado.
    const c = camion({ speed: "0", accStatus: "0", gpsTime: "2026-11-03 16:06:35", hbTime: "2026-11-06 14:39:21" });
    const txt = textoDelCamion(c, T0, t);
    expect(txt.estado).toBe("parked");
    expect(txt.lineas[0]).toBe("Parked · engine off");
    expect(txt.lineas).toContain("Last reported just now (8:39 AM)");
    expect(txt.lineas).toContain("Hasn't moved since Nov 3, 10:06 AM");
  });

  it("caso real: 10 días callado — sin señal, dice desde cuándo y no presume de velocidad", () => {
    // BROWNSVILLE el 2026-11-06: se apagó el 26 de octubre con el motor encendido y a 7 km/h.
    const c = camion({ speed: "7", accStatus: "1", gpsTime: "2026-10-26 22:58:10", hbTime: "2026-10-26 23:00:41" });
    const txt = textoDelCamion(c, T0, t);
    expect(txt.estado).toBe("stale");
    expect(txt.lineas[0]).toBe("No signal since Oct 26, 6:00 PM (11 d ago)");
    expect(txt.lineas[1]).toMatch(/last known position/);
    expect(txt.etiqueta).toBe("CAMION · no signal");
    expect(txt.lineas.join(" ")).not.toMatch(/mph/);
  });

  it("enlazado: el nombre del chofer manda en la etiqueta; la velocidad va en mph", () => {
    const c = { ...camion({ speed: "64", accStatus: "1", gpsTime: min(0), hbTime: min(0) }), choferId: "u1", chofer: "Juan Pérez", tienda: "RDZ Pharr" };
    const txt = textoDelCamion(c, T0, t);
    expect(txt.etiqueta).toBe("Juan Pérez · 40 mph");
    expect(txt.titulo).toBe("CAMION · Juan Pérez");
    expect(txt.lineas[0]).toBe("Moving · 40 mph");
    expect(txt.lineas).toEqual(expect.arrayContaining(["Driver: Juan Pérez", "Home store: RDZ Pharr"]));
  });

  it("en español", () => {
    const es = (_en: string, e: string) => e;
    const c = camion({ speed: "0", accStatus: "0", gpsTime: min(3), hbTime: min(3) });
    expect(textoDelCamion(c, T0, es, "es").lineas[0]).toBe("Estacionado · motor apagado");
  });
});

describe("quién puede", () => {
  const con = ["deliveries"];
  it("ver los camiones: los que ven la planificación del Gestor (Entregas + route_plan)", () => {
    expect(puedeVerCamiones({ role: "admin", module_access: null })).toBe(true);
    expect(puedeVerCamiones({ role: "logistics", module_access: con })).toBe(true);
    // Un permiso suelto concedido por un admin también abre el Gestor.
    expect(puedeVerCamiones({ role: "manager", permissions: ["route_plan"], module_access: con })).toBe(true);
    for (const role of ["sales", "warehouse", "driver", "manager", "accounting"] as const) {
      expect(puedeVerCamiones({ role, permissions: [], module_access: con })).toBe(false);
    }
    // Logística sin el módulo de Entregas no entra al Gestor: tampoco aquí.
    expect(puedeVerCamiones({ role: "logistics", module_access: ["timetracker"] })).toBe(false);
    expect(puedeVerCamiones(null)).toBe(false);
  });

  it("enlazar rastreadores: solo el admin", () => {
    expect(puedeEnlazarCamiones({ role: "admin" })).toBe(true);
    for (const role of ["logistics", "manager", "driver"]) expect(puedeEnlazarCamiones({ role })).toBe(false);
    expect(puedeEnlazarCamiones(null)).toBe(false);
  });
});

describe("los enlaces rastreador → chofer / tienda", () => {
  const UUID = "acf43ad5-0000-4000-8000-000000000000";
  it("valida lo que llega de Ajustes", () => {
    expect(enlaceValido({ imei: "863240070017882", driver_id: UUID, home_store: " RDZ Pharr ", device_name: "X" }))
      .toEqual({ ok: true, enlace: { imei: "863240070017882", driver_id: UUID, home_store: "RDZ Pharr" }, nombre: "X" });
    expect(enlaceValido({ imei: "863240070017882", driver_id: "", home_store: null })).toMatchObject({ ok: true, enlace: { driver_id: null, home_store: null } });
    for (const malo of [null, {}, { imei: "abc" }, { imei: "863240070017882", driver_id: "no-uuid" }, { imei: "863240070017882", home_store: "x".repeat(121) }, { imei: "1; drop table" }]) {
      expect(enlaceValido(malo).ok).toBe(false);
    }
  });

  it("el camión enlazado lleva el nombre de su chofer; el que no, sale igual", () => {
    const a = camionDesdeJimi(EQUIPO)!, b = camionDesdeJimi({ ...EQUIPO, imei: "863240070018328", deviceName: "EDINBURG PETERBIL" })!;
    const r = conEnlaces([a, b], [{ imei: a.imei, driver_id: UUID, home_store: "RDZ McAllen" }], new Map([[UUID, "Juan Pérez"]]));
    expect(r[0]).toMatchObject({ choferId: UUID, chofer: "Juan Pérez", tienda: "RDZ McAllen" });
    expect(r[1]).toMatchObject({ nombre: "EDINBURG PETERBIL", choferId: null, chofer: null, tienda: null });
    // Chofer borrado o que no se pudo leer: sin chofer, pero la tienda se queda.
    expect(conEnlaces([a], [{ imei: a.imei, driver_id: UUID, home_store: "RDZ McAllen" }], new Map())[0]).toMatchObject({ choferId: null, chofer: null, tienda: "RDZ McAllen" });
  });
});

describe("la marca y el refresco", () => {
  it("sin señal se ve distinto: gris, borde a rayas y «!»", () => {
    const viva = svgDelCamion("#e11d48", "moving"), muerta = svgDelCamion("#e11d48", "stale");
    expect(viva).toContain('fill="#e11d48"');
    expect(viva).not.toContain("stroke-dasharray");
    expect(muerta).not.toContain("#e11d48");
    expect(muerta).toContain("stroke-dasharray");
    expect(muerta).toContain(">!<");
  });

  it("la tarjeta escapa lo que venga en el nombre", () => {
    const html = tarjetaDelCamion({ titulo: `<img src=x onerror="a()">`, lineas: ["a & b"], estado: "parked" });
    expect(html).not.toContain("<img");
    expect(html).toContain("a &amp; b");
  });

  it("con la pestaña oculta no se pregunta; visible, una vez por minuto", () => {
    expect(tocaRefrescar(false, null, T0)).toBe(false);
    expect(tocaRefrescar(false, T0 - 10 * 60_000, T0)).toBe(false);
    expect(tocaRefrescar(true, null, T0)).toBe(true);
    expect(tocaRefrescar(true, T0 - 59_000, T0)).toBe(false);
    expect(tocaRefrescar(true, T0 - 60_000, T0)).toBe(true);
  });
});
