import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { lineaSfVacia, pareceDeCaja, precioDeCaja, precioPorSfDeCaja, SF_PRECIO_SOSPECHOSO, totalDeLinea } from "./modelo";

/* D-NEXT. Roberto, 2026-10-24: «Formula is wrong. Its Sf/box times boxes times price», con 104 cajas de 19.26 SF a «26.77
 * $/SF» = $53,621.38. La fórmula ya era cajas × SF/caja × $/SF; el 26.77 era el precio de la caja. El dueño: «sí a todo»
 * (un campo $/caja y un aviso). */
const linea = (precio: number | null) => ({ ...lineaSfVacia(), requested_sf: 2000, sf_per_box: 19.26, boxes: 104, price_per_sf: precio });

describe("el precio por caja", () => {
  it("el caso de Roberto: la fórmula da lo mismo de siempre, y con el $/caja la línea sale a lo que valen las cajas", () => {
    expect(totalDeLinea(linea(26.77))).toBe(53621.38);
    const sf = precioPorSfDeCaja(26.77, 19.26);
    expect(sf).toBe(1.389927);
    // 104 cajas × $26.77 = $2,784.08: con el $/SF de 6 decimales, exacto; con 1.39 (2 decimales) se irían 15 centavos.
    expect(totalDeLinea(linea(sf))).toBe(2784.08);
    expect(totalDeLinea(linea(1.39))).toBe(2784.23);
  });
  it("el campo $/caja enseña el $/SF ya multiplicado, y sin SF por caja no hay cuenta", () => {
    expect(precioDeCaja(1.389927, 19.26)).toBe(26.77);
    expect(precioDeCaja(null, 19.26)).toBeNull();
    expect(precioPorSfDeCaja(26.77, null)).toBeNull();
    expect(precioPorSfDeCaja(26.77, 0)).toBeNull();
    expect(precioPorSfDeCaja(0, 19.26)).toBe(0);
  });
  it("el aviso: más de $15/SF con cajas de más de 1 SF parece el de la caja, y propone el $/SF", () => {
    expect(SF_PRECIO_SOSPECHOSO).toBe(15);
    expect(pareceDeCaja(26.77, 19.26)).toBe(1.389927);
    expect(pareceDeCaja(15, 19.26)).toBeNull();
    expect(pareceDeCaja(8.99, 10)).toBeNull();
    // Con una pieza de 1 SF o menos (un listelo, una pieza suelta) un precio alto puede ser de verdad.
    expect(pareceDeCaja(26.77, 1)).toBeNull();
    expect(pareceDeCaja(null, 19.26)).toBeNull();
  });
  it("la pantalla: el campo $/caja escribe el $/SF y el aviso lo arregla a un clic", () => {
    const pantalla = readFileSync("src/app/estimator/Estimador.tsx", "utf8").split("\r\n").join("\n");
    expect(pantalla).toContain("onValor={(n) => setLinea(l.id, { price_per_sf: precioPorSfDeCaja(n, l.sf_per_box) })} />");
    expect(pantalla).toContain('{l.kind === "sf" && pareceDeCaja(l.price_per_sf, l.sf_per_box) !== null && (');
    expect(pantalla).toContain("onClick={() => setLinea(l.id, { price_per_sf: pareceDeCaja(l.price_per_sf, l.sf_per_box) })}>");
  });
});
