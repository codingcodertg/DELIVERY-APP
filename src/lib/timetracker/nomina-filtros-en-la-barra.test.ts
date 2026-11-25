import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Nómina (2026-11-24): el periodo, la tienda y el empleado van DENTRO de la barra de arriba, justo después de la marca,
// en este orden, y en una sola fila. Sin ranura en la barra, salen como fila de la página. Se mira el fuente.
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("Nómina · los filtros van en la barra, en orden: periodo, tienda, empleado", () => {
  const filtros = leer("src/components/timetracker/FiltrosDeNomina.tsx");
  const tabs = leer("src/components/timetracker/PayrollTabs.tsx");

  it("el bloque lleva data-nomina-en-la-barra y se portala en HUECO_DE_LA_BARRA", () => {
    expect(filtros).toContain("data-nomina-en-la-barra");
    expect(filtros).toContain("HUECO_DE_LA_BARRA");
    expect(filtros).toContain("createPortal(bloque, hueco)");
  });

  it("sin ranura, la misma pieza es una fila de la página", () => {
    expect(filtros).toContain('<div className="tt-fila-de-nomina" data-fila-de-nomina>');
  });

  it("los tres controles, en orden: <MenuDeFecha, el select de tienda y el de empleado", () => {
    const menu = filtros.indexOf("<MenuDeFecha");
    const tienda = filtros.indexOf("data-tienda-de-nomina");
    const empleado = filtros.indexOf("data-empleado-de-nomina");
    expect(menu).toBeGreaterThan(-1);
    expect(tienda).toBeGreaterThan(menu);
    expect(empleado).toBeGreaterThan(tienda);
  });

  it("la pantalla de Payroll lo monta, y la URL lleva ?tienda= y ?empleado=", () => {
    expect(tabs).toContain("<FiltrosDeNomina");
    expect(filtros).toContain('ir({ empleado: e.target.value || null })');
    expect(filtros).toContain("tienda: v || null");
    expect(filtros).toMatch(/"tienda",\s*"empleado"/);
  });

  it("la barra sigue en UNA fila desde 701 px: los selects se encogen con tope y puntos suspensivos", () => {
    const css = leer("src/app/timetracker/timetracker.css");
    expect(css).toContain("select[data-empleado-de-nomina]{max-width:150px}");
    expect(css).toContain("select[data-tienda-de-nomina]{max-width:130px}");
    expect(css).toContain(".tt-nomina-en-la-barra .tt-nomina-select{width:auto;min-width:0;max-width:200px;padding:5px 8px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}");
  });
});
