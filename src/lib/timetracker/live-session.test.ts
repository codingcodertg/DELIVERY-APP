import { describe, it, expect } from "vitest";
import {
  LATIDO_MAX_MS, RESUME_MAX_MS,
  ultimoLatidoDe, esHuerfana, cierreHuerfana, huerfanasDe,
  parseResumeMark, markCovers, resumeKey, backoffMs,
  CRON_CLOSE_NOTE, decisionReabrir, tickContinuo,
} from "./live-session";

// D-195. El cronómetro sobrevive a la actualización: el umbral de huérfana sube de 5 a 15
// min, el cierre sigue siendo "en su último latido" con la misma aritmética que tenía la
// página, y la marca de reanudación decide si tras una recarga se sigue contando o se entra en
// el modo mirón de D-096. Todo con datos sintéticos: nada toca la base.

const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 5, 14, 0, 0); // 2026-09-05 14:00Z, arranque de referencia

describe("umbral de huérfana", () => {
  it("es de 15 minutos y es UNA constante que comparten página y cron", () => {
    expect(LATIDO_MAX_MS).toBe(15 * MIN);
    expect(RESUME_MAX_MS).toBe(LATIDO_MAX_MS);
  });

  it("con latido de hace 14:59 sigue viva; con 15:01, huérfana", () => {
    const s = { startMs: T0, endMs: T0 + 30 * MIN };
    expect(esHuerfana(s, T0 + 30 * MIN + 15 * MIN - 1000)).toBe(false);
    expect(esHuerfana(s, T0 + 30 * MIN + 15 * MIN)).toBe(false); // justo en el umbral, no es "más de"
    expect(esHuerfana(s, T0 + 30 * MIN + 15 * MIN + 1000)).toBe(true);
  });

  it("una recarga de segundos o un reinicio de dos minutos no la convierten en huérfana", () => {
    const s = { startMs: T0, endMs: T0 + 30 * MIN };
    expect(esHuerfana(s, T0 + 30 * MIN + 8_000)).toBe(false);
    expect(esHuerfana(s, T0 + 30 * MIN + 2 * MIN)).toBe(false);
  });

  it("sin latido aún (endMs null) cuenta desde el arranque; sin nada, nunca es huérfana", () => {
    expect(ultimoLatidoDe({ startMs: T0, endMs: null })).toBe(T0);
    expect(esHuerfana({ startMs: T0, endMs: null }, T0 + 16 * MIN)).toBe(true);
    expect(ultimoLatidoDe({ startMs: null, endMs: null })).toBe(0);
    expect(esHuerfana({ startMs: null, endMs: null }, T0 + 99 * MIN)).toBe(false);
  });
});

describe("cierre en el último latido (misma aritmética que tenía page.tsx)", () => {
  it("endMs pasa a ser el último latido y la duración va del arranque a ese latido", () => {
    // La noche con la máquina apagada (10,42 h fantasma): arrancó a las 14:00, último latido a
    // las 18:00, se abre al día siguiente. Se pagan 4 h, no 24.
    const s = { startMs: T0, endMs: T0 + 4 * 60 * MIN };
    const c = cierreHuerfana(s);
    expect(c).toEqual({ isLive: false, endMs: T0 + 4 * 60 * MIN, durationSeconds: 4 * 3600 });
  });

  it("nunca da duración negativa, y sin startMs da cero", () => {
    expect(cierreHuerfana({ startMs: T0 + MIN, endMs: T0 }).durationSeconds).toBe(0);
    expect(cierreHuerfana({ startMs: null, endMs: T0 }).durationSeconds).toBe(0);
    expect(cierreHuerfana({ startMs: null, endMs: T0 }).endMs).toBe(T0);
  });

  it("redondea hacia abajo al segundo", () => {
    expect(cierreHuerfana({ startMs: T0, endMs: T0 + 1999 }).durationSeconds).toBe(1);
  });
});

describe("huerfanasDe: el lote del cron, con datos sintéticos", () => {
  it("cierra solo las que llevan más de 15 min sin latido, cada una en su latido", () => {
    const now = T0 + 60 * MIN;
    const vivas = [
      { id: "a", startMs: T0, endMs: now - 10 * MIN },           // viva: latió hace 10 min
      { id: "b", startMs: T0, endMs: now - 16 * MIN },           // huérfana
      { id: "c", startMs: T0 + 5 * MIN, endMs: null },           // nunca latió, arrancó hace 55 min: huérfana
      { id: "d", startMs: null, endMs: null },                   // sin datos: no se toca
    ];
    const out = huerfanasDe(vivas, now);
    expect(out.map((x) => x.sesion.id)).toEqual(["b", "c"]);
    expect(out[0].cierre).toEqual({ isLive: false, endMs: now - 16 * MIN, durationSeconds: 44 * 60 });
    expect(out[1].cierre).toEqual({ isLive: false, endMs: T0 + 5 * MIN, durationSeconds: 0 });
  });

  it("con lista vacía no hace nada", () => {
    expect(huerfanasDe([], T0)).toEqual([]);
  });
});

