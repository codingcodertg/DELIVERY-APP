import { describe, expect, it } from "vitest";
import { cantidadEnCajas, dineroDeLaDiferencia, faltaDeLotes, muestraPiezas } from "./conteos";

describe("faltaDeLotes: lo que falta, con su nombre", () => {
  it("sin unidad: dice que falta la unidad (sin número de lote)", () => {
    expect(faltaDeLotes([{ qty: "5", valor: 5 }], null, "en")).toEqual({ numero: null, texto: "Unit of measure is missing: choose boxes, bags or pieces." });
    expect(faltaDeLotes([{ qty: "5", valor: 5 }], null, "es")?.texto).toContain("unidad de medida");
  });

  it("con unidad y sin cantidad: nombra la unidad en plural y el lote", () => {
    expect(faltaDeLotes([{ qty: "", valor: NaN }], "box", "en")).toEqual({ numero: 1, texto: "Lot 1: boxes are missing." });
    expect(faltaDeLotes([{ qty: "  ", valor: NaN }], "box", "es")).toEqual({ numero: 1, texto: "Lote 1: faltan cajas." });
    expect(faltaDeLotes([{ qty: "", valor: NaN }], "piece", "en")?.texto).toBe("Lot 1: pieces are missing.");
  });

  it("una fila vacía no bloquea si otra lleva cantidad (las vacías no cuentan)", () => {
    expect(faltaDeLotes([{ qty: "", valor: NaN }, { qty: "4", valor: 4 }], "box", "en")).toBeNull();
  });

  it("una cantidad que no es número nombra el lote", () => {
    expect(faltaDeLotes([{ qty: "4", valor: 4 }, { qty: "x", valor: NaN }], "box", "es")).toEqual({ numero: 2, texto: "Lote 2: la cantidad no es un número válido." });
  });

  it("cantidades en cero: pide mayor que 0", () => {
    expect(faltaDeLotes([{ qty: "0", valor: 0 }], "bag", "en")).toEqual({ numero: 1, texto: "Lot 1: the quantity must be greater than 0." });
  });

  it("todo bien: null", () => {
    expect(faltaDeLotes([{ qty: "12", valor: 12 }], "box", "en")).toBeNull();
  });
});

describe("muestraPiezas: las piezas solo donde no son cajas", () => {
  it("cajas: no se muestran; bolsas y piezas: sí; sin unidad (líneas de antes): sí, como antes", () => {
    expect(muestraPiezas("box")).toBe(false);
    expect(muestraPiezas("bag")).toBe(true);
    expect(muestraPiezas("piece")).toBe(true);
    expect(muestraPiezas(null)).toBe(true);
    expect(muestraPiezas(undefined)).toBe(true);
  });
});

describe("cantidadEnCajas: cómo se lee, sin cambiar la cuenta", () => {
  it("una línea de cajas comparable (producto y piezas por caja) pasa de piezas a cajas", () => {
    expect(cantidadEnCajas(22, { unit_of_measure: "box", pieces_per_box: 2, product_id: 1 })).toBe(11);
    expect(cantidadEnCajas(5, { unit_of_measure: "box", pieces_per_box: 2, product_id: 1 })).toBe(2.5);
  });

  it("cajas sin piezas por caja (no comparables) ya vienen en cajas: no se tocan", () => {
    expect(cantidadEnCajas(11, { unit_of_measure: "box", pieces_per_box: null, product_id: 1 })).toBe(11);
  });

  it("bolsas, piezas, sin unidad o nulo: no cambian", () => {
    expect(cantidadEnCajas(30, { unit_of_measure: "bag", pieces_per_box: 2, product_id: 1 })).toBe(30);
    expect(cantidadEnCajas(30, { unit_of_measure: null, pieces_per_box: 2, product_id: 1 })).toBe(30);
    expect(cantidadEnCajas(null, { unit_of_measure: "box", pieces_per_box: 2, product_id: 1 })).toBeNull();
  });
});

describe("dineroDeLaDiferencia", () => {
  it("diferencia × precio, a 2 decimales, con signo; sin precio, null", () => {
    expect(dineroDeLaDiferencia(-4, 9.4)).toBe(-37.6);
    expect(dineroDeLaDiferencia(3, 9.95)).toBe(29.85);
    expect(dineroDeLaDiferencia(-4, null)).toBeNull();
  });
});
