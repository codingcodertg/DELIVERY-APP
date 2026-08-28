import { describe, it, expect } from "vitest";
import { isOverlapError } from "./overlap";

// Los fichajes tienen DOS reglas con dos codigos distintos: EXCLUDE (23P01) para los
// cerrados y un indice unico (23505) para el abierto. Confundir cualquiera de las dos con
// un fallo de red haria que la app reintentara algo que la base va a rechazar igual.
describe("isOverlapError (clock-in)", () => {
  it("reconoce el EXCLUDE de los fichajes cerrados", () => {
    expect(isOverlapError({ code: "23P01", message: "conflicting key value" })).toBe(true);
    expect(isOverlapError({ message: 'violates exclusion constraint "time_entries_no_overlap"' })).toBe(true);
  });

  it("reconoce el indice del fichaje abierto", () => {
    expect(isOverlapError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "time_entries_one_open_per_employee"',
    })).toBe(true);
  });

  it("NO trata cualquier 23505 como un solape", () => {
    // 23505 lo produce cualquier indice unico; sin el nombre seria un mensaje equivocado
    // en una situacion que no tiene nada que ver.
    expect(isOverlapError({ code: "23505", message: 'duplicate key on "profiles_pkey"' })).toBe(false);
  });

  it("NO confunde un fallo de red", () => {
    expect(isOverlapError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isOverlapError({ code: "PGRST301", message: "JWT expired" })).toBe(false);
    expect(isOverlapError(null)).toBe(false);
  });
});
