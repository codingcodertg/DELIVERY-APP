import { describe, expect, it } from "vitest";
import { correccionDeAlta, correccionDeCita, paredDeLaNota } from "./corrige-hora-de-citas.mts";

// Las formas medidas en producción el 2026-10-21 (notas «In person / Scheduled» y su `inperson_date`), sin nombres.
describe("corrige-hora-de-citas: solo lo que la nota del contacto deja medir (D-632)", () => {
  it("la nota «Oct 21 03:30 PM · Pharr» con la cita guardada a las 4:30 de Texas → las 3:30 de Texas", () => {
    const guardada = new Date("2026-10-21T21:30:00Z");
    expect(paredDeLaNota("Oct 21 03:30 PM · Pharr", guardada)).toBe("2026-10-21T15:30");
    expect(correccionDeCita({ inperson_date: guardada, nota: "Oct 21 03:30 PM · Pharr" })?.toISOString()).toBe("2026-10-21T20:30:00.000Z");
    // Julio, sin lugar en la nota (antes de D-585).
    expect(correccionDeCita({ inperson_date: new Date("2026-07-29T17:00:00Z"), nota: "Jul 29 11:00 AM" })?.toISOString()).toBe("2026-07-29T16:00:00.000Z");
    // Mediodía y medianoche en formato de 12 horas.
    expect(paredDeLaNota("Jul 29 12:00 PM", new Date("2026-07-29T18:00:00Z"))).toBe("2026-07-29T12:00");
    expect(paredDeLaNota("Jul 29 12:15 AM", new Date("2026-07-29T06:15:00Z"))).toBe("2026-07-29T00:15");
  });

  it("no toca la que ya está bien, la que no tiene nota, ni la que se movió de día sin dejar nota", () => {
    expect(correccionDeCita({ inperson_date: new Date("2026-10-21T20:30:00Z"), nota: "Oct 21 03:30 PM · Pharr" })).toBeNull();
    expect(correccionDeCita({ inperson_date: new Date("2026-10-21T21:30:00Z"), nota: null })).toBeNull();
    expect(correccionDeCita({ inperson_date: new Date("2026-07-27T16:00:00Z"), nota: "Jul 25 10:00 AM" })).toBeNull();
    expect(correccionDeCita({ inperson_date: new Date("2026-10-21T21:30:00Z"), nota: "nota libre sin fecha" })).toBeNull();
  });

  it("la nota de diciembre con la cita en enero toma el año que la deja más cerca", () => {
    expect(paredDeLaNota("Dec 31 05:00 PM", new Date("2027-01-01T00:00:00Z"))).toBe("2026-12-31T17:00");
  });

  it("reg_date: el día UTC pasa al de Texas; si alguien lo cambió a mano, no se toca", () => {
    const tarde = new Date("2026-07-25T01:00:00Z"); // 20:00 del 24 en Texas
    expect(correccionDeAlta({ reg_date: "2026-07-25", created_at: tarde })).toBe("2026-07-24");
    expect(correccionDeAlta({ reg_date: "2026-07-24", created_at: tarde })).toBeNull();
    expect(correccionDeAlta({ reg_date: "2026-07-20", created_at: tarde })).toBeNull();
    expect(correccionDeAlta({ reg_date: "2026-07-24", created_at: new Date("2026-07-24T15:00:00Z") })).toBeNull();
  });
});
