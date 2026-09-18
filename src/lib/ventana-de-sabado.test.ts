import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { DELIVERY_WINDOW_PRESETS, SATURDAY_WINDOW, WEEKDAY_ALL_DAY_WINDOW } from "./constants";
import { cierraA, esSabado, ventanaDelOtroTipoDeDia, ventanaDeTodoElDia, ventanasParaLaFecha } from "./delivery-windows";
import { parseWindow } from "./dispatch";

/**
 * La ventana de sábado solo en sábado (D-NEXT).
 *
 * El dueño: «delivery window: la ventana de sábado solo debe estar disponible cuando se elige un
 * sábado». Y, preguntado por el otro sentido: en sábado tampoco se ofrece «Tarde (12-5:30)», porque
 * termina después del cierre de ese día.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const modal = leer("src/components/OrderModal.tsx");
/** El salto de línea por su código: escrito como escape, la herramienta que editó este fichero lo
 *  resolvía y partía la línea en dos. */
const SALTO = String.fromCharCode(10);

/** 2026-09-19 es sábado; el 18 viernes y el 20 domingo. */
const SABADO = "2026-09-19";
const VIERNES = "2026-09-18";
const DOMINGO = "2026-09-20";
const valores = (iso: string | null, actual?: string | null) => ventanasParaLaFecha(iso, actual).map((p) => p.value);

describe("«es sábado» no depende de la zona horaria de quien lo pregunte", () => {
  const original = process.env.TZ;
  afterAll(() => { process.env.TZ = original; });

  it("el mismo resultado en cinco husos, incluidos los que rompen la forma ingenua", () => {
    // Medido el 2026-09-17: `new Date("2026-09-19").getDay()` da VIERNES en America/Chicago,
    // America/Guatemala y Pacific/Niue, y sábado en UTC y en Kiritimati. O sea que una prueba que se
    // fiara del huso del proceso pasaría en CI —que corre en UTC— con la implementación rota. Por eso
    // esta cambia `process.env.TZ`, que Node relee en caliente (medido igual).
    for (const tz of ["UTC", "America/Chicago", "America/Guatemala", "Pacific/Kiritimati", "Pacific/Niue"]) {
      process.env.TZ = tz;
      expect([tz, esSabado(SABADO)], tz).toEqual([tz, true]);
      expect([tz, esSabado(VIERNES)], tz).toEqual([tz, false]);
      expect([tz, esSabado(DOMINGO)], tz).toEqual([tz, false]);
      expect([tz, ventanaDeTodoElDia(SABADO)], tz).toEqual([tz, SATURDAY_WINDOW]);
      expect([tz, ventanaDeTodoElDia(VIERNES)], tz).toEqual([tz, WEEKDAY_ALL_DAY_WINDOW]);
    }
  });

  it("y la forma que NO se usa es justo la que falla aquí (control de la prueba de arriba)", () => {
    // Si este control deja de fallar en los husos negativos, la tabla de arriba dejó de medir nada.
    process.env.TZ = "America/Chicago";
    expect(new Date(SABADO).getDay()).toBe(5);       // viernes: el error que se está evitando
    expect(new Date(SABADO + "T12:00:00").getDay()).toBe(6);
    expect(esSabado(SABADO)).toBe(true);
  });

  it("una fecha vacía o imposible no es sábado, y no revienta", () => {
    // `2026-04-32` no es una fecha, y sin la comprobación se desborda a 2026-05-02, que **sí** es
    // sábado: por eso está en la lista. Con `2026-02-31` sola (cae en martes) la prueba pasaba con la
    // comprobación quitada, y un mutante lo enseñó.
    for (const malo of ["", null, undefined, "no-es-fecha", "2026-02-31", "2026-04-32", "2026-13-01"]) {
      expect([malo, esSabado(malo)]).toEqual([malo, false]);
    }
    // Y sin fecha se ofrecen todas: esconder una sería adivinar qué día será.
    expect(valores(null)).toEqual(DELIVERY_WINDOW_PRESETS.map((p) => p.value));
    expect(valores("")).toEqual(DELIVERY_WINDOW_PRESETS.map((p) => p.value));
  });
});

