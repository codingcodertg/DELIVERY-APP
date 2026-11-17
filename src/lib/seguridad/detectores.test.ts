import { describe, it, expect } from "vitest";
import {
  decideBloqueoIp, detectaApiDenegadas, detectaExportaciones, detectaImpersonacionFueraDeHorario, detectaLatidoCron,
  detectaLoginsPorIdentificador, detectaLoginsPorIp, detectaNuevosAdmins, detectaPaisNuevo, detectaRatelimitPorIp,
  ejecutaDetectores, horaCT, sinDuplicar, UMBRALES, type CambioDeRol, type EventoLeido,
} from "./detectores";

const AHORA = Date.parse("2026-11-17T18:00:00Z"); // 12:00 en Texas (CST)
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();

function ev(p: Partial<EventoLeido> & { categoria: string }): EventoLeido {
  return {
    ts: hace(1), severidad: 1, usuario_id: null, rol: null, ip: null, ip_pais: null, metodo: null, ruta: null,
    estado: null, objetivo_tipo: null, objetivo_id: null, filas: null, meta: null, ...p,
  };
}
const fallo = (objetivo: string | null, ip: string, min = 1) =>
  ev({ categoria: "auth", metodo: "login", estado: 401, objetivo_tipo: "identificador", objetivo_id: objetivo, ip, ts: hace(min) });

describe("login fallido por identificador", () => {
  it("avisa con 10 fallos contra la misma cuenta en 10 min, y no con 9", () => {
    const diez = Array.from({ length: 10 }, (_, i) => fallo("a".repeat(64), "1.2.3.4", i % 9));
    const h = detectaLoginsPorIdentificador(diez, AHORA);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ detector: "login-fallido-identificador", severidad: 4 });
    expect(h[0].proponeBloqueoIp).toBeUndefined();
    expect(detectaLoginsPorIdentificador(diez.slice(1), AHORA)).toHaveLength(0);
  });
  it("no cuenta los fallos viejos (fuera de la ventana de 10 min)", () => {
    const viejos = Array.from({ length: 12 }, () => fallo("b".repeat(64), "1.2.3.4", 30));
    expect(detectaLoginsPorIdentificador(viejos, AHORA)).toHaveLength(0);
  });
  it("no cuenta fallos de otro identificador por separado", () => {
    const mezcla = [...Array.from({ length: 6 }, () => fallo("c".repeat(64), "1.1.1.1")), ...Array.from({ length: 6 }, () => fallo("d".repeat(64), "1.1.1.1"))];
    expect(detectaLoginsPorIdentificador(mezcla, AHORA)).toHaveLength(0);
  });
});

describe("login fallido por IP", () => {
  it("con 20 fallos desde una IP propone bloquear esa IP; con 19 no", () => {
    const veinte = Array.from({ length: 20 }, (_, i) => fallo(`x${i}`, "9.9.9.9"));
    const h = detectaLoginsPorIp(veinte, AHORA);
    expect(h).toEqual([expect.objectContaining({ detector: "login-fallido-ip", severidad: 4, ip: "9.9.9.9", proponeBloqueoIp: true })]);
    expect(detectaLoginsPorIp(veinte.slice(1), AHORA)).toHaveLength(0);
  });
});

describe("país nuevo", () => {
  const sesion = (usuario: string, pais: string, min = 2) =>
    ev({ categoria: "auth", metodo: "sesion", usuario_id: usuario, ip_pais: pais, ts: hace(min) });

  it("avisa cuando la persona no usó ese país en 30 días", () => {
    const historial = new Map([["u1", new Set(["US"])]]);
    const h = detectaPaisNuevo([sesion("u1", "MX")], historial, AHORA);
    expect(h).toEqual([expect.objectContaining({ detector: "pais-nuevo", severidad: 3, usuario_id: "u1" })]);
  });
  it("no avisa si ya lo usó", () => {
    expect(detectaPaisNuevo([sesion("u1", "US")], new Map([["u1", new Set(["US"])]]), AHORA)).toHaveLength(0);
  });
  it("no avisa a quien no tiene ningún historial (su primera entrada no es un cambio)", () => {
    expect(detectaPaisNuevo([sesion("u2", "MX")], new Map(), AHORA)).toHaveLength(0);
  });
});

