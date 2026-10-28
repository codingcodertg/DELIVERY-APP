import { describe, expect, it } from "vitest";
import { nombreDeDepartamento } from "./departamentos";

// D-725 (2026-10-28) · «Department section headers … are still showing in Spanish even when the language setting is English».
describe("nombreDeDepartamento", () => {
  it("en inglés traduce los de Ajustes; en español los deja; lo desconocido sale tal cual", () => {
    expect(nombreDeDepartamento("Oficina", "en")).toBe("Office");
    expect(nombreDeDepartamento("Almacén", "en")).toBe("Warehouse");
    expect(nombreDeDepartamento("Ventas", "en")).toBe("Sales");
    expect(nombreDeDepartamento("Choferes", "en")).toBe("Drivers");
    expect(nombreDeDepartamento("Almacén", "es")).toBe("Almacén");
    expect(nombreDeDepartamento("Marketing", "en")).toBe("Marketing");
    expect(nombreDeDepartamento(null, "en")).toBe("");
    expect(nombreDeDepartamento("  ", "es")).toBe("");
  });
});
