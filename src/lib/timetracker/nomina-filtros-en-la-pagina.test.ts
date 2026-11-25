import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Nómina (2026-11-25): el periodo, la tienda y el empleado van EN LA PÁGINA, arriba de «Hojas de tiempo», en una
// fila (`data-nomina-en-la-pagina`). Ya no van en la barra de arriba: no se portalan a ningún hueco.
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("Nómina · los filtros van en la página, en orden: periodo, tienda, empleado", () => {
  const filtros = leer("src/components/timetracker/FiltrosDeNomina.tsx");
  const tabs = leer("src/components/timetracker/PayrollTabs.tsx");

  it("el bloque lleva data-nomina-en-la-pagina y se pinta en línea, sin portal", () => {
    expect(filtros).toContain("data-nomina-en-la-pagina");
    expect(filtros).toContain('<div className="tt-nomina-en-la-pagina" data-nomina-en-la-pagina>');
    expect(filtros).not.toContain("createPortal");
    expect(filtros).not.toContain("HUECO_DE_LA_BARRA");
    expect(filtros).not.toContain("data-nomina-en-la-barra");
  });

  it("los tres controles, en orden: <MenuDeFecha, el select de tienda y el de empleado", () => {
    const menu = filtros.indexOf("<MenuDeFecha");
    const tienda = filtros.indexOf("data-tienda-de-nomina");
    const empleado = filtros.indexOf("data-empleado-de-nomina");
    expect(menu).toBeGreaterThan(-1);
    expect(tienda).toBeGreaterThan(menu);
    expect(empleado).toBeGreaterThan(tienda);
  });

  it("la pantalla de Payroll lo monta encima de las secciones, y la URL lleva ?tienda= y ?empleado=", () => {
    expect(tabs).toContain("<FiltrosDeNomina");
    expect(tabs.indexOf("<FiltrosDeNomina")).toBeLessThan(tabs.indexOf("<PayrollTimesheets"));
    expect(filtros).toContain('ir({ empleado: e.target.value || null })');
    expect(filtros).toContain("tienda: v || null");
    expect(filtros).toMatch(/"tienda", "empleado"/);
  });

  it("los controles viven en la página: ninguna regla de la barra los nombra", () => {
    const css = leer("src/app/timetracker/timetracker.css");
    expect(css).toContain(".timetracker-module .tt-nomina-en-la-pagina .tt-nomina-select{");
    expect(css).not.toContain("tt-nomina-en-la-barra");
    expect(css).not.toContain("tt-fila-de-nomina");
  });
});
