import { describe, expect, it } from "vitest";
import { alternarFiltroDeKpi, gruposDeKpiVisibles } from "./kpi-almacen-filtro";

describe("KPI de almacén: los botones de la izquierda filtran (D-NEXT, ayuda de Roberto, 24 nov 2026)", () => {
  it("sin filtro se ven todos los grupos, en el orden de la pantalla", () => {
    expect(gruposDeKpiVisibles("todos")).toEqual(["listas", "merma", "tiempo", "mantenimiento", "conteos"]);
  });

  it("con un filtro solo se ve su categoría; listas y tiempo nunca aparecen con filtro", () => {
    expect(gruposDeKpiVisibles("merma")).toEqual(["merma"]);
    expect(gruposDeKpiVisibles("mantenimiento")).toEqual(["mantenimiento"]);
    expect(gruposDeKpiVisibles("conteos")).toEqual(["conteos"]);
    for (const f of ["merma", "mantenimiento", "conteos"] as const) {
      expect(gruposDeKpiVisibles(f)).not.toContain("listas");
      expect(gruposDeKpiVisibles(f)).not.toContain("tiempo");
    }
  });

  it("pulsar un filtro distinto cambia a ese; pulsar el mismo lo quita", () => {
    expect(alternarFiltroDeKpi("todos", "merma")).toBe("merma");
    expect(alternarFiltroDeKpi("merma", "merma")).toBe("todos");
    expect(alternarFiltroDeKpi("merma", "conteos")).toBe("conteos");
    expect(alternarFiltroDeKpi("conteos", "mantenimiento")).toBe("mantenimiento");
  });
});
