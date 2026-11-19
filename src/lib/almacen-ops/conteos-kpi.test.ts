import { describe, expect, it } from "vitest";
import {
  colorDeExactitud, conteosDelPeriodo, diasEntre, enPeriodo, kpiDeConteos, kpiPorEmpleado, mesVecino, periodoDeDias, periodoDeMes, totalDeConteos,
} from "./conteos-kpi";

const conteos = [
  { id: "c1", store: "Pharr", stage: "adjusted" as const, created_at: "2026-11-01T10:00:00Z", adjusted_at: "2026-11-05T10:00:00Z" },
  { id: "c2", store: "Pharr", stage: "adjusted" as const, created_at: "2026-10-01T10:00:00Z", adjusted_at: "2026-10-20T10:00:00Z" },
  { id: "c3", store: "McAllen", stage: "cancelled" as const, created_at: "2026-11-03T10:00:00Z", adjusted_at: null },
  { id: "c4", store: "McAllen", stage: "organizing" as const, created_at: "2026-10-15T10:00:00Z", adjusted_at: null },
];
const linea = (x: Record<string, unknown>) => ({
  id: "l", count_id: "c1", system_qty: 0, counted_total: 0, price: 1, pieces_per_box: null, counted_at: "2026-11-02T10:00:00Z", counted_by: "p1", counted_by_name: "Ana", ...x,
});
const lineas = [
  linea({ id: "l1", system_qty: 100, counted_total: 80, price: 2, pieces_per_box: 4 }),        // falta 20 pzas = 5 cajas, $40
  linea({ id: "l2", system_qty: 50, counted_total: 50, price: 3, pieces_per_box: 2 }),         // exacta
  linea({ id: "l3", system_qty: 10, counted_total: 14, price: 1, pieces_per_box: 2 }),         // 14 − 4 pendientes = 10: exacta
  linea({ id: "l4", system_qty: 10, counted_total: 7, price: 1, pieces_per_box: null }),       // falta 3 pzas sin caja, $3
  linea({ id: "l5", count_id: "c3", system_qty: 9, counted_total: 1, price: 1, pieces_per_box: 1 }), // cancelado: no cuenta
];
const pendientes = [{ line_id: "l3", qty: 4 }];

