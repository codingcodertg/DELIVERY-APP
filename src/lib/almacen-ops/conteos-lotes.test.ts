import { describe, expect, it } from "vitest";
import { motivoDeLotes, piezasPorUnidad, resumenDeLotes, totalDeLotes } from "./conteos";
import { lotesDeLaFila } from "./conteos-datos";

describe("lotes de un producto (19 nov: lote 123 = 100 cajas; lote 3A4 = 20 cajas)", () => {
  const lotes = [
    { qty: 100, lot: "123", note: null, photo: null },
    { qty: 20, lot: "3A4", note: "mojadas", photo: null },
  ];
  it("una caja vale las piezas por caja del producto; bolsa y pieza cuentan tal cual", () => {
    expect(piezasPorUnidad("box", 8)).toBe(8);
    expect(piezasPorUnidad("box", null)).toBe(1);
    expect(piezasPorUnidad("bag", 8)).toBe(1);
    expect(totalDeLotes(lotes, "box", 8)).toBe(960);
    expect(totalDeLotes(lotes, "piece", 8)).toBe(120);
    expect(totalDeLotes([], "box", 8)).toBeNull();
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
