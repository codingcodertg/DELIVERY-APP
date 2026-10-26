import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SALIDA_MIN, salidaDeLaMedida } from "./salida-de-la-medida";

// D-602 (2026-10-19) · Ernesto: «Why does ETA say 8 to orders that havent been done yet?». La medida de hoy no sale antes de la hora que es.

describe("la medida de la ruta sale a la hora que es, no siempre a las 08:00", () => {
  it("hoy, pasadas las 08:00, sale AHORA (12:40 → 760); antes de las 08:00, a las 08:00", () => {
    expect(salidaDeLaMedida("2026-10-19", new Date("2026-10-19T12:40:00"))).toBe(12 * 60 + 40);
    expect(salidaDeLaMedida("2026-10-19", new Date("2026-10-19T07:15:00"))).toBe(SALIDA_MIN);
    expect(salidaDeLaMedida("2026-10-19", new Date("2026-10-19T08:00:00"))).toBe(SALIDA_MIN);
    expect(salidaDeLaMedida("2026-10-19", new Date("2026-10-19T08:01:00"))).toBe(SALIDA_MIN + 1);
  });
  it("otro día (mañana, o uno pasado) no tiene «ahora»: las 08:00, como siempre", () => {
    expect(salidaDeLaMedida("2026-10-20", new Date("2026-10-19T12:40:00"))).toBe(SALIDA_MIN);
    expect(salidaDeLaMedida("2026-10-18", new Date("2026-10-19T12:40:00"))).toBe(SALIDA_MIN);
  });
  it("una salida distinta de las 08:00 se respeta como mínimo", () => {
    expect(salidaDeLaMedida("2026-10-20", new Date("2026-10-19T12:40:00"), 9 * 60)).toBe(9 * 60);
    expect(salidaDeLaMedida("2026-10-19", new Date("2026-10-19T08:30:00"), 9 * 60)).toBe(9 * 60);
    expect(salidaDeLaMedida("2026-10-19", new Date("2026-10-19T09:30:00"), 9 * 60)).toBe(9 * 60 + 30);
  });
  it("puerta: la medida por calles (la que pone las llegadas) arranca de `salidaDeLaMedida(fecha)`, no de las 08:00 fijas", () => {
    const hook = readFileSync(new URL("./usa-medida-de-rutas.ts", import.meta.url), "utf8");
    expect(hook).toContain('from "./salida-de-la-medida"');
    // D-691: el reloj vive en `relojDeLaRuta` (salida-de-la-medida.ts); sin nada hecho, sale de `salidaDeLaMedida`.
    const reloj = readFileSync(new URL("./salida-de-la-medida.ts", import.meta.url), "utf8");
    expect(hook).toContain("relojDeLaRuta({ ...r, ordenes, ahora })");
    expect(reloj).toContain("if (primera < 0) salida = salidaDeLaMedida(e.fecha, e.ahora);");
    expect(reloj).toContain("let clock = salida;");
    expect(hook).toContain("start: fmtClock(salida)");
    expect(hook).not.toContain("let clock = DAY_START_MIN;");
  });
});
