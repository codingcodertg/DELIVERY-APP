import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-NEXT: los campos obligatorios de una línea se pintan en rojo (`.invalid`, como en Órdenes) mientras falten: SF pedidos
 * o Cajas, SF / caja y $/SF regular; en la línea por unidad, Cantidad y Precio unitario regular.
 */
const p = readFileSync(join(process.cwd(), "src/app/estimator/Estimador.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("la línea en rojo", () => {
  it("cada campo obligatorio de la línea lleva su inv(...)", () => {
    for (const [ancla, cond] of [
      ["data-requested", "cajasDeLinea(l) === null"],
      ["data-cajas", "cajasDeLinea(l) === null"],
      ["data-sfcaja", "l.sf_per_box !== null && l.sf_per_box > 0"],
      ["data-precio ", "l.price_per_sf !== null && l.price_per_sf >= 0"],
      ["data-cantidad", "l.quantity !== null && l.quantity > 0"],
      ["data-precio-unidad", "l.unit_price !== null && l.unit_price >= 0"],
    ]) {
      const i = p.indexOf(ancla);
      expect(i, ancla).toBeGreaterThan(0);
      expect(p.slice(i, i + 160), ancla).toContain(cond);
    }
  });
  it("los opcionales no: $/caja, descuento, nota", () => {
    for (const ancla of ["data-precio-bajo", "data-precio-caja", "placeholder=\"Main Floor\""]) {
      const i = p.indexOf(ancla);
      if (i < 0) continue;
      expect(p.slice(i, i + 160), ancla).not.toContain("inv(");
    }
  });
});
