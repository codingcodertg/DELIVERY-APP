import { describe, it, expect } from "vitest";
import {
  LATIDO_MAX_MS, RESUME_MAX_MS,
  ultimoLatidoDe, esHuerfana, cierreHuerfana, huerfanasDe,
  parseResumeMark, markCovers, resumeKey, backoffMs,
} from "./live-session";

// D-NEXT. El cronómetro sobrevive a la actualización: el umbral de huérfana sube de 5 a 15
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

describe("backoff de la confirmación", () => {
  it("2, 4, 8, 16, 30, 30…", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((a) => backoffMs(a))).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(backoffMs(-3)).toBe(2000);
  });
});
