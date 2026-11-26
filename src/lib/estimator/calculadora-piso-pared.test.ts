import { describe, expect, it } from "vitest";
import {
  AJUSTES_POR_DEFECTO, CLAVES_DE_FILA, ENTRADAS_POR_DEFECTO, USO_DE_AJUSTES, USO_DE_ENTRADAS, USO_DE_FILAS, aplicaUso,
  calcular, type AjustesCalculadora, type ClaveDeFila, type EntradasCalculadora, type ResultadoCalculadora, type TipoDeProyecto,
} from "./calculadora-material";
import { limpiaHabitaciones, limpiaMuros } from "./calculadora-guardado";

const con = (patch: Partial<EntradasCalculadora>): EntradasCalculadora => ({ ...ENTRADAS_POR_DEFECTO, ...patch });
const correr = (tipo: TipoDeProyecto, patch: Partial<EntradasCalculadora> = {}, ajustes: Partial<AjustesCalculadora> = {}): ResultadoCalculadora =>
  calcular(con({ proyecto: tipo, ...patch }), { ...AJUSTES_POR_DEFECTO, ...ajustes });
const ventas = (r: ResultadoCalculadora) => Object.fromEntries(r.filas.map((f) => [f.clave, f.venta]));
const cantidad = (r: ResultadoCalculadora, clave: string) => r.filas.find((f) => f.clave === clave)!.cantidad;
/** Las filas que una calculadora muestra: las que aplican con estos ajustes. */
const filasQueAplican = (tipo: TipoDeProyecto, ajustes: AjustesCalculadora = AJUSTES_POR_DEFECTO): ClaveDeFila[] =>
  CLAVES_DE_FILA.filter((c) => aplicaUso(USO_DE_FILAS[c], tipo, ajustes));

const PISO = { habitaciones: [{ nombre: "Living", largoFt: 12, anchoFt: 10 }, { nombre: "Hall", largoFt: 4, anchoFt: 6 }] };

describe("calculadora de piso: varias habitaciones se suman", () => {
  const r = correr("Flooring Only", PISO);

  it("área de piso = 12×10 + 4×6 = 144 SF", () => {
    expect(r.areas.pisoSf).toBe(144);
    expect(r.areas.paredSf).toBe(0);
  });

  it("pegamento y loseta de piso sobre el total: 144 ÷ 25 = 6 bolsas, 144 ÷ 15.5 = 10 cajas", () => {
    expect(ventas(r)["pegamento-piso"]).toBe(6);
    expect(ventas(r)["loseta-piso"]).toBe(10);
  });

  it("la lechada es lineal en el área: igual que una sola habitación de 144 SF (12×12)", () => {
    const una = correr("Flooring Only", { habitaciones: [{ nombre: "Room", largoFt: 12, anchoFt: 12 }] });
    expect(ventas(r)["lechada-arenada"]).toBe(ventas(una)["lechada-arenada"]);
    expect(cantidad(r, "lechada-arenada")).toBe(144);
  });

  it("clips y cuñas por el total: 144 × 2 = 288 clips ÷ 100 = 3 paquetes", () => {
    expect(cantidad(r, "clips")).toBe(288);
    expect(ventas(r).clips).toBe(3);
    expect(ventas(r).cunas).toBe(3);
  });

  it("la explicación del área lista cada habitación y la suma", () => {
    const x = r.explicacionAreas.pisoSf;
    expect(x.pasos.map((p) => p.en)).toEqual([
      "Living: 12 × 10 = 120 SF",
      "Hall: 4 × 6 = 24 SF",
      "Floor area = 120 + 24 = 144 SF",
    ]);
    expect(x.pasos[0].es).toBe("Living: 12 × 10 = 120 SF");
  });

  it("una sola habitación por defecto da lo mismo que antes: 5 × 3 = 15 SF", () => {
    const d = correr("Flooring Only");
    expect(d.areas.pisoSf).toBe(15);
    expect(ventas(d)["loseta-piso"]).toBe(1);
  });

  it("una habitación con medida negativa cuenta 0, sin restar a las demás", () => {
    const x = correr("Flooring Only", { habitaciones: [{ nombre: "A", largoFt: -3, anchoFt: 10 }, { nombre: "B", largoFt: 4, anchoFt: 6 }] });
    expect(x.areas.pisoSf).toBe(24);
  });

  it("solo aplican las filas de piso: pegamento, loseta, lechada, perfil, clips y cuñas", () => {
    expect(filasQueAplican("Flooring Only")).toEqual(["pegamento-piso", "loseta-piso", "lechada-arenada", "lechada-sin-arena", "perfil", "clips", "cunas"]);
  });
});

