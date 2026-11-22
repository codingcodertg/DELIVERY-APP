import { describe, expect, it } from "vitest";
import { lunesDe, pivotea, SIN_DATO } from "./pivote";
import type { Delivery } from "./types";

const D = (p: Partial<Delivery>): Delivery => ({ stage: "approved", store: "RDZ Pharr", delivery_date: "2026-11-23", est_pallets: 1, delivery_fee: 50, route_miles: 10, ...p } as Delivery);
const ordenes = [
  D({ store: "RDZ Pharr", stage: "delivered", assigned_driver: "Julio" }),
  D({ store: "RDZ Pharr", stage: "approved", assigned_driver: "Julio", est_pallets: 3 }),
  D({ store: "RDZ McAllen", stage: "delivered", assigned_driver: "Steven", delivery_date: "2026-11-30" }),
  D({ store: "", stage: "ready", assigned_driver: null }),
];

describe("tabla dinámica del Panel (D-1127)", () => {
  it("cruza filas × columnas y suma", () => {
    const p = pivotea(ordenes, "store", "stage", "orders", undefined, ["approved", "ready", "delivered"]);
    expect(p.filas).toEqual(["RDZ Pharr", "RDZ McAllen", SIN_DATO]);
    expect(p.columnas).toEqual(["approved", "ready", "delivered"]);
    expect(p.celda("RDZ Pharr", "delivered")).toBe(1);
    expect(p.totalFila("RDZ Pharr")).toBe(2);
    expect(p.totalColumna("delivered")).toBe(2);
    expect(p.total).toBe(4);
  });

  it("medidas: entregadas, pallets, cobros", () => {
    expect(pivotea(ordenes, "driver", "none", "delivered").totalFila("Julio")).toBe(1);
    expect(pivotea(ordenes, "driver", "none", "pallets").totalFila("Julio")).toBe(4);
    expect(pivotea(ordenes, "store", "none", "fees").total).toBe(200);
  });

  it("las fechas van en orden de calendario y la semana empieza el lunes", () => {
    expect(lunesDe("2026-11-26")).toBe("2026-11-23");
    expect(pivotea(ordenes, "week", "none", "orders").filas).toEqual(["2026-11-23", "2026-11-30"]);
  });
});
