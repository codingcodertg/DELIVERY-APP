import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  decisionReabrir, parseResumeMark, esHuerfana, ultimoLatidoDe, jornadaDe,
  CRON_CLOSE_NOTE, PAGE_ORPHAN_CLOSE_NOTE, RESUME_MAX_MS, LATIDO_MAX_MS,
} from "./live-session";

// El incidente, con sus horas reales (Chicago): arranque 10:54:31, último latido 13:49:21,
// crash, «Reload app», y la persona siguió hasta las 14:40. 51 minutos perdidos.
//
// Lo que se alimenta aquí es **la entrada que la página produce de verdad en ese punto**: la
// fila está VIVA y su `live_note` es el del último tick. La primera versión de esta prueba le
// daba una fila ya cerrada con la nota de cierre puesta —algo que la página escribe dos líneas
// después— y por eso pasaba mientras el arreglo no hacía nada.
const dia = (iso: string) => new Date(iso).getTime();
const ARRANQUE = dia("2026-09-12T15:54:31Z");   // 10:54 CDT
const ULTIMO_LATIDO = dia("2026-09-12T18:49:21Z"); // 13:49 CDT
const RECARGA = dia("2026-09-12T19:40:00Z");    // 14:40 CDT

const filaViva = (extra: Record<string, unknown> = {}) => ({
  id: "s1", employeeUid: "u1", isLive: true, liveNote: "active", startMs: ARRANQUE, ...extra,
});
const marca = (at: number, sessionId = "s1") =>
  parseResumeMark(JSON.stringify({ sessionId, at }), RECARGA, Number.POSITIVE_INFINITY);

const decidir = (extra: Record<string, unknown> = {}) => decisionReabrir({
  fila: filaViva(), me: "u1", mark: marca(ULTIMO_LATIDO),
  evidenciaLocal: false, otrasVivas: [], contexto: "tras-carga", ahora: RECARGA, ...extra,
});

describe("el incidente: crash a las 13:49, recarga a las 14:40", () => {
  it("la fila es huérfana y la marca tiene 51 min — y aun así se adopta", () => {
    expect(esHuerfana({ startMs: ARRANQUE, endMs: ULTIMO_LATIDO }, RECARGA)).toBe(true);
    expect(RECARGA - ULTIMO_LATIDO).toBeGreaterThan(RESUME_MAX_MS);
    expect(decidir()).toEqual({ reabrir: true });
  });

  it("con el tope viejo de la marca esto era imposible, y esa era la ventana vacía", () => {
    // `esHuerfana` mide desde `endMs`; la marca la escribe el MISMO tick que escribe `endMs`.
    // Mismo ancla y mismo umbral: cuando la fila es huérfana, la marca ya caducó. Siempre.
    expect(RESUME_MAX_MS).toBe(LATIDO_MAX_MS);
    expect(parseResumeMark(JSON.stringify({ sessionId: "s1", at: ULTIMO_LATIDO }), RECARGA)).toBeNull();
  });

  it("y con la fila tal como la página la tiene: viva y con la nota del tick", () => {
    // El control del no-op: si la condición volviera a exigir una nota de cierre, esta entrada
    // —la única que la página produce ahí— la rechazaría.
    expect(filaViva().isLive).toBe(true);
    expect(filaViva().liveNote).toBe("active");
    expect(decidir()).toEqual({ reabrir: true });
  });
});

describe("la jornada es el límite, y al día siguiente no", () => {
  it("una fila de ayer no se adopta: sería juntar dos jornadas", () => {
    const ayer = ARRANQUE - 24 * 3600_000;
    expect(jornadaDe(ayer)).not.toBe(jornadaDe(RECARGA));
    expect(decidir({ fila: filaViva({ startMs: ayer }) })).toEqual({ reabrir: false, motivo: "otra-jornada" });
  });

  it("y una del mismo día sí, aunque hayan pasado horas", () => {
    expect(jornadaDe(ARRANQUE)).toBe(jornadaDe(RECARGA));
    expect(decidir()).toEqual({ reabrir: true });
  });

  it("sin hora de arranque cae a la de la marca, y si tampoco hay, no se adopta", () => {
    expect(decidir({ fila: filaViva({ startMs: null }) })).toEqual({ reabrir: true }); // la marca es de hoy
    expect(decidir({ fila: filaViva({ startMs: null }), mark: null }))
      .toEqual({ reabrir: false, motivo: "sin-marca" });
  });
});