describe("marca de reanudación", () => {
  it("la clave es por usuario", () => {
    expect(resumeKey("u1")).toBe("tt_resume_u1");
  });

  it("una marca reciente vale; una de hace más de 15 min, no", () => {
    const raw = JSON.stringify({ sessionId: "s1", at: T0 });
    expect(parseResumeMark(raw, T0 + 30_000)).toEqual({ sessionId: "s1", at: T0 });
    expect(parseResumeMark(raw, T0 + 15 * MIN)).toEqual({ sessionId: "s1", at: T0 });
    expect(parseResumeMark(raw, T0 + 15 * MIN + 1)).toBeNull();
  });

  it("JSON roto, forma rara o fecha del futuro → null, sin lanzar", () => {
    expect(parseResumeMark(null, T0)).toBeNull();
    expect(parseResumeMark("{nope", T0)).toBeNull();
    expect(parseResumeMark(JSON.stringify({ sessionId: "", at: T0 }), T0)).toBeNull();
    expect(parseResumeMark(JSON.stringify({ sessionId: "s1" }), T0)).toBeNull();
    expect(parseResumeMark(JSON.stringify({ sessionId: "s1", at: "ayer" }), T0)).toBeNull();
    expect(parseResumeMark(JSON.stringify({ sessionId: "s1", at: T0 + 2 * MIN }), T0)).toBeNull();
  });

  it("solo autoriza a conducir LA sesión que nombra", () => {
    const mark = { sessionId: "s1", at: T0 };
    expect(markCovers(mark, "s1")).toBe(true);
    expect(markCovers(mark, "s2")).toBe(false);
    expect(markCovers(null, "s1")).toBe(false);
    expect(markCovers(mark, null)).toBe(false);
  });
});

describe("reabrir tras un cierre del cron (D-197): las cuatro condiciones, todas obligatorias", () => {
  const me = "u1";
  const mark = { sessionId: "s1", at: T0 };
  const cerradaPorCron = { id: "s1", employeeUid: me, isLive: false, liveNote: CRON_CLOSE_NOTE };
  const base = { fila: cerradaPorCron, me, mark, evidenciaLocal: true, otrasVivas: [] as string[] };

  it("cerrada por el cron + marca + tick continuo + ninguna otra viva → reabre", () => {
    expect(decisionReabrir(base)).toEqual({ reabrir: true });
  });

  it("cerrada por un Stop (live_note null) o por una persona (otra nota) → no", () => {
    expect(decisionReabrir({ ...base, fila: { ...cerradaPorCron, liveNote: null } })).toEqual({ reabrir: false, motivo: "la-cerro-una-persona" });
    expect(decisionReabrir({ ...base, fila: { ...cerradaPorCron, liveNote: "active" } })).toEqual({ reabrir: false, motivo: "la-cerro-una-persona" });
  });

  it("cerrada por el cron pero sin marca, o con marca de OTRA sesión → no", () => {
    expect(decisionReabrir({ ...base, mark: null })).toEqual({ reabrir: false, motivo: "sin-marca" });
    expect(decisionReabrir({ ...base, mark: { sessionId: "s9", at: T0 } })).toEqual({ reabrir: false, motivo: "sin-marca" });
  });

  it("con marca pero el tick local se detuvo → no", () => {
    expect(decisionReabrir({ ...base, evidenciaLocal: false })).toEqual({ reabrir: false, motivo: "sin-evidencia-local" });
  });

  it("si mientras tanto arrancó OTRA sesión viva (092) → no; la propia en la lista no cuenta", () => {
    expect(decisionReabrir({ ...base, otrasVivas: ["s2"] })).toEqual({ reabrir: false, motivo: "otra-viva" });
    expect(decisionReabrir({ ...base, otrasVivas: ["s1"] })).toEqual({ reabrir: true });
  });

  it("no es su fila, sigue viva, o no existe → no", () => {
    expect(decisionReabrir({ ...base, fila: { ...cerradaPorCron, employeeUid: "u2" } })).toEqual({ reabrir: false, motivo: "no-es-mia" });
    expect(decisionReabrir({ ...base, fila: { ...cerradaPorCron, isLive: true } })).toEqual({ reabrir: false, motivo: "sigue-viva" });
    expect(decisionReabrir({ ...base, fila: null })).toEqual({ reabrir: false, motivo: "sin-fila" });
  });

  it("la marca del cron es una constante fija que el tick sobreescribe al reabrir", () => {
    expect(CRON_CLOSE_NOTE).toBe("closed:cron");
  });

  it("el equipo dormido 8 h con el tick armado → no reabre", () => {
    // CAMBIOS del auditor: la tapa cerrada congela setInterval; al despertar el tick vuelve a
    // disparar y la marca sale fresca. Lo que delata la noche es el HUECO entre el último tick
    // antes de dormir y el primero al despertar, y esa es la evidencia que la página exige.
    const ultimoTickAntesDeDormir = T0;
    const alDespertar = T0 + 8 * 60 * MIN;
    const evidenciaLocal = tickContinuo(ultimoTickAntesDeDormir, alDespertar);
    expect(evidenciaLocal).toBe(false);
    expect(decisionReabrir({ ...base, evidenciaLocal })).toEqual({ reabrir: false, motivo: "sin-evidencia-local" });
    // Y con el reloj latiendo cada segundo, sí.
    expect(decisionReabrir({ ...base, evidenciaLocal: tickContinuo(T0, T0 + 1000) })).toEqual({ reabrir: true });
  });
});

describe("tickContinuo: el hueco entre ticks, con el mismo umbral que tolera la base", () => {
  it("hueco de 9 s → continuo; primer tick (null) → continuo", () => {
    expect(tickContinuo(T0, T0 + 9_000)).toBe(true);
    expect(tickContinuo(null, T0)).toBe(true);
  });

  it("15:00 exactos → continuo; 15:01 → roto; 8 h → roto", () => {
    expect(tickContinuo(T0, T0 + LATIDO_MAX_MS)).toBe(true);
    expect(tickContinuo(T0, T0 + LATIDO_MAX_MS + 1000)).toBe(false);
    expect(tickContinuo(T0, T0 + 8 * 60 * MIN)).toBe(false);
  });
});

describe("backoff de la confirmación", () => {
  it("2, 4, 8, 16, 30, 30…", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((a) => backoffMs(a))).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(backoffMs(-3)).toBe(2000);
  });
});
