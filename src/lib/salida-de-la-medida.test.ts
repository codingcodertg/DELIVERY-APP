import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SALIDA_MIN, ahoraDelNegocio, salidaDeLaMedida } from "./salida-de-la-medida";

// D-602 (2026-10-19) · Ernesto: «Why does ETA say 8 to orders that havent been done yet?». La medida de hoy no sale antes de la hora que es.
// D-906 (2026-11-06): «la hora que es» es la de TEXAS, no la del reloj de quien mira. Las horas van como instantes: el 19
// de octubre Texas está en CDT (UTC−5), así que las 12:40 de Texas son las 17:40Z.
const EN_TEXAS = (hhmm: string, dia = "2026-10-19") => new Date(`${dia}T${String(Number(hhmm.slice(0, 2)) + 5).padStart(2, "0")}:${hhmm.slice(3)}:00Z`);

describe("la medida de la ruta sale a la hora que es, no siempre a las 08:00", () => {
  it("hoy, pasadas las 08:00, sale AHORA (12:40 → 760); antes de las 08:00, a las 08:00", () => {
    expect(salidaDeLaMedida("2026-10-19", EN_TEXAS("12:40"))).toBe(12 * 60 + 40);
    expect(salidaDeLaMedida("2026-10-19", EN_TEXAS("07:15"))).toBe(SALIDA_MIN);
    expect(salidaDeLaMedida("2026-10-19", EN_TEXAS("08:00"))).toBe(SALIDA_MIN);
    expect(salidaDeLaMedida("2026-10-19", EN_TEXAS("08:01"))).toBe(SALIDA_MIN + 1);
  });
  it("otro día (mañana, o uno pasado) no tiene «ahora»: las 08:00, como siempre", () => {
    expect(salidaDeLaMedida("2026-10-20", EN_TEXAS("12:40"))).toBe(SALIDA_MIN);
    expect(salidaDeLaMedida("2026-10-18", EN_TEXAS("12:40"))).toBe(SALIDA_MIN);
  });
  it("una salida distinta de las 08:00 se respeta como mínimo", () => {
    expect(salidaDeLaMedida("2026-10-20", EN_TEXAS("12:40"), 9 * 60)).toBe(9 * 60);
    expect(salidaDeLaMedida("2026-10-19", EN_TEXAS("08:30"), 9 * 60)).toBe(9 * 60);
    expect(salidaDeLaMedida("2026-10-19", EN_TEXAS("09:30"), 9 * 60)).toBe(9 * 60 + 30);
  });
  it("D-906: «hoy» y «ahora» son los de Texas, se mire desde donde se mire (las 23:30 de Texas ya son mañana en UTC)", () => {
    // Un instante: 2026-10-20T04:30Z. En Texas siguen siendo las 23:30 del 19; en UTC (y en Guatemala a las 22:30) no.
    const instante = new Date("2026-10-20T04:30:00Z");
    expect(ahoraDelNegocio(instante)).toEqual({ fecha: "2026-10-19", minutos: 23 * 60 + 30 });
    expect(salidaDeLaMedida("2026-10-19", instante)).toBe(23 * 60 + 30);
    expect(salidaDeLaMedida("2026-10-20", instante)).toBe(SALIDA_MIN);
    // Y el cambio de hora: el 6 de noviembre Texas ya está en CST (UTC−6); las 09:25 de Texas son las 15:25Z.
    expect(ahoraDelNegocio(new Date("2026-11-06T15:25:00Z"))).toEqual({ fecha: "2026-11-06", minutos: 9 * 60 + 25 });
    // El código no lee la hora local del navegador.
    const fuente = readFileSync(new URL("./salida-de-la-medida.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fuente).not.toMatch(/\.getHours\(\)|\.getMinutes\(\)|\.getDate\(\)|\.getFullYear\(\)/);
  });
  it("puerta: la medida por calles (la que pone las llegadas) arranca de `salidaDeLaMedida(fecha)`, no de las 08:00 fijas", () => {
    const hook = readFileSync(new URL("./usa-medida-de-rutas.ts", import.meta.url), "utf8");
    expect(hook).toContain('from "./salida-de-la-medida"');
    // D-691: el reloj vive en `relojDeLaRuta` (salida-de-la-medida.ts); sin nada hecho, sale de `salidaDeLaMedida`.
    const reloj = readFileSync(new URL("./salida-de-la-medida.ts", import.meta.url), "utf8");
    // **Puesto al día por D-906**: el reloj recibe además la salida del turno y el camión (`extras`); sin nada hecho sale
    // a la hora prevista y, hoy, no antes de ahora; y una hora que no se sabe va vacía en vez de inventarse.
    expect(hook).toContain("relojDeLaRuta({ ...r, ordenes, ahora, ...extras })");
    expect(reloj).toContain("if (ultimaHora == null) salida = visitados.length ? null : ahoraMin != null ? Math.max(salidaPrevista, ahoraMin) : salidaPrevista;");
    expect(reloj).toContain("if (donde < 0) clock = salida;");
    expect(hook).toContain('start: salida == null ? "" : fmtReloj(salida)');
    expect(hook).not.toContain("let clock = DAY_START_MIN;");
  });
});
