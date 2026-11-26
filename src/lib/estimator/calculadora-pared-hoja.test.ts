import { describe, it, expect } from "vitest";
import { AJUSTES_POR_DEFECTO, ENTRADAS_POR_DEFECTO, calcular, camposQueAplican, lechadaDeSuperficie, type EntradasCalculadora } from "./calculadora-material";

// D-1203: la calculadora de pared es la hoja «Rodriguez_Wall_Calculator_Final» (26 nov 2026), con sus valores de ejemplo.
const pared = (cambio: Partial<EntradasCalculadora> = {}) => calcular({
  ...ENTRADAS_POR_DEFECTO, proyecto: "Wall Only", paredMetodo: "Square footage", paredAreaSf: 300, paredAberturasSf: 0,
  cajaParedSf: 19.26, tamanoPared: "24x24", juntaParedIn: 0.125, bordeExpuestoLf: 0, ...cambio,
}, AJUSTES_POR_DEFECTO);
const venta = (r: ReturnType<typeof calcular>, clave: string) => r.filas.find((f) => f.clave === clave)!.venta;

describe("calculadora de pared = la hoja nueva (D-1203)", () => {
  it("el ejemplo de la hoja: 300 SF, 24x24, junta 1/8, 19.26 SF por caja", () => {
    const r = pared();
    expect(r.areas.paredSf).toBe(300);
    expect(venta(r, "loseta-pared")).toBe(16);
    expect(venta(r, "pegamento-pared")).toBe(9);
    expect(venta(r, "lechada-arenada")).toBe(1);
    expect(venta(r, "lechada-sin-arena")).toBe(1);
    expect(venta(r, "clips")).toBe(6);
    expect(venta(r, "cunas")).toBe(1);
    expect(venta(r, "tablero")).toBe(20);
    expect(venta(r, "tornillos")).toBe(2);
    expect(venta(r, "malla")).toBe(3);
    expect(venta(r, "perfil")).toBe(0);
  });

  it("rendimiento de lechada en la referencia: 688 con arena y 722 sin arena (redondeado hacia abajo)", () => {
    const x = lechadaDeSuperficie("24x24", 0.125, 0.375, AJUSTES_POR_DEFECTO);
    expect(x.arenada).toBe(688);
    expect(x.sinArena).toBe(722);
  });

  it("junta de 1/16: con arena es N/A; junta de 1/4: sin arena es N/A", () => {
    expect(lechadaDeSuperficie("12x24", 1 / 16, 0.375, AJUSTES_POR_DEFECTO).arenada).toBe(0);
    expect(lechadaDeSuperficie("12x24", 0.25, 0.375, AJUSTES_POR_DEFECTO).sinArena).toBe(0);
    const r = pared({ juntaParedIn: 1 / 16 });
    const fila = r.filas.find((f) => f.clave === "lechada-arenada")!;
    expect(fila.venta).toBe(0);
    expect(fila.porPaquete).toBeNull();
    expect(fila.nota.es).toContain("N/A");
  });

  it("largo × alto menos aberturas", () => {
    expect(pared({ paredMetodo: "Dimensions", paredLargoFt: 20, paredAltoFt: 8, paredAberturasSf: 10 }).areas.paredSf).toBe(150);
    expect(pared({ paredAberturasSf: 50 }).areas.paredSf).toBe(250);
  });

  it("no trae silicón, impermeabilizante, salpicadero ni varios muros; sí tablero, clips y cuñas", () => {
    const c = camposQueAplican("Wall Only", AJUSTES_POR_DEFECTO);
    expect(c.filas).not.toContain("silicon");
    expect(c.filas).not.toContain("impermeable");
    expect(c.filas).toEqual(expect.arrayContaining(["tablero", "tornillos", "malla", "clips", "cunas", "lechada-arenada", "lechada-sin-arena"]));
    expect(c.entradas).not.toContain("salpicaderoLargoFt");
    expect(c.entradas).not.toContain("muros");
  });

  it("la lechada nueva también vale en ducha y piso (con dos superficies se suman las bolsas)", () => {
    const ducha = calcular(ENTRADAS_POR_DEFECTO, AJUSTES_POR_DEFECTO);
    expect(ducha.filas.find((f) => f.clave === "lechada-arenada")!.venta).toBeGreaterThan(0);
    expect(camposQueAplican("Flooring Only", AJUSTES_POR_DEFECTO).filas).toContain("lechada-sin-arena");
  });
});