describe("exportaciones", () => {
  const exp = (usuario: string, filas: number, min = 5) => ev({ categoria: "export", usuario_id: usuario, filas, ts: hace(min) });
  it("más de 500 filas en una hora: sev 4", () => {
    const h = detectaExportaciones([exp("u1", 300), exp("u1", 201)], AHORA);
    expect(h.map((x) => x.detector)).toEqual(["exportacion-volumen"]);
    expect(h[0].severidad).toBe(4);
  });
  it("exactamente 500 no alcanza", () => {
    expect(detectaExportaciones([exp("u1", UMBRALES.exportFilasPorHora)], AHORA)).toHaveLength(0);
  });
  it("más de 5 exportaciones en una hora: sev 4, aunque sean pocas filas", () => {
    const seis = Array.from({ length: 6 }, () => exp("u1", 1));
    expect(detectaExportaciones(seis, AHORA).map((x) => x.detector)).toEqual(["exportacion-frecuencia"]);
    expect(detectaExportaciones(seis.slice(1), AHORA)).toHaveLength(0);
  });
});

describe("nuevo admin", () => {
  const cambio = (detail: string, target = "t1", min = 2): CambioDeRol => ({ ts: hace(min), actor_id: "a1", target_id: target, detail });
  it("un cambio a admin es sev 5", () => {
    expect(detectaNuevosAdmins([cambio("driver → admin")], AHORA)).toEqual([expect.objectContaining({ detector: "admin-nuevo", severidad: 5, usuario_id: "t1" })]);
  });
  it("un cambio a otro rol no es admin", () => {
    expect(detectaNuevosAdmins([cambio("driver → manager")], AHORA)).toHaveLength(0);
  });
  it("dos cambios a la misma cuenta dan una sola alerta", () => {
    expect(detectaNuevosAdmins([cambio("x → admin"), cambio("x → admin", "t1", 1)], AHORA)).toHaveLength(1);
  });
});

describe("entrar como otra persona", () => {
  it("hora de Texas: 12:00 dentro; 03:00 y 22:00 fuera", () => {
    expect(horaCT(AHORA)).toBe(12);
    expect(horaCT(Date.parse("2026-11-17T09:00:00Z"))).toBe(3); // 03:00 CST
    expect(horaCT(Date.parse("2026-11-18T04:00:00Z"))).toBe(22); // 22:00 CST
  });
  const MIN = 60_000;
  it("avisa fuera de 6:00–21:00 hora de Texas, sev 4", () => {
    const noche = Date.parse("2026-11-18T04:30:00Z"); // 22:30 CST
    const e = ev({ categoria: "impersonation", usuario_id: "adm", ts: new Date(noche - 2 * MIN).toISOString(), meta: { kind: "start" } });
    const h = detectaImpersonacionFueraDeHorario([e], noche);
    expect(h).toEqual([expect.objectContaining({ detector: "impersonacion-horario", severidad: 4 })]);
  });
  it("dentro del horario no avisa, y un «fin» tampoco", () => {
    const dia = AHORA; // 12:00 CST
    const dentro = ev({ categoria: "impersonation", usuario_id: "adm", ts: new Date(dia - 2 * MIN).toISOString(), meta: { kind: "start" } });
    expect(detectaImpersonacionFueraDeHorario([dentro], dia)).toHaveLength(0);
    const noche = Date.parse("2026-11-18T04:30:00Z");
    const fin = ev({ categoria: "impersonation", ts: new Date(noche - 2 * MIN).toISOString(), meta: { kind: "end" } });
    expect(detectaImpersonacionFueraDeHorario([fin], noche)).toHaveLength(0);
  });
});

