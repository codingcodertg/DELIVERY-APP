import { describe, expect, it } from "vitest";
import { motivoDeLotes, piezasDeCajas, resumenDeLotes, textoDeCantidad, totalDeLotes } from "./conteos";
import { lotesDeLaFila } from "./conteos-datos";

describe("lotes de un producto (19 nov: lote 123 = 100 cajas; lote 3A4 = 20 cajas)", () => {
  const lotes = [
    { qty: 100, lot: "123", note: null, photo: null },
    { qty: 20, lot: "3A4", note: "mojadas", photo: null },
  ];
  it("el total se guarda en la unidad elegida, sin convertir (120 cajas = 120)", () => {
    expect(totalDeLotes(lotes)).toBe(120);
    expect(totalDeLotes([])).toBeNull();
  });
  it("las piezas se muestran solo para cajas con piezas por caja; nunca para bolsas o piezas", () => {
    expect(piezasDeCajas(25, "box", 12)).toBe(300);
    expect(piezasDeCajas(25, "box", null)).toBeNull();
    expect(piezasDeCajas(25, "bag", 12)).toBeNull();
    expect(piezasDeCajas(25, "piece", 12)).toBeNull();
  });
  it("el texto de la cantidad: «25 boxes · 300 pieces», «120 bags», «120 pieces»", () => {
    expect(textoDeCantidad(25, "box", 12, "en")).toBe("25 boxes · 300 pieces");
    expect(textoDeCantidad(25, "box", null, "en")).toBe("25 boxes");
    expect(textoDeCantidad(120, "bag", 12, "en")).toBe("120 bags");
    expect(textoDeCantidad(120, "piece", null, "es")).toBe("120 piezas");
    expect(textoDeCantidad(1, "box", null, "es")).toBe("1 caja");
    expect(textoDeCantidad(25, "box", 12, "es")).toBe("25 cajas · 300 piezas");
  });
  it("valida: unidad, al menos un lote, cantidades no negativas y que haya algo contado", () => {
    expect(motivoDeLotes(lotes, null)).toBe("unidad");
    expect(motivoDeLotes([], "box")).toBe("vacio");
    expect(motivoDeLotes([{ qty: -1, lot: null, note: null, photo: null }], "box")).toBe("cantidad");
    expect(motivoDeLotes([{ qty: 0, lot: null, note: null, photo: null }], "box")).toBe("cantidad");
    expect(motivoDeLotes([{ qty: NaN, lot: null, note: null, photo: null }], "box")).toBe("cantidad");
    expect(motivoDeLotes(lotes, "box")).toBeNull();
  });
  it("el resumen dice el lote y la cantidad en español", () => {
    expect(resumenDeLotes(lotes, "box", "es")).toBe("Lote 123: 100 cajas · Lote 3A4: 20 cajas");
  });
  it("los lotes que vienen de la base se leen; lo que no es un lote se descarta", () => {
    expect(lotesDeLaFila([{ qty: "5", lot: "A", note: null, photo: null }, "basura", { lot: "sin cantidad" }])).toEqual([{ qty: 5, lot: "A", note: null, photo: null }]);
    expect(lotesDeLaFila(null)).toEqual([]);
  });
});
