import { describe, it, expect } from "vitest";
import { isOverlapError } from "./overlap";

// Lo que importa de este detector es que NO confunda un solape con un fallo de red:
// el primero no se reintenta ni se encola, el segundo sí. Confundirlos en cualquiera
// de los dos sentidos es un fallo silencioso — o el reloj cuenta contra una fila que
// nunca se guarda, o unas horas legítimas se pierden por no reintentarlas.
describe("isOverlapError", () => {
  it("reconoce el SQLSTATE de una restricción EXCLUDE", () => {
    expect(isOverlapError({ code: "23P01", message: "conflicting key value" })).toBe(true);
  });

  it("reconoce el error por el nombre de la restricción, sin código", () => {
    expect(isOverlapError({
      message: 'conflicting key value violates exclusion constraint "sessions_no_overlap"',
    })).toBe(true);
  });

  it("lo encuentra también en details o hint", () => {
    expect(isOverlapError({ details: "Key conflicts with sessions_no_overlap." })).toBe(true);
  });

  it("NO confunde un fallo de red con un solape", () => {
    expect(isOverlapError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isOverlapError({ code: "PGRST301", message: "JWT expired" })).toBe(false);
    expect(isOverlapError({ code: "23505", message: "duplicate key" })).toBe(false);
  });

  it("aguanta lo que no es un error", () => {
    expect(isOverlapError(null)).toBe(false);
    expect(isOverlapError(undefined)).toBe(false);
    expect(isOverlapError("boom")).toBe(false);
  });
});
