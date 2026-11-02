import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { columnasDePromos } from "./tabla";

/** D-794: Pendiente/Aprobado/Rechazado como chips de la tabla de Órdenes; «BRO QOH» en vez de «Existencias BRO». */
const tabla = readFileSync(join(process.cwd(), "src/app/promos/[id]/TablaDeRonda.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("los chips de estado", () => {
  it("son .chip con .on al estar encendidos y la cuenta en .cnt, como en Órdenes", () => {
    const i = tabla.indexOf("data-chips-de-estado");
    expect(i).toBeGreaterThan(0);
    const bloque = tabla.slice(i, tabla.indexOf("</div>", i));
    expect(bloque).toContain('className={`chip${orden.filtros.estado?.has(e) ? " on" : ""}`}');
    expect(bloque).toContain('<span className="cnt">{cuenta[e]}</span>');
    expect(bloque).not.toContain('"primary"');
  });
});

describe("las columnas de existencias por tienda", () => {
  it("se llaman «<tienda> QOH» en los dos idiomas", () => {
    const cols = columnasDePromos(["EDG", "BRO"], false).filter((c) => c.key.startsWith("qoh_"));
    expect(cols.map((c) => [c.en, c.es])).toEqual([["EDG QOH", "EDG QOH"], ["BRO QOH", "BRO QOH"]]);
  });
});
