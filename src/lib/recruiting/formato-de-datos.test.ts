import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { correoDeFicha, nombreDeFicha, telefonoDeFicha } from "./employee-file";

// D-729 (2026-10-28) · «Emails: always lowercase. Names: proper capitalization (First Last), never all caps or all lowercase».
describe("formato de los datos del expediente", () => {
  it("el correo va en minúsculas y recortado; vacío es null", () => {
    expect(correoDeFicha("  Careers@RDZTileGroup.NET ")).toBe("careers@rdztilegroup.net");
    expect(correoDeFicha("")).toBeNull();
    expect(correoDeFicha(null)).toBeNull();
  });
  it("el nombre todo en mayúsculas o todo en minúsculas sale con mayúscula inicial; el mezclado se respeta", () => {
    expect(nombreDeFicha("JULIO JIJON")).toBe("Julio Jijon");
    expect(nombreDeFicha("  maría   de la garza ")).toBe("María De La Garza");
    expect(nombreDeFicha("RODRÍGUEZ-PÉREZ")).toBe("Rodríguez-Pérez");
    expect(nombreDeFicha("o'brien")).toBe("O'Brien");
    expect(nombreDeFicha("Patricia McAllen")).toBe("Patricia McAllen");
    expect(nombreDeFicha("Roberto Rodriguez Jr")).toBe("Roberto Rodriguez Jr");
    expect(nombreDeFicha("   ")).toBe("");
  });
  it("el teléfono sigue con la forma de la app (D-432)", () => {
    expect(telefonoDeFicha("(956) 817-1583")).toBe("956-817-1583");
  });
  it("guardar y agregar pasan por el formato: nombre, correos y teléfonos", () => {
    const accion = readFileSync(new URL("../../app/recruiting/actions/hr.ts", import.meta.url), "utf8");
    expect(accion).toContain("const nombre = nombreDeFicha(patch.full_name);");
    expect(accion).toContain('for (const k of ["email", "personal_email", "second_email"] as const) {');
    expect(accion).toContain("limpio[k] = correoDeFicha(patch[k]);");
    const lib = readFileSync(new URL("./employee-file.ts", import.meta.url), "utf8");
    expect(lib).toContain("const nombre = nombreDeFicha(d.full_name);");
  });
});