describe("calculadora de pared: una pared (D-1203)", () => {
  const r = correr("Wall Only", { paredMetodo: "Dimensions", paredLargoFt: 10, paredAltoFt: 8, paredAberturasSf: 10 });

  it("pared = 10 × 8 − 10 = 70 SF; sin perímetro ni salpicadero", () => {
    expect(r.areas).toEqual({ pisoSf: 0, paredSf: 70, perimetroLf: 0, tablerosPaneles: 5 });
  });

  it("loseta: 70 ÷ 15.5 = 5 cajas; pegamento: 70 ÷ 35 = 2 bolsas", () => {
    expect(ventas(r)["loseta-pared"]).toBe(5);
    expect(ventas(r)["pegamento-pared"]).toBe(2);
  });

  it("sin silicón ni impermeabilizante; tablero 70 ÷ 15 = 5 paneles", () => {
    expect(ventas(r).silicon).toBe(0);
    expect(ventas(r).impermeable).toBe(0);
    expect(ventas(r).tablero).toBe(5);
  });

  it("la explicación del área: largo × alto y la resta de aberturas", () => {
    expect(r.explicacionAreas.paredSf.pasos.map((p) => p.en)).toEqual(["Wall = 10 ft × 8 ft = 80 SF", "Net = 80 − 10 = 70 SF"]);
  });

  it("más aberturas que área: 0", () => {
    expect(correr("Wall Only", { paredMetodo: "Square footage", paredAreaSf: 5, paredAberturasSf: 9 }).areas.paredSf).toBe(0);
  });

  it("clips 70 × 2 = 140 → 2 paquetes; cuñas 70 × 0.3 = 21 → 1 paquete", () => {
    expect(ventas(r).clips).toBe(2);
    expect(cantidad(r, "cunas")).toBe(21);
    expect(ventas(r).cunas).toBe(1);
  });

  it("aplican: tablero, tornillos, malla, pegamento, loseta, dos lechadas, perfil, clips y cuñas", () => {
    expect(filasQueAplican("Wall Only")).toEqual(["tablero", "tornillos", "malla", "pegamento-pared", "loseta-pared", "lechada-arenada", "lechada-sin-arena", "perfil", "clips", "cunas"]);
  });
});

describe("la tabla de usos", () => {
  it("cada campo de entrada y cada ajuste tiene su fila de uso (lo fuerza el tipo, esto lo deja a la vista)", () => {
    expect(Object.keys(USO_DE_ENTRADAS)).toHaveLength(Object.keys(ENTRADAS_POR_DEFECTO).length);
    expect(Object.keys(USO_DE_AJUSTES)).toHaveLength(Object.keys(AJUSTES_POR_DEFECTO).length);
  });

  it("los campos de ducha no aparecen en piso ni en pared; liner y mortero son solo de ducha", () => {
    const duchaSolo: TipoDeProyecto[] = ["Shower"];
    expect(USO_DE_ENTRADAS.subidaLinerIn.usa).toEqual(duchaSolo);
    expect(USO_DE_ENTRADAS.morteroProfundidadIn.usa).toEqual(duchaSolo);
    expect(USO_DE_ENTRADAS.disposicion.usa).toEqual(duchaSolo);
    expect(USO_DE_FILAS.liner.usa).toEqual(duchaSolo);
    expect(USO_DE_FILAS.mortero.usa).toEqual(duchaSolo);
    expect(USO_DE_FILAS.coladera.usa).toEqual(duchaSolo);
  });

  it("la pendiente solo aparece con C33 = 1", () => {
    expect(filasQueAplican("Shower")).not.toContain("pendiente");
    expect(filasQueAplican("Shower", { ...AJUSTES_POR_DEFECTO, preslopeIncluido: 1 })).toContain("pendiente");
  });

  it("los ajustes que la hoja no usa en ninguna fórmula no aparecen en ninguna calculadora", () => {
    expect(USO_DE_AJUSTES.tableroCoberturaSf.usa).toEqual([]);
    expect(USO_DE_AJUSTES.liner_subidaSinUsoIn.usa).toEqual([]);
    expect(USO_DE_AJUSTES.liner_bordeSinUsoIn.usa).toEqual([]);
    expect(USO_DE_AJUSTES.tableroUnidadLf.usa).toEqual([]);
    expect(USO_DE_AJUSTES.impermeableReferenciaGal.usa).toEqual([]);
  });
});

describe("lo guardado antes de estas calculadoras", () => {
  it("sin filas guardadas, la primera habitación y el primer muro salen de las medidas que había", () => {
    expect(limpiaHabitaciones(undefined)).toBeNull();
    expect(limpiaMuros(undefined)).toBeNull();
  });

  it("una lista válida se conserva; una inválida o vacía no", () => {
    expect(limpiaHabitaciones([{ nombre: "Sala", largoFt: 12, anchoFt: 10 }])).toEqual([{ nombre: "Sala", largoFt: 12, anchoFt: 10 }]);
    expect(limpiaHabitaciones([])).toBeNull();
    expect(limpiaHabitaciones([{ nombre: "X", largoFt: "12", anchoFt: 10 }])).toBeNull();
    expect(limpiaMuros([{ nombre: "M", largoFt: 5, altoFt: 8, aberturasSf: 0 }, { largoFt: 3, altoFt: 8, aberturasSf: 1 }]))
      .toEqual([{ nombre: "M", largoFt: 5, altoFt: 8, aberturasSf: 0 }, { nombre: "Wall 2", largoFt: 3, altoFt: 8, aberturasSf: 1 }]);
  });
});
