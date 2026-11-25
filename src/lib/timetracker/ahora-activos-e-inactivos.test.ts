import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { estadoDeTrabajo, ordenaTrabajandoPrimero } from "@/lib/timetracker/trabajando-primero";

// 2026-11-25: la lista de «Trabajando ahora» (activos arriba, inactivos debajo) salió de Nómina. Ahora cada nombre
// en «Hojas de tiempo» lleva su estado (verde = trabaja ahora, gris = no) y los que trabajan salen primero.

describe("el estado de cada persona", () => {
  const trabajando = new Set(["ana", "pedro"]);
  it("«si» si trabaja ahora, «no» si no; sin dato, «no»", () => {
    expect(estadoDeTrabajo("ana", trabajando)).toBe("si");
    expect(estadoDeTrabajo("luis", trabajando)).toBe("no");
    expect(estadoDeTrabajo("luis", undefined)).toBe("no");
  });
});

describe("los que trabajan salen primero, en orden estable", () => {
  it("activos primero, el resto después, cada grupo en su orden", () => {
    const personas = ["luis", "ana", "marta", "pedro"];
    expect(ordenaTrabajandoPrimero(personas, new Set(["ana", "pedro"]))).toEqual(["ana", "pedro", "luis", "marta"]);
  });
});

describe("«Hojas de tiempo» pinta el estado en el nombre", () => {
  const src = readFileSync(join(process.cwd(), "src/components/timetracker/PayrollTimesheets.tsx"), "utf8");
  const hoja = readFileSync(join(process.cwd(), "src/components/timetracker/HojaSemanal.tsx"), "utf8");

  it("la hoja y la tabla llevan data-trabajando con el mismo helper y su título", () => {
    expect(hoja).toContain('data-trabajando={estadoDeTrabajo(b.id, trabajando)}');
    expect(src).toContain('data-trabajando={estadoDeTrabajo(id, trabajando)}');
    expect(hoja).toContain('t("hoja.working")');
    expect(src).toContain('t("hoja.notWorking")');
  });

  it("el orden lo pone ordenaTrabajandoPrimero en la hoja y en la tabla", () => {
    expect(src).toContain("ordenaTrabajandoPrimero([...grupos.values()].flat().filter(visible), trabajando)");
    expect(src).toContain("ordenaTrabajandoPrimero(miembros.filter(visible), trabajando)");
  });

  it("el color sale de tokens del módulo, no de literales en el componente", () => {
    expect(hoja).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
