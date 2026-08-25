import { orderOwner } from "./delivery-analytics";
import { isOverdue, todayISO, shiftDateISO } from "./business-time";

/**
 * "Summary" — the one screen every role gets, reporting on one person's own work.
 *
 * The interesting part is that "your work" means three different things depending on who is asking,
 * and getting that wrong shows somebody else's orders as their own. Hence a tested module rather
 * than a filter inlined in the page.
 */

export interface SummaryOrder {
  id: string;
  order_no: number | null;
  order_code: string | null;
  stage: string;
  delivery_date: string | null;
  delivery_fee: number | null;
  created_by: string | null;
  assigned_sales_rep: string | null;
  assigned_driver: string | null;
}

export interface SummarySubject {
  id: string;
  full_name: string | null;
  role: string | null;
}

/** Stages that are finished one way or another, so they are not "in progress". */
const CLOSED = new Set(["delivered", "canceled", "rejected"]);

/**
 * The orders that count as this person's work.
 *
 * - A **driver** sees what is assigned to them, narrowed to yesterday and today — what is on the
 *   truck now, not a career history. Orders they logged themselves count too.
 * - A **sales rep** sees what they own, which is not the same as what they typed: an order an
 *   office user created on their behalf is theirs (`orderOwner` resolves that).
 * - **Everybody else** sees what they personally logged.
 */
export function mineFor(
  deliveries: SummaryOrder[],
  subject: SummarySubject | null,
  now: Date = new Date()
): SummaryOrder[] {
  if (!subject) return [];

  if (subject.role === "driver") {
    const today = todayISO(now);
    const days = new Set([today, shiftDateISO(today, -1)]);
    return deliveries.filter(
      (d) =>
        (d.assigned_driver === subject.full_name || d.created_by === subject.id) &&
        d.delivery_date != null &&
        days.has(d.delivery_date)
    );
  }

  if (subject.role === "sales") {
    return deliveries.filter((d) => orderOwner(d) === subject.id);
  }

  return deliveries.filter((d) => d.created_by === subject.id);
}

export interface SummaryStats {
  total: number;
  active: number;
  delivered: number;
  overdue: number;
  /** Delivery fees, excluding cancelled orders — a cancelled run was never charged. */
  fees: number;
}

export function summaryStats(rows: SummaryOrder[], now: Date = new Date()): SummaryStats {
  const fees = rows
    .filter((d) => d.stage !== "canceled")
    .reduce((sum, d) => sum + (d.delivery_fee ?? 0), 0);

  return {
    total: rows.length,
    active: rows.filter((d) => !CLOSED.has(d.stage)).length,
    delivered: rows.filter((d) => d.stage === "delivered").length,
    overdue: rows.filter((d) => isOverdue(d, now)).length,
    // Rounded at the edge, not per row, so the total matches what the fees actually add up to.
    fees: Math.round(fees * 100) / 100,
  };
}

/** The most recent orders, newest first. */
export function recentOrders(rows: SummaryOrder[], limit = 8): SummaryOrder[] {
  return [...rows].sort((a, b) => (b.order_no ?? 0) - (a.order_no ?? 0)).slice(0, limit);
}
