import type { Delivery, DriverShift } from "@/lib/types";
import { palletsDeLaOrden } from "./pallets";
import { sumaPallets } from "./pallets";

// ============================================================
// The day, in the few lines someone will actually read.
//
// Kept free of Notion, HTTP and React so it can be tested on its own — and so
// the same summary could be emailed or posted anywhere else later without
// rewriting the thinking.
//
// Deliberately short. A daily report that lists everything gets skimmed once
// and then ignored; this answers "did the day go out, and what is stuck?".
// ============================================================

export interface DailySummary {
  date: string;
  delivered: number;
  /** Delivered on a day other than the one they were scheduled for. */
  lateDelivered: number;
  stillOut: number;
  /** Scheduled for the day and never delivered. */
  missed: number;
  created: number;
  /** Live work past its date with nobody driving it — any day, not just this one. */
  overdueUnassigned: number;
  perDriver: { driver: string; delivered: number; pallets: number }[];
  /** Orders that need a person to do something, named so they can be found. */
  attention: string[];
}

const done = (d: Delivery) => d.stage === "delivered";
const day = (v: string | null | undefined) => (v ?? "").slice(0, 10);
const pallets = (d: Delivery) => palletsDeLaOrden(d);

/**
 * Build the summary for `date` (business date, YYYY-MM-DD).
 *
 * `label` turns an order into something findable in the report — the order
 * code, which is what anyone would search for.
 */
export function buildDailySummary(
  deliveries: Delivery[],
  shifts: DriverShift[],
  date: string,
  label: (d: Delivery) => string,
): DailySummary {
  const scheduled = deliveries.filter((d) => day(d.delivery_date) === date);

  // Delivered ON this date, by when it actually happened rather than when it
  // was scheduled — an order that slipped a day still counts on the day the
  // driver handed it over.
  const deliveredToday = deliveries.filter((d) => done(d) && day(d.pod_delivered_at ?? d.delivery_date) === date);

  // Se juntan las órdenes y los pallets salen de `sumaPallets` al final (D-363): este resumen
  // imprime el número TAL CUAL en Notion, así que era el único sitio del barrido donde la cola de
  // la coma flotante llegaba de verdad a una persona — «4.430000000000001 pallets».
  const perDriver = new Map<string, { delivered: number; suyas: Delivery[] }>();
  for (const d of deliveredToday) {
    const who = d.assigned_driver || "—";
    const cur = perDriver.get(who) ?? { delivered: 0, suyas: [] as Delivery[] };
    cur.delivered += 1;
    cur.suyas.push(d);
    perDriver.set(who, cur);
  }

  const missed = scheduled.filter((d) => !done(d) && !["canceled", "rejected", "draft"].includes(d.stage));
  const overdueUnassigned = deliveries.filter((d) =>
    !d.assigned_driver &&
    ["approved", "fulfilling", "ready"].includes(d.stage) &&
    !!d.delivery_date && day(d.delivery_date) < date);

  return {
    date,
    delivered: deliveredToday.length,
    lateDelivered: deliveredToday.filter((d) => day(d.delivery_date) !== date).length,
    stillOut: deliveries.filter((d) => d.stage === "picked_up").length,
    missed: missed.length,
    created: deliveries.filter((d) => day(d.created_at) === date).length,
    overdueUnassigned: overdueUnassigned.length,
    perDriver: [...perDriver.entries()]
      .map(([driver, v]) => ({ driver, delivered: v.delivered, pallets: sumaPallets(v.suyas) }))
      .sort((a, b) => b.delivered - a.delivered || a.driver.localeCompare(b.driver)),
    // Named, not counted: "3 orders are stuck" sends someone hunting. Capped
    // because a report with forty order codes in it is a wall, not a summary.
    attention: [...missed, ...overdueUnassigned]
      .filter((d, i, arr) => arr.findIndex((x) => x.id === d.id) === i)
      .slice(0, 15)
      .map((d) => `#${label(d)}${d.account ? ` · ${d.account}` : ""}${d.assigned_driver ? ` · ${d.assigned_driver}` : ` · sin chofer`}`),
  };
}