describe("peticiones denegadas y límite de peticiones", () => {
  it("más de 30 denegadas por persona en 10 min: sev 3", () => {
    const muchas = Array.from({ length: 31 }, () => ev({ categoria: "api_denied", usuario_id: "u9", ts: hace(3) }));
    expect(detectaApiDenegadas(muchas, AHORA)).toEqual([expect.objectContaining({ detector: "api-denegada", severidad: 3 })]);
    expect(detectaApiDenegadas(muchas.slice(1), AHORA)).toHaveLength(0);
  });
  it("50 rechazos del límite desde una IP: sev 3", () => {
    const rech = Array.from({ length: 50 }, () => ev({ categoria: "ratelimit", ip: "5.5.5.5", ts: hace(2) }));
    expect(detectaRatelimitPorIp(rech, AHORA)).toEqual([expect.objectContaining({ detector: "ratelimit-ip", severidad: 3, ip: "5.5.5.5" })]);
    expect(detectaRatelimitPorIp(rech.slice(1), AHORA)).toHaveLength(0);
  });
});

describe("latido del cron del Time Tracker", () => {
  it("sin latido en 15 min avisa; con uno reciente, no", () => {
    expect(detectaLatidoCron([], AHORA)).toEqual([expect.objectContaining({ detector: "latido-cron", severidad: 3 })]);
    const latido = ev({ categoria: "cron", ruta: "tt-cron", ts: hace(4) });
    expect(detectaLatidoCron([latido], AHORA)).toHaveLength(0);
  });
  it("un latido viejo (más de 15 min) cuenta como ausente", () => {
    const viejo = ev({ categoria: "cron", ruta: "tt-cron", ts: hace(20) });
    expect(detectaLatidoCron([viejo], AHORA)).toHaveLength(1);
  });
});

describe("decideBloqueoIp: nunca cierra a un admin ni a una red compartida", () => {
  const ip = "7.7.7.7";
  it("bloquea una IP sin nadie conocido detrás", () => {
    expect(decideBloqueoIp({ ip, eventos: [fallo("h", ip)], ahora: AHORA })).toEqual({ aplica: true });
  });
  it("no bloquea si entró un admin desde esa IP en la última media hora", () => {
    const admin = ev({ categoria: "auth", metodo: "sesion", ip, rol: "admin", usuario_id: "adm", ts: hace(20) });
    const r = decideBloqueoIp({ ip, eventos: [admin], ahora: AHORA });
    expect(r.aplica).toBe(false);
  });
  it("no bloquea una red compartida (dos personas entraron desde la IP)", () => {
    const dos = [
      ev({ categoria: "auth", metodo: "sesion", ip, usuario_id: "p1", rol: "driver", ts: hace(3) }),
      ev({ categoria: "auth", metodo: "sesion", ip, usuario_id: "p2", rol: "sales", ts: hace(4) }),
    ];
    expect(decideBloqueoIp({ ip, eventos: dos, ahora: AHORA }).aplica).toBe(false);
  });
});

describe("deduplicación de una hora", () => {
  it("quita lo que ya tiene alerta abierta con el mismo detector y sujeto, y repetidos en la tanda", () => {
    const hallazgos = [
      { detector: "x", severidad: 4 as const, sujeto: "s1", usuario_id: null, ip: null, resumen: "" },
      { detector: "x", severidad: 4 as const, sujeto: "s1", usuario_id: null, ip: null, resumen: "" },
      { detector: "x", severidad: 4 as const, sujeto: "s2", usuario_id: null, ip: null, resumen: "" },
      { detector: "y", severidad: 3 as const, sujeto: "s1", usuario_id: null, ip: null, resumen: "" },
    ];
    const nuevos = sinDuplicar(hallazgos, [{ detector: "y", sujeto: "s1" }]);
    expect(nuevos.map((h) => `${h.detector}:${h.sujeto}`)).toEqual(["x:s1", "x:s2"]);
  });
});

describe("ejecutaDetectores", () => {
  it("con un rastro tranquilo y latido presente no produce nada", () => {
    const tranquilo = [ev({ categoria: "cron", ruta: "tt-cron", ts: hace(2) }), ev({ categoria: "auth", metodo: "sesion", usuario_id: "u", ip_pais: "US", ts: hace(3) })];
    const h = ejecutaDetectores({ eventos: tranquilo, cambiosDeRol: [], historialPais: new Map([["u", new Set(["US"])]]), ahora: AHORA });
    expect(h).toEqual([]);
  });
});
