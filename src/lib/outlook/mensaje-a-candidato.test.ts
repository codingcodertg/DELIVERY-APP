import { describe, expect, it } from "vitest";
import { patronApellido, textoDeLaNota } from "./mensaje-a-candidato";

describe("coincidencia de mensajes con candidatos", () => {
  it("el patrón de apellido tolera acentos (Sánchez / Sanchez)", () => {
    expect(patronApellido("Jesse Sanchez")).toBe("%s__ch_z%");
    expect(patronApellido("Ana Peña")).toBe("%p___%");
    expect(patronApellido("Jo Li")).toBeNull();
  });

  it("la nota lleva el texto, el puesto y la fecha del correo", () => {
    const nota = textoDeLaNota(
      { candidateName: "Jesse Sanchez", texto: "Hello yes would Monday at 12pm work?", puesto: "Inventory and Warehouse Coordinator", empresa: null, ubicacion: null },
      "2026-11-13T14:05:00Z",
    );
    expect(nota).toBe("Mensaje de Indeed (Inventory and Warehouse Coordinator) · 2026-11-13 14:05 UTC:\nHello yes would Monday at 12pm work?");
  });
});
