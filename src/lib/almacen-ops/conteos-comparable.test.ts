import { describe, expect, it } from "vitest";
import { cuentasDeLinea, diferencia, divisorDeCajas, hayDiferencias, requiereRazonDeLinea, totalDelSistema, unidadDeLaCuenta, valorDeLaDiferencia } from "./conteos";

// 2026-11-24 (dueño): «counted − pending = actual, y cuando se compare con el system entonces difference debería match».
// Toda línea contada tiene real (contado − pendiente) y diferencia (real − sistema) si se sabe el sistema. Ninguna línea
// queda «no comparable»; la razón se pide solo si hay diferencia distinta de 0 después de las pendientes.

const lote = (qty: number) => [{ qty, lot: null, note: null, photo: null }];
const base = { id: "a", system_qty: 100, price: 2, counted_at: "2026-11-19" };

describe("el real y la diferencia en todas las líneas contadas (regla 2026-11-24)", () => {
  it("1. caja de producto con piezas por caja: 25 × 12 = 300 piezas; la diferencia sí se calcula", () => {
    expect(totalDelSistema(lote(25), "box", 12, true)).toEqual({ total: 300, comparable: true });
    const l = { ...base, product_id: 1, unit_of_measure: "box" as const, pieces_per_box: 12, counted_total: 300, system_qty: 280 };
    expect(cuentasDeLinea(l, 0)).toMatchObject({ real: 300, diferencia: 20 });
    expect(diferencia(l)).toBe(20);
    expect(requiereRazonDeLinea(l, [])).toBe(true);
    expect(unidadDeLaCuenta(l)).toBe("piece");
    expect(divisorDeCajas(l)).toBe(12);
  });

  it("2. pieza de producto: tal cual; sin diferencia no pide razón", () => {
    expect(totalDelSistema(lote(40), "piece", null, true)).toEqual({ total: 40, comparable: true });
    const l = { ...base, product_id: 1, unit_of_measure: "piece" as const, pieces_per_box: 12, counted_total: 100 };
    expect(requiereRazonDeLinea(l, [])).toBe(false);
  });

  it("3. bolsa de producto del catálogo que cuadra: real 100, diferencia 0 y NO pide razón", () => {
    expect(totalDelSistema(lote(120), "bag", 12, true)).toEqual({ total: 120, comparable: false });
    const l = { ...base, product_id: 1, unit_of_measure: "bag" as const, pieces_per_box: 12, counted_total: 100 };
    expect(cuentasDeLinea(l, 0)).toMatchObject({ real: 100, diferencia: 0 });
    expect(diferencia(l)).toBe(0);
    expect(valorDeLaDiferencia(l)).toBe(0);
    expect(requiereRazonDeLinea(l, [])).toBe(false);
    expect(hayDiferencias([l], [])).toBe(false);
    expect(divisorDeCajas(l)).toBe(1);
  });

  it("3b. bolsa contada 5, pendiente 2, sistema 3: real 3, diferencia 0, sin razón", () => {
    const l = { id: "a", counted_at: "2026-11-19", counted_total: 5, system_qty: 3, price: 2, product_id: 1, unit_of_measure: "bag" as const, pieces_per_box: null };
    const pend = [{ line_id: "a", qty: 2 }];
    expect(cuentasDeLinea(l, 2)).toMatchObject({ real: 3, diferencia: 0 });
    expect(requiereRazonDeLinea(l, pend)).toBe(false);
    expect(hayDiferencias([l], pend)).toBe(false);
  });

  it("3c. bolsa contada 5, pendiente 0, sistema 3: real 5, diferencia +2, pide razón", () => {
    const l = { id: "a", counted_at: "2026-11-19", counted_total: 5, system_qty: 3, price: 2, product_id: 1, unit_of_measure: "bag" as const, pieces_per_box: null };
    expect(cuentasDeLinea(l, 0)).toMatchObject({ real: 5, diferencia: 2 });
    expect(requiereRazonDeLinea(l, [])).toBe(true);
    expect(hayDiferencias([l], [])).toBe(true);
    expect(divisorDeCajas(l)).toBe(1);
  });

  it("4. producto libre con sistema tecleado: SE COMPARA; contado 12, sistema 10 → diferencia +2, pide razón", () => {
    const l = { id: "b", counted_at: "2026-11-19", system_qty: 10, price: null, product_id: null, unit_of_measure: "piece" as const, pieces_per_box: null, counted_total: 12 };
    expect(cuentasDeLinea(l, 0)).toMatchObject({ real: 12, diferencia: 2 });
    expect(requiereRazonDeLinea(l, [])).toBe(true);
    expect(hayDiferencias([l], [])).toBe(true);
  });

  it("4b. producto libre sin sistema tecleado: no hay diferencia y no pide razón", () => {
    const l = { id: "b", counted_at: "2026-11-19", system_qty: null, price: null, product_id: null, unit_of_measure: "piece" as const, pieces_per_box: null, counted_total: 7 };
    expect(cuentasDeLinea(l, 0)).toMatchObject({ real: 7, diferencia: null });
    expect(requiereRazonDeLinea(l, [])).toBe(false);
    expect(hayDiferencias([l], [])).toBe(false);
  });

  it("caja de producto SIN piezas por caja: se compara en cajas (1 = 1); con diferencia pide razón", () => {
    expect(totalDelSistema(lote(3), "box", null, true)).toEqual({ total: 3, comparable: false });
    const l = { ...base, product_id: 1, unit_of_measure: "box" as const, pieces_per_box: null, counted_total: 3 };
    expect(cuentasDeLinea(l, 0)).toMatchObject({ real: 3, diferencia: -97 });
    expect(requiereRazonDeLinea(l, [])).toBe(true);
    expect(unidadDeLaCuenta(l)).toBe("box");
    expect(divisorDeCajas(l)).toBe(1);
  });

  it("contado null: real y diferencia null (no hay nada que comparar)", () => {
    const l = { ...base, product_id: 1, unit_of_measure: "bag" as const, pieces_per_box: null, counted_total: null };
    expect(cuentasDeLinea(l, 0)).toMatchObject({ real: null, diferencia: null });
    expect(diferencia(l)).toBeNull();
    expect(requiereRazonDeLinea(l, [])).toBe(false);
  });

  it("líneas de antes (sin unidad): piezas, como siempre", () => {
    expect(diferencia({ counted_total: 10, system_qty: 8 })).toBe(2);
    expect(unidadDeLaCuenta({ unit_of_measure: null, pieces_per_box: null })).toBe("piece");
  });
});
