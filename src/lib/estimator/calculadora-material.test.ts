import { describe, expect, it } from "vitest";
import {
  AJUSTES_META, AJUSTES_POR_DEFECTO, ENTRADAS_POR_DEFECTO, calcular, medidasDeLaLoseta, paquetesNecesarios,
  type EntradasCalculadora, type ResultadoCalculadora,
} from "./calculadora-material";

const con = (patch: Partial<EntradasCalculadora>): EntradasCalculadora => ({ ...ENTRADAS_POR_DEFECTO, ...patch });
const correr = (patch: Partial<EntradasCalculadora> = {}): ResultadoCalculadora =>
  calcular(con(patch), AJUSTES_POR_DEFECTO);
/** clave de fila → a vender (E). */
const ventas = (r: ResultadoCalculadora) => Object.fromEntries(r.filas.map((f) => [f.clave, f.venta]));
const cantidad = (r: ResultadoCalculadora, clave: string) => r.filas.find((f) => f.clave === clave)!.cantidad;

describe("valores por defecto de la hoja (Shower, 5×3×8, 3 Walls)", () => {
  const r = correr();

  it("áreas: piso 15, pared 91, perímetro 11, paneles 7", () => {
    expect(r.areas).toEqual({ pisoSf: 15, paredSf: 91, perimetroLf: 11, tablerosPaneles: 7 });
  });

  it("tablero: 17.6 LF calculados y 21 LF a vender", () => {
    expect(r.tablerosLf).toBeCloseTo(17.6, 10);
    expect(ventas(r).tablero).toBe(21);
  });

  it("a vender, fila por fila, igual que la columna E cacheada", () => {
    expect(ventas(r)).toEqual({
      liner: 1,
      mortero: 5,
      tablero: 21,
      tornillos: 1,
      malla: 1,
      impermeable: 3,
      "pegamento-pared": 4,
      "pegamento-piso": 1,
      "loseta-pared": 6,
      "loseta-piso": 1,
      lechada: 1,
      silicon: 2,
      perfil: 0,
      clips: 3,
      cunas: 3,
      coladera: 1,
      pendiente: 0,
    });
  });

  it("cantidades sin redondear de la columna C", () => {
    expect(cantidad(r, "liner")).toBe(24);
    expect(cantidad(r, "mortero")).toBe(2.5);
    expect(cantidad(r, "tornillos")).toBe(210);
    expect(cantidad(r, "malla")).toBe(42);
    expect(cantidad(r, "impermeable")).toBe(103);
    expect(cantidad(r, "pegamento-pared")).toBe(91);
    expect(cantidad(r, "pegamento-piso")).toBe(15);
    expect(cantidad(r, "loseta-pared")).toBe(91);
    expect(cantidad(r, "loseta-piso")).toBe(15);
    expect(cantidad(r, "silicon")).toBe(27);
    expect(cantidad(r, "clips")).toBe(212);
    expect(cantidad(r, "cunas")).toBe(212);
    expect(cantidad(r, "coladera")).toBe(1);
  });

  it("lechada: 8.101 lb, a 1 bolsa de 25 lb", () => {
    expect(cantidad(r, "lechada")).toBeCloseTo(8.101051010844825, 9);
  });

  it("por paquete (columna D) de las filas con paquete", () => {
    const por = Object.fromEntries(r.filas.map((f) => [f.clave, f.porPaquete]));
    expect(por.liner).toBe(35);
    expect(por.mortero).toBe(0.5);
    expect(por.tablero).toBe(1);
    expect(por.tornillos).toBe(575);
    expect(por.malla).toBe(50);
    expect(por.impermeable).toBe(40);
    expect(por["pegamento-pared"]).toBe(25);
    expect(por["loseta-pared"]).toBe(15.5);
    expect(por.lechada).toBe(25);
    expect(por.silicon).toBe(25);
    expect(por.perfil).toBe(8);
    expect(por.clips).toBe(100);
    expect(por.coladera).toBe(1);
    expect(por.pendiente).toBe(0.5);
  });

  it("los rótulos de unidad de la hoja (F) están en cada fila", () => {
    const unidad = Object.fromEntries(r.filas.map((f) => [f.clave, f.unidad.en]));
    expect(unidad).toMatchObject({
      liner: "5×7 pieces", mortero: "bags", tablero: "LF", tornillos: "boxes", malla: "rolls", impermeable: "gallons",
      "loseta-pared": "boxes", lechada: "bags", silicon: "tubes", perfil: "pieces", clips: "packs", cunas: "packs",
      coladera: "each", pendiente: "bags",
    });
  });
});