describe("el periodo", () => {
  it("por la fecha ISO, días inclusive", () => {
    expect(enPeriodo("2026-11-30T23:59:00Z", { desde: "2026-11-01", hasta: "2026-11-30" })).toBe(true);
    expect(enPeriodo("2026-12-01T00:00:00Z", { desde: "2026-11-01", hasta: "2026-11-30" })).toBe(false);
    expect(enPeriodo(null, { desde: "2026-11-01", hasta: "2026-11-30" })).toBe(false);
  });
  it("un mes calendario: del 1 al último día (bisiesto incluido)", () => {
    expect(periodoDeMes("2026-11")).toEqual({ desde: "2026-11-01", hasta: "2026-11-30" });
    expect(periodoDeMes("2028-02")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(periodoDeMes("2026-13")).toBeNull();
  });
  it("el mes vecino cruza el año", () => {
    expect(mesVecino("2026-01", -1)).toBe("2025-12");
    expect(mesVecino("2026-12", 1)).toBe("2027-01");
    expect(mesVecino("2026-11", 1)).toBe("2026-12");
  });
  it("los conteos del periodo: ajustados dentro, los abiertos siempre, los cancelados solo si se abrieron dentro", () => {
    const ids = conteosDelPeriodo(conteos, { desde: "2026-11-01", hasta: "2026-11-30" }).map((c) => c.id);
    expect(ids).toEqual(["c1", "c3", "c4"]);
  });
  it("días entre dos instantes, y los últimos N días", () => {
    expect(diasEntre("2026-11-01T00:00:00Z", "2026-11-05T00:00:00Z")).toBe(4);
    expect(periodoDeDias("2026-11-19", 3)).toEqual({ desde: "2026-11-17", hasta: "2026-11-19" });
  });
});

describe("el KPI del mes por tienda: la diferencia es DESPUÉS de las órdenes pendientes", () => {
  const mes = { desde: "2026-11-01", hasta: "2026-11-30" };
  const [pharr, mca] = kpiDeConteos(conteos, lineas, pendientes, mes, ["Pharr", "McAllen"]);

  it("Pharr: faltan 20 piezas = 5 cajas (las líneas sin caja van aparte), $43; sobran 0; exactitud 2 de 4", () => {
    expect(pharr).toMatchObject({
      tienda: "Pharr", hechos: 1, faltanPiezas: 23, faltanCajas: 5, faltanPiezasSinCaja: 3, sobranPiezas: 0, sobranCajas: 0,
      faltanValor: 43, sobranValor: 0, netoValor: -43, lineasContadas: 4, lineasExactas: 2, lineasComparables: 4, exactitudPct: 50, pendientePiezas: 4, diasPromedio: 4,
    });
  });
  it("McAllen: sin conteos ajustados en el mes; el cancelado no entra a las líneas; abiertos ahora = 1", () => {
    expect(mca).toMatchObject({ hechos: 0, lineasContadas: 0, exactitudPct: null, faltanCajas: 0, abiertos: 1, cancelados: 1, diasPromedio: null });
  });
  it("una línea que cuadra solo por la pendiente cuenta como exacta", () => {
    const [p] = kpiDeConteos(conteos, [linea({ id: "x", count_id: "c1", system_qty: 10, counted_total: 14, price: 1, pieces_per_box: 2 })], [{ line_id: "x", qty: 4 }], mes, ["Pharr"]);
    expect(p.lineasExactas).toBe(1);
    expect(p.faltanPiezas).toBe(0);
  });
  it("el sobrante va a cajas y $ con signo aparte", () => {
    const [p] = kpiDeConteos(conteos, [linea({ id: "y", count_id: "c1", system_qty: 10, counted_total: 18, price: 2, pieces_per_box: 4 })], [], mes, ["Pharr"]);
    expect(p).toMatchObject({ sobranPiezas: 8, sobranCajas: 2, sobranValor: 16, faltanCajas: 0, netoValor: 16 });
  });
});

describe("el total de la tienda suma las tiendas; la exactitud sale de las líneas comparables", () => {
  it("totalDeConteos: cajas que faltan del mes, exactitud total", () => {
    const mes = { desde: "2026-11-01", hasta: "2026-11-30" };
    const filas = kpiDeConteos(conteos, lineas, pendientes, mes, ["Pharr", "McAllen"]);
    expect(totalDeConteos(filas)).toMatchObject({ hechos: 1, faltanCajas: 5, faltanPiezasSinCaja: 3, faltanValor: 43, lineasComparables: 4, lineasExactas: 2, exactitudPct: 50 });
  });
  it("sin líneas comparables, exactitud null", () => {
    expect(totalDeConteos([]).exactitudPct).toBeNull();
  });
});

describe("por empleado: líneas contadas y exactas después de pendientes, en los conteos ajustados del mes", () => {
  it("Ana: 4 líneas, 2 exactas, 50%", () => {
    const e = kpiPorEmpleado(conteos, lineas, pendientes, { desde: "2026-11-01", hasta: "2026-11-30" }, "Pharr");
    expect(e).toEqual([{ id: "p1", nombre: "Ana", lineas: 4, exactas: 2, exactitudPct: 50 }]);
  });
});

describe("el color", () => {
  it("≥ 95 verde, ≥ 85 ámbar, menos rojo, sin dato gris", () => {
    expect(colorDeExactitud(95)).toBe("verde");
    expect(colorDeExactitud(85)).toBe("ambar");
    expect(colorDeExactitud(84)).toBe("rojo");
    expect(colorDeExactitud(null)).toBe("gris");
  });
});
