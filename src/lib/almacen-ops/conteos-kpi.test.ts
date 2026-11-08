import { describe, expect, it } from "vitest";
import { colorDeExactitud, conteosDelPeriodo, diasEntre, enPeriodo, kpiDeConteos, kpiPorEmpleado, periodoDeDias } from "./conteos-kpi";

/** 274: el KPI de conteos del gerente: hechos por tienda y periodo, exactitud, variación $, días hasta ajustar, por empleado. */
const c = (id: string, store: string, stage: "organizing" | "counting" | "review" | "adjusted" | "cancelled", created_at: string, adjusted_at: string | null = null) => ({ id, store, stage, created_at, adjusted_at });
const l = (count_id: string, system_qty: number | null, counted_total: number | null, price: number | null, by: string | null, nombre: string | null = by) =>
  ({ count_id, system_qty, counted_total, price, counted_at: counted_total == null ? null : "2026-11-05T10:00:00Z", counted_by: by, counted_by_name: nombre });

const periodo = { desde: "2026-11-01", hasta: "2026-11-30" };
const conteos = [
  c("a", "Pharr", "adjusted", "2026-11-02T08:00:00Z", "2026-11-04T08:00:00Z"), // 2 días
  c("b", "Pharr", "adjusted", "2026-11-10T08:00:00Z", "2026-11-13T08:00:00Z"), // 3 días
  c("v", "Pharr", "adjusted", "2026-10-02T08:00:00Z", "2026-10-05T08:00:00Z"), // fuera del periodo
  c("o", "Pharr", "counting", "2026-11-20T08:00:00Z"),
  c("x", "Pharr", "cancelled", "2026-11-21T08:00:00Z"),
  c("m", "McAllen", "adjusted", "2026-11-15T08:00:00Z", "2026-11-15T20:00:00Z"),
];
const lineas = [
  l("a", 100, 100, 10, "p1", "Ana"), l("a", 50, 48, 10, "p1", "Ana"), l("a", 20, 22, 5, "p2", "Luis"),
  l("b", 10, 10, 1, "p2", "Luis"), l("b", null, 7, 1, "p2", "Luis"), l("b", 5, null, 1, null),
  l("v", 10, 0, 100, "p1", "Ana"), // fuera del periodo: no suma
  l("o", 10, 9, 1, "p1", "Ana"), // abierto: no suma
  l("m", 10, 10, 1, "p3", "Mario"),
];

describe("el periodo", () => {
  it("por la fecha ISO, días inclusive", () => {
    expect(enPeriodo("2026-11-01T00:00:00Z", periodo)).toBe(true);
    expect(enPeriodo("2026-11-30T23:00:00Z", periodo)).toBe(true);
    expect(enPeriodo("2026-12-01T00:00:00Z", periodo)).toBe(false);
    expect(enPeriodo(null, periodo)).toBe(false);
  });
  it("los últimos N días hasta hoy", () => {
    expect(periodoDeDias("2026-11-08", 30)).toEqual({ desde: "2026-10-10", hasta: "2026-11-08" });
    expect(periodoDeDias("2026-11-08", 1)).toEqual({ desde: "2026-11-08", hasta: "2026-11-08" });
  });
  it("los conteos del periodo: ajustados dentro, los abiertos siempre, los cancelados solo si se abrieron dentro", () => {
    expect(conteosDelPeriodo(conteos, periodo).map((x) => x.id)).toEqual(["a", "b", "o", "x", "m"]);
  });
  it("días entre dos instantes", () => {
    expect(diasEntre("2026-11-02T08:00:00Z", "2026-11-04T08:00:00Z")).toBe(2);
    expect(diasEntre("2026-11-15T08:00:00Z", "2026-11-15T20:00:00Z")).toBe(0.5);
  });
});

describe("el KPI por tienda", () => {
  const [pharr, mcallen, vacia] = kpiDeConteos(conteos, lineas, periodo, ["Pharr", "McAllen", "Harlingen"]);
  it("hechos = ajustados en el periodo; abiertos y cancelados aparte", () => {
    expect(pharr).toMatchObject({ tienda: "Pharr", hechos: 2, abiertos: 1, cancelados: 1 });
    expect(mcallen).toMatchObject({ hechos: 1, abiertos: 0, cancelados: 0 });
    expect(vacia).toMatchObject({ hechos: 0, lineasContadas: 0, exactitudPct: null, variacionAbs: 0, diasPromedio: null });
  });
  it("exactitud = exactas / comparables (una línea sin sistema cuenta como contada pero no compara)", () => {
    expect(pharr.lineasContadas).toBe(5);
    expect(pharr.lineasExactas).toBe(2);
    expect(pharr.exactitudPct).toBe(50); // 2 de 4 comparables
  });
  it("variación $: |precio × dif| sumado, y la neta con signo", () => {
    expect(pharr.variacionAbs).toBe(30); // 20 + 10
    expect(pharr.variacionNeta).toBe(-10); // -20 + 10
  });
  it("días promedio de creado a ajustado, a 1 decimal", () => {
    expect(pharr.diasPromedio).toBe(2.5);
    expect(mcallen.diasPromedio).toBe(0.5);
  });
});

describe("por empleado", () => {
  it("líneas contadas y exactitud en los conteos ajustados del periodo; orden por líneas", () => {
    const g = kpiPorEmpleado(conteos, lineas, periodo);
    expect(g.map((x) => [x.nombre, x.lineas, x.exactas, x.exactitudPct])).toEqual([
      ["Luis", 3, 1, 50], // 22 vs 20 (no), 10 (sí), sin sistema (no compara)
      ["Ana", 2, 1, 50],
      ["Mario", 1, 1, 100],
    ]);
  });
  it("filtrado por tienda", () => {
    expect(kpiPorEmpleado(conteos, lineas, periodo, "McAllen").map((x) => x.nombre)).toEqual(["Mario"]);
  });
});

describe("el color", () => {
  it("≥ 95 verde, ≥ 85 ámbar, menos rojo, sin dato gris", () => {
    expect(colorDeExactitud(100)).toBe("verde");
    expect(colorDeExactitud(95)).toBe("verde");
    expect(colorDeExactitud(90)).toBe("ambar");
    expect(colorDeExactitud(84)).toBe("rojo");
    expect(colorDeExactitud(null)).toBe("gris");
  });
});
