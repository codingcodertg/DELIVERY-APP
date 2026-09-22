import type { Delivery, DriverShift } from "@/lib/types";
import { palletsDeLaOrden } from "./pallets";

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

  const perDriver = new Map<string, { delivered: number; pallets: number }>();
  for (const d of deliveredToday) {
    const who = d.assigned_driver || "—";
    const cur = perDriver.get(who) ?? { delivered: 0, pallets: 0 };
    cur.delivered += 1;
    cur.pallets += pallets(d);
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
      .map(([driver, v]) => ({ driver, ...v }))
      .sort((a, b) => b.delivered - a.delivered || a.driver.localeCompare(b.driver)),
    // Named, not counted: "3 orders are stuck" sends someone hunting. Capped
    // because a report with forty order codes in it is a wall, not a summary.
    attention: [...missed, ...overdueUnassigned]
      .filter((d, i, arr) => arr.findIndex((x) => x.id === d.id) === i)
      .slice(0, 15)
      .map((d) => `#${label(d)}${d.account ? ` · ${d.account}` : ""}${d.assigned_driver ? ` · ${d.assigned_driver}` : ` · sin chofer`}`),
  };
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
