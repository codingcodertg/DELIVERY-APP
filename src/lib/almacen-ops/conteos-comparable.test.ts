import { describe, expect, it } from "vitest";
import { comparableConElSistema, cuentasDeLinea, diferencia, hayDiferencias, requiereRazonDeLinea, totalDelSistema, valorDeLaDiferencia } from "./conteos";

const lote = (qty: number) => [{ qty, lot: null, note: null, photo: null }];
const base = { id: "a", system_qty: 100, price: 2, counted_at: "2026-11-19" };

describe("comparación con el sistema (espejo de la firma 336)", () => {
  it("1. caja de producto con piezas por caja: 25 × 12 = 300 piezas, comparable; la diferencia sí se calcula", () => {
    expect(totalDelSistema(lote(25), "box", 12, true)).toEqual({ total: 300, comparable: true });
    const l = { ...base, product_id: 1, unit_of_measure: "box" as const, pieces_per_box: 12, counted_total: 300, system_qty: 280 };
    expect(comparableConElSistema(l)).toBe(true);
    expect(diferencia(l)).toBe(20);
    expect(requiereRazonDeLinea(l, [])).toBe(true);
  });

  it("2. pieza de producto: tal cual, comparable; sin diferencia no pide razón", () => {
    expect(totalDelSistema(lote(40), "piece", null, true)).toEqual({ total: 40, comparable: true });
    const l = { ...base, product_id: 1, unit_of_measure: "piece" as const, pieces_per_box: 12, counted_total: 100 };
    expect(requiereRazonDeLinea(l, [])).toBe(false);
  });

  it("3. bolsa de producto del catálogo: se guarda como se contó, NO comparable, y SÍ pide razón aunque cuadre", () => {
    expect(totalDelSistema(lote(120), "bag", 12, true)).toEqual({ total: 120, comparable: false });
    const l = { ...base, product_id: 1, unit_of_measure: "bag" as const, pieces_per_box: 12, counted_total: 100 };
    expect(comparableConElSistema(l)).toBe(false);
    expect(diferencia(l)).toBeNull();
    expect(valorDeLaDiferencia(l)).toBeNull();
    expect(cuentasDeLinea(l, 0).diferencia).toBeNull();
    expect(requiereRazonDeLinea(l, [])).toBe(true);
    expect(hayDiferencias([l], [])).toBe(true);
  });

  it("4. producto libre (sin producto del catálogo): NO comparable y NO pide razón (no tiene sistema)", () => {
    expect(totalDelSistema(lote(7), "box", 12, false)).toEqual({ total: 7, comparable: false });
    const l = { id: "b", counted_at: "2026-11-19", system_qty: null, price: null, product_id: null, unit_of_measure: "piece" as const, pieces_per_box: null, counted_total: 7 };
    expect(comparableConElSistema(l)).toBe(false);
    expect(requiereRazonDeLinea(l, [])).toBe(false);
    expect(hayDiferencias([l], [])).toBe(false);
  });

  it("caja de producto SIN piezas por caja: no se puede convertir; NO comparable; pide razón", () => {
    expect(totalDelSistema(lote(3), "box", null, true)).toEqual({ total: 3, comparable: false });
    const l = { ...base, product_id: 1, unit_of_measure: "box" as const, pieces_per_box: null, counted_total: 3 };
    expect(requiereRazonDeLinea(l, [])).toBe(true);
  });

  it("líneas de antes (sin unidad): comparables como siempre", () => {
    expect(diferencia({ counted_total: 10, system_qty: 8 })).toBe(2);
    expect(comparableConElSistema({})).toBe(true);
  });
});
