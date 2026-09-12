import { describe, it, expect } from "vitest";
import { horaCorta, minutosSinGuardar } from "./save-state";

describe("horaCorta", () => {
  it("da HH:MM locales con dos dígitos", () => {
    const d = new Date(2026, 8, 11, 9, 4, 30);
    expect(horaCorta(d.getTime())).toBe("09:04");
  });
  it("no se le cae la hora de la tarde", () => {
    const d = new Date(2026, 8, 11, 15, 24, 39);
    expect(horaCorta(d.getTime())).toBe("15:24");
  });
});

describe("minutosSinGuardar", () => {
  it("cuenta desde el último guardado bueno", () => {
    expect(minutosSinGuardar(1_000_000, 1_000_000 + 96 * 60_000)).toBe(96);
  });
  it("trunca, no redondea: 59 s todavía es cero minutos", () => {
    expect(minutosSinGuardar(0, 59_000)).toBe(0);
  });
  it("nunca negativo, aunque el reloj del equipo se haya movido atrás", () => {
    expect(minutosSinGuardar(10_000_000, 1_000)).toBe(0);
  });
});
