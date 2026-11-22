import { describe, expect, it } from "vitest";
import { cambio, granoDe, hoyDelPanel, periodoAnterior, resumenDelPeriodo, resumenPor, seriePorPeriodo } from "./panel-resumen";
import type { Delivery } from "./types";

const D = (p: Partial<Delivery>): Delivery => ({
  id: Math.random().toString(36).slice(2), stage: "delivered", store: "RDZ Pharr", delivery_date: "2026-11-10", delivery_windows: "0830-1730",
  created_at: "2026-11-09T15:00:00", updated_at: "2026-11-10T16:00:00", pod_delivered_at: "2026-11-10T16:00:00",
  est_pallets: 2, actual_pallets: null, delivery_fee: 50, route_miles: 10, order_type: "Customer", assigned_driver: "Julio", redelivery_of: null, ...p,
} as Delivery);

const HOY = "2026-11-12";

describe("resumen del Panel (D-1127)", () => {
  const ordenes = [
    D({}),                                                                          // a tiempo, ciclo 25 h
    D({ pod_delivered_at: "2026-11-10T19:00:00", updated_at: "2026-11-10T19:00:00" }), // fuera de ventana, mismo día: ciclo 28 h
    D({ pod_delivered_at: "2026-11-11T09:00:00", updated_at: "2026-11-11T09:00:00" }), // al día siguiente: ciclo 42 h
    D({ stage: "canceled", pod_delivered_at: null }),
    D({ stage: "ready", pod_delivered_at: null, delivery_date: "2026-11-11" }),      // abierta y vencida
    D({ stage: "approved", pod_delivered_at: null, delivery_date: "2026-11-12", assigned_driver: null }),
  ];

  it("cuenta, a tiempo en ventana y en el día, ciclo mediano y canceladas", () => {
    const r = resumenDelPeriodo(ordenes, HOY);
    expect(r).toMatchObject({ ordenes: 6, entregadas: 3, abiertas: 2, vencidas: 1, canceladas: 1, canceladasPct: 17, aTiempoPct: 33, aTiempoDiaPct: 67, cicloHoras: 28 });
    expect(r.pallets).toBe(10);
    expect(r.cobros).toBe(250);
    expect(r.millas).toBe(50);
  });

  it("sin entregadas no inventa porcentajes", () => {
    const r = resumenDelPeriodo([D({ stage: "approved", pod_delivered_at: null })], HOY);
    expect(r.aTiempoPct).toBeNull();
    expect(r.cicloHoras).toBeNull();
  });

  it("periodo anterior: misma duración, justo antes", () => {
    expect(periodoAnterior("2026-11-01", "2026-11-30")).toEqual({ from: "2026-10-02", to: "2026-10-31" });
    expect(periodoAnterior("2026-11-12", "2026-11-12")).toEqual({ from: "2026-11-11", to: "2026-11-11" });
    // Un mes se compara con el mes anterior: los mismos días, o el mes entero.
    expect(periodoAnterior("2026-11-01", "2026-11-22", true)).toEqual({ from: "2026-10-01", to: "2026-10-22" });
    expect(periodoAnterior("2026-10-01", "2026-10-31", true)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodoAnterior("2026-01-01", "2026-01-31", true)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("cambio: en % para cantidades y en puntos para porcentajes; sin base no hay cambio", () => {
    expect(cambio(120, 100)).toMatchObject({ valor: 20, texto: "20%", sube: true });
    expect(cambio(80, 100)).toMatchObject({ valor: -20, sube: false });
    expect(cambio(67, 72, true)).toMatchObject({ valor: -5, texto: "5 pts", sube: false });
    expect(cambio(76, 77, true)?.texto).toBe("1 pt");
    expect(cambio(5, 0)).toBeNull();
    expect(cambio(null, 10)).toBeNull();
    expect(cambio(10, 10)).toBeNull();
  });

  it("la serie va por día hasta 35 días, por semana hasta medio año, y luego por mes", () => {
    expect(granoDe("2026-11-01", "2026-11-30")).toBe("dia");
    expect(granoDe("2026-09-01", "2026-11-30")).toBe("semana");
    expect(granoDe("2026-01-01", "2026-11-30")).toBe("mes");
    const s = seriePorPeriodo(ordenes, "2026-11-09", "2026-11-12", (d) => d.order_type === "Intertienda", HOY);
    expect(s.cubetas.map((c) => c.inicio)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(s.cubetas[1]).toMatchObject({ clientes: 3, traslados: 0, entregadas: 3, canceladas: 1 });
    expect(s.cubetas[0].entregadas).toBe(0);
  });

  it("hoy: lo del día por etapa, y lo atorado de cualquier fecha", () => {
    const h = hoyDelPanel([...ordenes, D({ delivery_date: HOY }), D({ stage: "pending", pod_delivered_at: null })], HOY);
    expect(h.total).toBe(2);
    expect(h.entregadas).toBe(1);
    expect(h.porEtapa.find((e) => e.etapa === "approved")?.n).toBe(1);
    expect(h.vencidas).toHaveLength(1);
    expect(h.sinChofer).toHaveLength(1);
    expect(h.porAprobar).toHaveLength(1);
  });

  it("por tienda: una fila por tienda, la de más órdenes primero", () => {
    const filas = resumenPor([...ordenes, D({ store: "RDZ McAllen" })], (d) => d.store, HOY);
    expect(filas.map((f) => [f.clave, f.ordenes])).toEqual([["RDZ Pharr", 6], ["RDZ McAllen", 1]]);
  });
});
