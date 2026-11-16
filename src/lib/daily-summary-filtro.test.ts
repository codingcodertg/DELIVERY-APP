import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDailySummary, cabeEnElResumen, COLUMNAS_DEL_RESUMEN, filtroDelResumen } from "./daily-summary";
import type { Delivery } from "./types";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");

const HOY = "2026-11-16";
const etiqueta = (d: Delivery) => `${d.order_no}`;

const base = {
  stage: "approved", delivery_date: "2026-11-01", pod_delivered_at: null, assigned_driver: null, account: null,
  created_at: "2026-10-20T10:00:00+00:00", order_code: null, order_no: 1, order_suffix: null, relay_step: null,
  actual_pallets: null, est_pallets: 1, id: "x",
};
const orden = (id: string, n: number, extra: Partial<Record<string, unknown>>) => ({ ...base, id, order_no: n, ...extra }) as unknown as Delivery;

/** Órdenes que cubren cada rama del resumen y casos de borde (medianoche UTC, otro día, sin chofer, etc.). */
const todas: Delivery[] = [
  orden("en-camion-vieja", 10, { stage: "picked_up", delivery_date: "2026-10-01", assigned_driver: "Ana" }),
  orden("entregada-hoy-con-pod", 11, { stage: "delivered", delivery_date: "2026-11-10", pod_delivered_at: "2026-11-16T15:04:05.123+00:00", assigned_driver: "Ana" }),
  orden("entregada-hoy-sin-pod", 12, { stage: "delivered", delivery_date: HOY, pod_delivered_at: null, assigned_driver: "Luis" }),
  orden("entregada-ayer-con-pod-hoy-programada", 13, { stage: "delivered", delivery_date: HOY, pod_delivered_at: "2026-11-15T23:59:59+00:00", assigned_driver: "Luis" }),
  orden("programada-hoy-no-entregada", 14, { stage: "fulfilling", delivery_date: HOY, assigned_driver: "Ana" }),
  orden("atrasada-sin-chofer", 15, { stage: "ready", delivery_date: "2026-11-05" }),
  orden("atrasada-con-chofer", 16, { stage: "ready", delivery_date: "2026-11-05", assigned_driver: "Ana" }),
  orden("creada-hoy-medianoche", 17, { stage: "draft", delivery_date: "2026-12-01", created_at: `${HOY}T00:00:00+00:00` }),
  orden("creada-ayer-23h", 18, { stage: "draft", delivery_date: "2026-12-01", created_at: "2026-11-15T23:59:59+00:00" }),
  orden("creada-manana", 19, { stage: "draft", delivery_date: "2026-12-01", created_at: "2026-11-17T00:00:00+00:00" }),
  orden("cancelada-vieja", 20, { stage: "canceled", delivery_date: "2026-09-01" }),
  orden("futura-sin-chofer", 21, { stage: "approved", delivery_date: "2026-12-20" }),
  orden("borrador-sin-fecha", 22, { stage: "draft", delivery_date: null }),
];

describe("filtroDelResumen y COLUMNAS_DEL_RESUMEN", () => {
  it("el filtro trae las cinco ramas, con límites UTC del día y el día siguiente", () => {
    const f = filtroDelResumen(HOY);
    expect(f).toBe(
      "stage.eq.picked_up," +
        "delivery_date.eq.2026-11-16," +
        "and(created_at.gte.2026-11-16T00:00:00Z,created_at.lt.2026-11-17T00:00:00Z)," +
        "and(pod_delivered_at.gte.2026-11-16T00:00:00Z,pod_delivered_at.lt.2026-11-17T00:00:00Z)," +
        "and(assigned_driver.is.null,stage.in.(approved,fulfilling,ready),delivery_date.lt.2026-11-16)",
    );
  });

  it("cambio de mes: el día siguiente se calcula bien", () => {
    expect(filtroDelResumen("2026-11-30")).toContain("created_at.lt.2026-12-01T00:00:00Z");
  });

  it("las columnas son las que el resumen y la etiqueta de la orden leen, sin `*`", () => {
    const cols = COLUMNAS_DEL_RESUMEN.split(",");
    expect(cols).not.toContain("*");
    for (const c of ["id", "stage", "delivery_date", "pod_delivered_at", "assigned_driver", "account", "created_at", "order_code", "order_no", "order_suffix", "relay_step", "actual_pallets", "est_pallets"]) {
      expect(cols).toContain(c);
    }
  });
});

describe("el filtro no deja fuera nada que el resumen cuente", () => {
  it("el resumen sobre el subconjunto que trae el filtro es idéntico al resumen sobre TODAS", () => {
    const subconjunto = todas.filter((d) => cabeEnElResumen(d, HOY));
    expect(subconjunto.length).toBeLessThan(todas.length); // el filtro sí descarta algo
    expect(buildDailySummary(subconjunto, [], HOY, etiqueta)).toEqual(buildDailySummary(todas, [], HOY, etiqueta));
  });

  it("y se repite para otros días, incluido uno sin nada", () => {
    for (const dia of ["2026-11-01", "2026-11-05", "2026-11-15", "2026-12-20", "2027-01-01"]) {
      const subconjunto = todas.filter((d) => cabeEnElResumen(d, dia));
      expect(buildDailySummary(subconjunto, [], dia, etiqueta)).toEqual(buildDailySummary(todas, [], dia, etiqueta));
    }
  });
});

describe("la ruta del resumen de Notion usa el filtro y deja de leer los turnos", () => {
  const ruta = leer("src/app/api/notion-summary/route.ts");

  it("selecciona solo las columnas del resumen y filtra con el `or` de la fecha", () => {
    expect(ruta).toContain(".select(COLUMNAS_DEL_RESUMEN)");
    expect(ruta).toContain(".or(filtroDelResumen(date))");
    expect(ruta).not.toContain('.select("*")');
  });

  it("no consulta driver_shifts", () => {
    expect(ruta).not.toContain("driver_shifts");
  });
});