/**
 * Las columnas de `deliveries` que el resumen lee (las de `buildDailySummary` y las de `orderLabel`). Nada más.
 */
export const COLUMNAS_DEL_RESUMEN =
  "id,stage,delivery_date,pod_delivered_at,assigned_driver,account,created_at,order_code,order_no,order_suffix,relay_step,actual_pallets,est_pallets";

/**
 * El filtro (sintaxis `or` de PostgREST) que trae TODAS las órdenes que `buildDailySummary(…, date)` puede contar, y ninguna
 * más. No basta con «las de hoy»: el resumen también cuenta las que están en camión sin importar la fecha y las
 * atrasadas sin chofer de cualquier día. Por eso son cinco ramas: en camión; programadas hoy; creadas hoy; entregadas hoy
 * (por su sello de entrega); y atrasadas sin chofer. Los límites son UTC, igual que el `slice(0, 10)` de `day()` sobre
 * las marcas que devuelve PostgREST.
 */
export function filtroDelResumen(date: string): string {
  const siguiente = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const desde = `${date}T00:00:00Z`;
  const hasta = `${siguiente}T00:00:00Z`;
  return [
    "stage.eq.picked_up",
    `delivery_date.eq.${date}`,
    `and(created_at.gte.${desde},created_at.lt.${hasta})`,
    `and(pod_delivered_at.gte.${desde},pod_delivered_at.lt.${hasta})`,
    `and(assigned_driver.is.null,stage.in.(approved,fulfilling,ready),delivery_date.lt.${date})`,
  ].join(",");
}

/**
 * Espejo en JS del filtro de arriba, para probar que no deja fuera nada que el resumen cuente. Lo usa la prueba; la ruta
 * no lo llama.
 */
export function cabeEnElResumen(d: Partial<Delivery>, date: string): boolean {
  const ini = Date.parse(`${date}T00:00:00Z`);
  const fin = ini + 86400000;
  const enDia = (marca: string | null | undefined) => !!marca && Date.parse(marca) >= ini && Date.parse(marca) < fin;
  if (d.stage === "picked_up") return true;
  if (day(d.delivery_date) === date) return true;
  if (enDia(d.created_at)) return true;
  if (enDia(d.pod_delivered_at)) return true;
  return !d.assigned_driver && ["approved", "fulfilling", "ready"].includes(d.stage ?? "") && !!d.delivery_date && day(d.delivery_date) < date;
}

/** The summary as plain lines, for Notion, an email, or a log. */
export function summaryLines(s: DailySummary, lang: "en" | "es" = "es"): string[] {
  const es = lang === "es";
  const out: string[] = [];
  out.push(es
    ? `${s.delivered} entregadas · ${s.missed} sin entregar · ${s.created} creadas`
    : `${s.delivered} delivered · ${s.missed} not delivered · ${s.created} created`);
  if (s.lateDelivered > 0) {
    out.push(es
      ? `${s.lateDelivered} se entregaron en un día distinto al programado`
      : `${s.lateDelivered} delivered on a day other than the one scheduled`);
  }
  if (s.stillOut > 0) out.push(es ? `${s.stillOut} siguen en el camión` : `${s.stillOut} still on a truck`);
  if (s.overdueUnassigned > 0) {
    out.push(es
      ? `⚠ ${s.overdueUnassigned} pasadas de fecha y sin chofer`
      : `⚠ ${s.overdueUnassigned} past their date with no driver`);
  }
  if (s.perDriver.length) {
    out.push("");
    out.push(es ? "Por chofer:" : "By driver:");
    for (const d of s.perDriver) {
      out.push(`  ${d.driver}: ${d.delivered} ${es ? "entregas" : "deliveries"} · ${d.pallets} pallets`);
    }
  }
  if (s.attention.length) {
    out.push("");
    out.push(es ? "Requieren atención:" : "Needs attention:");
    for (const a of s.attention) out.push(`  ${a}`);
  }
  return out;
}