describe("qué se ofrece cada día", () => {
  it("entre semana: todas menos la de sábado", () => {
    expect(valores(VIERNES)).toEqual(["0830-1000", "0830-1200", "1200-1730", WEEKDAY_ALL_DAY_WINDOW]);
    expect(valores(VIERNES)).not.toContain(SATURDAY_WINDOW);
    expect(valores(DOMINGO)).not.toContain(SATURDAY_WINDOW);
  });

  it("sábado: la de sábado, y nada que termine después de su cierre", () => {
    expect(valores(SABADO)).toEqual(["0830-1000", "0830-1200", SATURDAY_WINDOW]);
    // Las dos que se caen, y por qué: una es la «todo el día» del otro tipo de día, la otra termina
    // a las 5:30 y el sábado se cierra a las 3:30.
    expect(valores(SABADO)).not.toContain(WEEKDAY_ALL_DAY_WINDOW);
    expect(valores(SABADO)).not.toContain("1200-1730");
  });

  it("el cierre no es un número escrito aparte: sale de la ventana de «todo el día» de ese día", () => {
    expect(cierraA(SABADO)).toBe(parseWindow(SATURDAY_WINDOW)?.[1]);
    expect(cierraA(VIERNES)).toBe(parseWindow(WEEKDAY_ALL_DAY_WINDOW)?.[1]);
    // Y no hay ningún número de cierre escrito en el módulo: si mañana cambia el horario se cambia la
    // constante de la ventana y esto lo sigue solo. (Un `930` o un `1530` a mano pasaría las dos
    // afirmaciones de arriba, así que hace falta mirarlo en el fichero.)
    const fuente = leer("src/lib/delivery-windows.ts")
      .split(SALTO)
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join(SALTO);
    for (const literal of ["930", "1530", "1050", "1730"]) {
      expect(fuente, literal).not.toContain(literal);
    }
    expect(fuente).toContain("parseWindow(ventanaDeTodoElDia(iso))");
  });

  it("las dos «todo el día» son pareja: cada día ofrece la suya y esconde la otra", () => {
    expect([ventanaDeTodoElDia(SABADO), ventanaDelOtroTipoDeDia(SABADO)]).toEqual([SATURDAY_WINDOW, WEEKDAY_ALL_DAY_WINDOW]);
    expect([ventanaDeTodoElDia(VIERNES), ventanaDelOtroTipoDeDia(VIERNES)]).toEqual([WEEKDAY_ALL_DAY_WINDOW, SATURDAY_WINDOW]);
  });
});

describe("una orden ya guardada no pierde su ventana", () => {
  it("la de sábado sigue en la lista si la orden la tiene, aunque sea martes", () => {
    expect(valores(VIERNES, SATURDAY_WINDOW)).toContain(SATURDAY_WINDOW);
    // Y sigue siendo la excepción: sin esa orden detrás, no está.
    expect(valores(VIERNES, null)).not.toContain(SATURDAY_WINDOW);
  });

  it("y al revés: la de entre semana y la tarde se conservan en una orden de sábado", () => {
    expect(valores(SABADO, WEEKDAY_ALL_DAY_WINDOW)).toContain(WEEKDAY_ALL_DAY_WINDOW);
    expect(valores(SABADO, "1200-1730")).toContain("1200-1730");
  });

  it("conservar una no mete las otras: sigue faltando la que no toca", () => {
    expect(valores(SABADO, "1200-1730")).not.toContain(WEEKDAY_ALL_DAY_WINDOW);
  });
});

describe("el formulario", () => {
  it("el selector recibe la fecha de la orden y ofrece lo de ese día", () => {
    expect(modal).toContain("<WindowSel val={d.delivery_windows} fecha={d.delivery_date}");
    expect(modal).toContain("const disponibles = ventanasParaLaFecha(fecha, current);");
    expect(modal).toContain("{disponibles.map((p) => <option key={p.key} value={p.value}>{t(p.en, p.es)}</option>)}");
  });

  it("y el día lo decide la función compartida, no un `new Date` a mano", () => {
    expect(modal).toContain("const want = ventanaDeTodoElDia(d.delivery_date);");
    expect(modal).toContain("const other = ventanaDelOtroTipoDeDia(d.delivery_date);");
    expect(modal).not.toContain('new Date(d.delivery_date + "T12:00:00").getDay()');
  });

  it("cambiar la fecha sigue cambiando solo la de «todo el día», y nunca una elegida a mano", () => {
    // Esto ya existía y no se toca; la prueba lo deja fijado, que es lo que faltaba.
    const tramo = modal.slice(modal.indexOf("const want = ventanaDeTodoElDia"), modal.indexOf("const [busy, setBusy]"));
    expect(tramo).toContain("if (!d.delivery_windows || d.delivery_windows === other) {");
    expect(tramo).toContain("setD((p) => (p.delivery_windows === want ? p : { ...p, delivery_windows: want }));");
  });
});
