// ============================================================
// Tabla dinámica del Panel (D-1127). Roberto: «no se puede ver fácil la info para los managers». Una tabla que cruza
// filas × columnas (tienda, chofer, cuenta, tipo, etapa, vendedor, día, semana, mes) y suma un valor (órdenes,
// entregadas, pallets, cobros, millas). Pura, para probarla; la pantalla está en `TablaDinamica.tsx`.
// ============================================================

import type { Delivery } from "./types";

export type Dimension = "store" | "driver" | "account" | "type" | "stage" | "rep" | "day" | "week" | "month" | "none";
export type Medida = "orders" | "delivered" | "pallets" | "fees" | "miles";

export const DIMENSIONES: { key: Dimension; en: string; es: string }[] = [
  { key: "store", en: "Store", es: "Tienda" },
  { key: "driver", en: "Driver", es: "Chofer" },
  { key: "account", en: "Account", es: "Cuenta" },
  { key: "type", en: "Order type", es: "Tipo de orden" },
  { key: "stage", en: "Stage", es: "Etapa" },
  { key: "rep", en: "Salesperson", es: "Vendedor" },
  { key: "day", en: "Day", es: "Día" },
  { key: "week", en: "Week", es: "Semana" },
  { key: "month", en: "Month", es: "Mes" },
];

export const MEDIDAS: { key: Medida; en: string; es: string }[] = [
  { key: "orders", en: "Orders", es: "Órdenes" },
  { key: "delivered", en: "Delivered", es: "Entregadas" },
  { key: "pallets", en: "Pallets", es: "Pallets" },
  { key: "fees", en: "Delivery fees", es: "Cobros de entrega" },
  { key: "miles", en: "Miles", es: "Millas" },
];

export const SIN_DATO = "—";

/** Lunes de la semana de una fecha YYYY-MM-DD. */
export function lunesDe(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia);
  return d.toISOString().slice(0, 10);
}

export function claveDe(d: Delivery, dim: Dimension, nombreDe: (id: string | null) => string | null): string {
  switch (dim) {
    case "store": return d.store || SIN_DATO;
    case "driver": return d.assigned_driver || SIN_DATO;
    case "account": return d.account || d.delivery_name || SIN_DATO;
    case "type": return d.order_type || SIN_DATO;
    case "stage": return d.stage;
    case "rep": return d.assigned_sales_rep || nombreDe(d.created_by) || SIN_DATO;
    case "day": return d.delivery_date || SIN_DATO;
    case "week": return d.delivery_date ? lunesDe(d.delivery_date) : SIN_DATO;
    case "month": return d.delivery_date ? d.delivery_date.slice(0, 7) : SIN_DATO;
    case "none": return "";
  }
}

export function valorDe(d: Delivery, m: Medida): number {
  switch (m) {
    case "orders": return 1;
    case "delivered": return d.stage === "delivered" ? 1 : 0;
    case "pallets": return Number(d.actual_pallets ?? d.est_pallets ?? 0) || 0;
    case "fees": return Number(d.delivery_fee ?? 0) || 0;
    case "miles": return Number(d.route_miles ?? 0) || 0;
  }
}

export interface Pivote {
  filas: string[];
  columnas: string[];
  celda: (f: string, c: string) => number;
  totalFila: (f: string) => number;
  totalColumna: (c: string) => number;
  total: number;
  max: number;
}

const ORDEN_DE_FECHA: Dimension[] = ["day", "week", "month"];

export function pivotea(
  ordenes: readonly Delivery[], filasPor: Dimension, columnasPor: Dimension, medida: Medida,
  nombreDe: (id: string | null) => string | null = () => null, ordenEtapas: readonly string[] = [],
): Pivote {
  const m = new Map<string, number>();
  const tf = new Map<string, number>();
  const tc = new Map<string, number>();
  let total = 0;
  for (const d of ordenes) {
    const f = claveDe(d, filasPor, nombreDe), c = claveDe(d, columnasPor, nombreDe), v = valorDe(d, medida);
    m.set(f + "\u0000" + c, (m.get(f + "\u0000" + c) ?? 0) + v);
    tf.set(f, (tf.get(f) ?? 0) + v);
    tc.set(c, (tc.get(c) ?? 0) + v);
    total += v;
  }
  const ordena = (keys: string[], dim: Dimension, totales: Map<string, number>) => {
    if (ORDEN_DE_FECHA.includes(dim)) return keys.sort();
    if (dim === "stage" && ordenEtapas.length) return keys.sort((a, b) => ordenEtapas.indexOf(a) - ordenEtapas.indexOf(b));
    return keys.sort((a, b) => (a === SIN_DATO ? 1 : b === SIN_DATO ? -1 : (totales.get(b) ?? 0) - (totales.get(a) ?? 0) || a.localeCompare(b)));
  };
  // Lo que suma cero no se pinta (un chofer sin entregas en «entregadas»): una fila de puros puntos no dice nada.
  const conAlgo = (keys: string[], totales: Map<string, number>) => { const v = keys.filter((k) => (totales.get(k) ?? 0) !== 0); return v.length ? v : keys; };
  const filas = ordena(conAlgo([...tf.keys()], tf), filasPor, tf);
  const columnas = ordena(conAlgo([...tc.keys()], tc), columnasPor, tc);
  const r = (n: number) => Math.round(n * 100) / 100;
  let max = 0;
  for (const v of m.values()) max = Math.max(max, v);
  return {
    filas, columnas,
    celda: (f, c) => r(m.get(f + "\u0000" + c) ?? 0),
    totalFila: (f) => r(tf.get(f) ?? 0),
    totalColumna: (c) => r(tc.get(c) ?? 0),
    total: r(total),
    max,
  };
}

/** Vistas listas para el gerente: lo que más se pregunta, a un clic. */
export const VISTAS_RAPIDAS: { key: string; en: string; es: string; filas: Dimension; columnas: Dimension; medida: Medida }[] = [
  { key: "tienda-etapa", en: "Orders by store × stage", es: "Órdenes por tienda × etapa", filas: "store", columnas: "stage", medida: "orders" },
  { key: "chofer-semana", en: "Deliveries by driver × week", es: "Entregas por chofer × semana", filas: "driver", columnas: "week", medida: "delivered" },
  { key: "tienda-mes-cobros", en: "Fees by store × month", es: "Cobros por tienda × mes", filas: "store", columnas: "month", medida: "fees" },
  { key: "cuenta-tienda", en: "Top accounts × store", es: "Cuentas principales × tienda", filas: "account", columnas: "store", medida: "orders" },
  { key: "tienda-tipo-pallets", en: "Pallets by store × order type", es: "Pallets por tienda × tipo", filas: "store", columnas: "type", medida: "pallets" },
];
