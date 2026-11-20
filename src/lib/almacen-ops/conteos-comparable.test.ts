import { describe, expect, it } from "vitest";
import { cuentasDeLinea, diferencia, hayDiferencias, totalDelSistema, valorDeLaDiferencia } from "./conteos";

const lote = (qty: number) => [{ qty, lot: null, note: null, photo: null }];

describe("lo que se compara con el sistema va en piezas, o no se compara (19 nov, gerente)", () => {
  it("1. caja de producto con piezas por caja: cajas × piezas por caja (25 cajas × 12 = 300), comparable", () => {
    expect(totalDelSistema(lote(25), "box", 12, true)).toEqual({ total: 300, comparable: true });
  });

  it("2. pieza de producto: tal cual, comparable", () => {
    expect(totalDelSistema(lote(40), "piece", null, true)).toEqual({ total: 40, comparable: true });
    expect(totalDelSistema(lote(40), "piece", 12, true)).toEqual({ total: 40, comparable: true });
  });

  it("3. bolsa: se guarda como se contó y NO es comparable; no hay diferencia aunque el sistema tenga cantidad", () => {
    const r = totalDelSistema(lote(120), "bag", 12, true);
    expect(r).toEqual({ total: 120, comparable: false });
    const linea = { counted_total: r.total, counted_comparable: r.comparable, system_qty: 100, price: 2 };
    expect(diferencia(linea)).toBeNull();
    expect(valorDeLaDiferencia(linea)).toBeNull();
    expect(cuentasDeLinea(linea, 0).diferencia).toBeNull();
    expect(cuentasDeLinea(linea, 0).real).toBeNull();
    expect(hayDiferencias([{ id: "a", system_qty: 100, counted_total: 120, price: 2, counted_at: "2026-11-19", counted_comparable: false }], [])).toBe(false);
  });

  it("4. producto libre (sin producto del catálogo): como se contó, NO comparable, aunque sea caja con piezas", () => {
    expect(totalDelSistema(lote(7), "box", null, false)).toEqual({ total: 7, comparable: false });
    expect(totalDelSistema(lote(7), "box", 12, false)).toEqual({ total: 7, comparable: false });
    expect(totalDelSistema(lote(7), "piece", null, false)).toEqual({ total: 7, comparable: false });
  });

  it("caja de producto SIN piezas por caja: no se puede convertir, no es comparable", () => {
    expect(totalDelSistema(lote(3), "box", null, true)).toEqual({ total: 3, comparable: false });
  });

  it("la diferencia de una línea comparable sí se calcula (300 contadas − 280 del sistema = +20)", () => {
    const linea = { counted_total: 300, counted_comparable: true, system_qty: 280, price: 1 };
    expect(diferencia(linea)).toBe(20);
    expect(cuentasDeLinea(linea, 0).diferencia).toBe(20);
  });

  it("las líneas de antes (sin la marca) se comparan como siempre", () => {
    expect(diferencia({ counted_total: 10, system_qty: 8 })).toBe(2);
  });
});
