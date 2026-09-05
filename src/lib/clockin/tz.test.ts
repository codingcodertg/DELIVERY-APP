import { describe, it, expect } from "vitest";
import { centralShiftMs, centralWallToUtc, utcToCentralInput } from "./tz";

// G-24 (D-198). /track construía los límites del día con `-05:00` fijo, que solo es Central
// en verano. Los límites pasan por este helper, que sabe de horario de verano, y aquí se fija
// con una fecha en CDT (julio) y otra en CST (enero) que la medianoche de Chicago es la que es.

describe("centralWallToUtc: la medianoche de Chicago en UTC, con horario de verano", () => {
  it("en verano (CDT, UTC-5) la medianoche del 15 de julio es 05:00Z", () => {
    expect(centralWallToUtc("2026-07-15T00:00")).toBe("2026-07-15T05:00:00.000Z");
    expect(centralShiftMs(new Date("2026-07-15T12:00:00Z"))).toBe(5 * 3600_000);
  });

  it("en invierno (CST, UTC-6) la medianoche del 15 de enero es 06:00Z — con -05:00 fijo saldría 05:00Z", () => {
    expect(centralWallToUtc("2026-01-15T00:00")).toBe("2026-01-15T06:00:00.000Z");
    expect(centralShiftMs(new Date("2026-01-15T12:00:00Z"))).toBe(6 * 3600_000);
    // La fijación de las 23:30 del 14 de enero en Chicago (05:30Z del 15) es del día 14; con el
    // offset fijo de verano el "día 15" empezaba a las 05:00Z y se la quedaba.
    const fix = "2026-01-15T05:30:00.000Z";
    expect(fix < centralWallToUtc("2026-01-15T00:00")).toBe(true);   // queda en el 14, correcto
    expect(fix < "2026-01-15T05:00:00.000Z").toBe(false);            // con -05:00 fijo caía en el 15
  });

  it("ida y vuelta: UTC → pared de Chicago → UTC devuelve el mismo instante en las dos estaciones", () => {
    for (const iso of ["2026-07-15T05:00:00.000Z", "2026-01-15T06:00:00.000Z"]) {
      expect(centralWallToUtc(utcToCentralInput(iso))).toBe(iso);
    }
  });
});
