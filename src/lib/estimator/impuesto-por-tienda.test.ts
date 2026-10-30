import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hojaDelCliente } from "./hoja";
import { borradorVacio, lineaUnidadVacia, resumenDeTotales, TASA_DE_IMPUESTO, tasaDeImpuesto, type UnitLine } from "./modelo";

/** El impuesto según la tienda: Mission 6.25 %, las demás 8.25 % (D-776). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("tasaDeImpuesto", () => {
  it("Mission 6.25 % (con o sin mayúsculas y espacios); las demás y sin tienda, 8.25 %", () => {
    expect(tasaDeImpuesto("RDZ Mission")).toBe(6.25);
    expect(tasaDeImpuesto(" rdz mission ")).toBe(6.25);
    for (const t of ["RDZ McAllen", "RDZ Pharr", "RDZ Edinburg", "RDZ Weslaco", "RDZ Brownsville", "Bodega Azul", null, undefined, ""]) {
      expect(tasaDeImpuesto(t), String(t)).toBe(TASA_DE_IMPUESTO);
    }
  });
  it("100 de materiales: Mission paga 6.25 de impuesto y 106.25 en total; McAllen 8.25 y 108.25", () => {
    const l: UnitLine = { ...lineaUnidadVacia(), quantity: 1, unit_price: 100 };
    expect(resumenDeTotales([l], tasaDeImpuesto("RDZ Mission"))).toMatchObject({ tasa: 6.25, impuesto: 6.25, total: 106.25 });
    expect(resumenDeTotales([l], tasaDeImpuesto("RDZ McAllen"))).toMatchObject({ tasa: 8.25, impuesto: 8.25, total: 108.25 });
  });
});

describe("la hoja y la pantalla usan la tasa de la tienda", () => {
  it("la hoja de una cotización de Mission dice «Tax 6.25%»; la de otra tienda, «Tax 8.25%»", () => {
    const q = { ...borradorVacio(), lines: [{ ...lineaUnidadVacia(), quantity: 1, unit_price: 100 } as UnitLine] };
    expect(hojaDelCliente(q, "RDZ Mission").textoImpuesto).toBe("Tax 6.25%: $6.25");
    expect(hojaDelCliente(q, "RDZ Mission").total).toBe(106.25);
    expect(hojaDelCliente(q, "RDZ Pharr").textoImpuesto).toBe("Tax 8.25%: $8.25");
    expect(hojaDelCliente(q).textoImpuesto).toBe("Tax 8.25%: $8.25");
  });
  it("la pantalla, la lista y el demo pasan la tienda de la cotización a la tasa", () => {
    expect(sinComentarios(leer("src/app/estimator/Estimador.tsx"))).toContain("resumenDeTotales(draft.lines, tasaDeImpuesto(tiendaDeLaHoja(tiendaGuardada, me?.store)))");
    expect(sinComentarios(leer("src/lib/estimator/almacen.ts"))).toContain("total: resumenDeTotales(borrador.lines, tasaDeImpuesto(store)).total,");
    expect(sinComentarios(leer("src/lib/estimator/demo.ts"))).toContain("total: resumenDeTotales(q.draft.lines, tasaDeImpuesto(q.store)).total,");
    expect(sinComentarios(leer("src/lib/estimator/hoja.ts"))).toContain("const r = resumenDeTotales(q.lines, tasaDeImpuesto(tienda));");
  });
});