describe("Flooring Only (5×3, sin pared)", () => {
  const r = correr({ proyecto: "Flooring Only" });

  it("áreas: piso 15, pared 0, perímetro 0, paneles 0", () => {
    expect(r.areas).toEqual({ pisoSf: 15, paredSf: 0, perimetroLf: 0, tablerosPaneles: 0 });
  });

  it("solo piso: pegamento y loseta de piso, lechada del piso, clips y cuñas", () => {
    expect(ventas(r)).toEqual({
      liner: 0,
      mortero: 0,
      tablero: 0,
      tornillos: 0,
      malla: 0,
      impermeable: 0,
      "pegamento-pared": 0,
      "pegamento-piso": 1,
      "loseta-pared": 0,
      "loseta-piso": 1,
      lechada: 1,
      silicon: 0,
      perfil: 0,
      clips: 1,
      cunas: 1,
      coladera: 0,
      pendiente: 0,
    });
  });

  it("la lechada del piso sola: 2.00 lb", () => {
    expect(cantidad(r, "lechada")).toBeCloseTo(2.0019, 3);
  });
});

describe("Wall Only (5 ft de largo, 8 ft de alto, 3 Walls sin efecto)", () => {
  const r = correr({ proyecto: "Wall Only" });

  it("áreas: piso 0, pared 43 (5×8 + 3 SF de salpicadero), perímetro 5, paneles 0", () => {
    expect(r.areas).toEqual({ pisoSf: 0, paredSf: 43, perimetroLf: 5, tablerosPaneles: 0 });
  });

  it("solo pared: loseta, pegamento y lechada de pared, silicón a alto × 2, clips y cuñas", () => {
    expect(ventas(r)).toEqual({
      liner: 0,
      mortero: 0,
      tablero: 0,
      tornillos: 0,
      malla: 0,
      impermeable: 0,
      "pegamento-pared": 2,
      "pegamento-piso": 0,
      "loseta-pared": 3,
      "loseta-piso": 0,
      lechada: 1,
      silicon: 1,
      perfil: 0,
      clips: 1,
      cunas: 1,
      coladera: 0,
      pendiente: 0,
    });
    expect(cantidad(r, "silicon")).toBe(16);
    expect(cantidad(r, "clips")).toBe(86);
  });
});

describe("Shower 4 Walls (5×3×8, con salpicadero de 3 SF)", () => {
  const r = correr({ disposicion: "4 Walls" });

  it("áreas: piso 15, pared 131 (8 × 16 ft de perímetro + 3), perímetro 16, paneles 10", () => {
    expect(r.areas).toEqual({ pisoSf: 15, paredSf: 131, perimetroLf: 16, tablerosPaneles: 10 });
  });

  it("tablero: (131 − 3) / 5 = 25.6 LF, a vender 10 paneles × 3 = 30 LF", () => {
    expect(r.tablerosLf).toBeCloseTo(25.6, 10);
    expect(ventas(r).tablero).toBe(30);
  });

  it("materiales derivados de 10 paneles, 131 SF de pared y 128 SF de agua", () => {
    expect(ventas(r)).toEqual({
      liner: 1,
      mortero: 5,
      tablero: 30,
      tornillos: 1,
      malla: 2,
      impermeable: 4,
      "pegamento-pared": 6,
      "pegamento-piso": 1,
      "loseta-pared": 9,
      "loseta-piso": 1,
      lechada: 1,
      silicon: 2,
      perfil: 0,
      clips: 3,
      cunas: 3,
      coladera: 1,
      pendiente: 0,
    });
    expect(cantidad(r, "impermeable")).toBe(143);
    expect(cantidad(r, "silicon")).toBe(48);
    expect(cantidad(r, "clips")).toBe(292);
  });
});

describe("funciones auxiliares", () => {
  it("medidasDeLaLoseta parte «largo x ancho» como LEFT/MID de la hoja", () => {
    expect(medidasDeLaLoseta("24x48")).toEqual([24, 48]);
    expect(medidasDeLaLoseta("8x8")).toEqual([8, 8]);
    expect(medidasDeLaLoseta("17x17")).toEqual([17, 17]);
  });

  it("paquetesNecesarios = ROUNDUP(c/d) y 0 cuando falta algún dato", () => {
    expect(paquetesNecesarios(91, 15.5)).toBe(6);
    expect(paquetesNecesarios(15, 15.5)).toBe(1);
    expect(paquetesNecesarios(0, 25)).toBe(0);
    expect(paquetesNecesarios(10, 0)).toBe(0);
    expect(paquetesNecesarios(-3, 25)).toBe(0);
  });

  it("cada ajuste de la hoja 2 tiene su celda y su valor por defecto", () => {
    const claves = AJUSTES_META.map((m) => m.clave).sort();
    expect(claves).toEqual(Object.keys(AJUSTES_POR_DEFECTO).sort());
    expect(AJUSTES_META).toHaveLength(35);
  });
});