describe("lo que sigue sin adoptarse tras una carga", () => {
  it("un Stop, aunque la fila esté cerrada del todo", () => {
    expect(decidir({ fila: filaViva({ isLive: false, liveNote: null }) }))
      .toEqual({ reabrir: false, motivo: "la-cerro-una-persona" });
  });

  it("pero una que cerró el cron mientras no estábamos, sí", () => {
    expect(decidir({ fila: filaViva({ isLive: false, liveNote: CRON_CLOSE_NOTE }) })).toEqual({ reabrir: true });
    expect(decidir({ fila: filaViva({ isLive: false, liveNote: PAGE_ORPHAN_CLOSE_NOTE }) })).toEqual({ reabrir: true });
  });

  it("una marca de otra sesión, o ninguna", () => {
    expect(decidir({ mark: marca(ULTIMO_LATIDO, "s9") })).toEqual({ reabrir: false, motivo: "sin-marca" });
    expect(decidir({ mark: null })).toEqual({ reabrir: false, motivo: "sin-marca" });
  });

  it("la fila de otra persona, o con otra viva al lado", () => {
    expect(decidir({ me: "u2" })).toEqual({ reabrir: false, motivo: "no-es-mia" });
    expect(decidir({ otrasVivas: ["s2"] })).toEqual({ reabrir: false, motivo: "otra-viva" });
  });
});

describe("el caso sin red no se toca: D-197 sigue exigiendo el tick", () => {
  const sinRed = (extra: Record<string, unknown> = {}) => decisionReabrir({
    fila: { id: "s1", employeeUid: "u1", isLive: false, liveNote: CRON_CLOSE_NOTE },
    me: "u1", mark: marca(RECARGA - 60_000), evidenciaLocal: true, otrasVivas: [],
    contexto: "sin-red", ahora: RECARGA, ...extra,
  });

  it("con tick se reabre, sin tick no", () => {
    expect(sinRed()).toEqual({ reabrir: true });
    expect(sinRed({ evidenciaLocal: false })).toEqual({ reabrir: false, motivo: "sin-evidencia-local" });
  });

  it("y una fila viva no es su caso: allí ya la había cerrado alguien", () => {
    expect(sinRed({ fila: { id: "s1", employeeUid: "u1", isLive: true, liveNote: "active" } }))
      .toEqual({ reabrir: false, motivo: "sigue-viva" });
  });

  it("sin contexto se comporta como `sin-red`, que es la dirección conservadora", () => {
    const d = decisionReabrir({
      fila: { id: "s1", employeeUid: "u1", isLive: false, liveNote: CRON_CLOSE_NOTE },
      me: "u1", mark: marca(RECARGA - 60_000), evidenciaLocal: false, otrasVivas: [],
    });
    expect(d).toEqual({ reabrir: false, motivo: "sin-evidencia-local" });
  });
});

describe("el tramo sin latidos no se inventa", () => {
  it("el ancla es el último latido", () => {
    expect(ultimoLatidoDe({ startMs: ARRANQUE, endMs: ULTIMO_LATIDO })).toBe(ULTIMO_LATIDO);
  });

  it("y la pantalla adelanta el arranque en vez de contar el hueco", () => {
    const codigo = readFileSync("src/app/timetracker/(timetracker)/page.tsx", "utf8")
      .split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(codigo).toContain("startMsRef.current = (mine.startMs || Date.now()) + hueco;");
    expect(codigo).toMatch(/const hueco = Math\.max\(0, Date\.now\(\) - ultimoLatido\);/);
  });
});

describe("el orden en la carga: decidir antes de borrar", () => {
  const codigo = readFileSync("src/app/timetracker/(timetracker)/page.tsx", "utf8")
    .split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");
  const bloque = codigo.slice(codigo.indexOf("if (esHuerfana(mine, Date.now()))"));

  it("se decide antes de borrar la marca", () => {
    const iDecidir = bloque.indexOf('contexto: "tras-carga"');
    const iBorrar = bloque.indexOf("localStorage.removeItem(LS_RESUME)");
    expect(iDecidir).toBeGreaterThan(-1);
    expect(iBorrar).toBeGreaterThan(-1);
    expect(iDecidir).toBeLessThan(iBorrar);
  });

  it("y se le pasa la fila VIVA, no una nota de cierre inventada", () => {
    expect(bloque).toContain("isLive: !!mine.isLive");
    expect(bloque).not.toContain("isLive: false, liveNote: mine.liveNote");
  });

  it("la marca se lee sin el tope de 15 min: aquí manda la jornada", () => {
    expect(bloque).toContain("Number.POSITIVE_INFINITY");
  });
});
