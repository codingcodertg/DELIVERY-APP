import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { puedeImprimirGrupo } from "./grupos";

describe("imprimir un grupo ⏳ Pendiente (dueño, 12 nov)", () => {
  it("aprobado: cualquiera que lo ve; pendiente: solo quien gestiona; borrador: nadie", () => {
    expect(puedeImprimirGrupo({ aprobado: true, gestiona: false })).toBe(true);
    expect(puedeImprimirGrupo({ aprobado: false, gestiona: true })).toBe(true);
    expect(puedeImprimirGrupo({ aprobado: false, gestiona: false })).toBe(false);
    expect(puedeImprimirGrupo({ aprobado: false, gestiona: true, borrador: true })).toBe(false);
  });
  it("la hoja pendiente impresa dice que está pendiente", () => {
    const hoja = readFileSync(join(process.cwd(), "src/app/operaciones/HojaDeGrupo.tsx"), "utf8");
    expect(hoja).toContain("data-hoja-pendiente");
    expect(hoja).toContain("PENDIENTE DE APROBACIÓN");
    expect(hoja).toContain("puedeImprimirGrupo(");
  });
});
