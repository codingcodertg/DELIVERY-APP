// Orders grouped by the customer they belong to. Ported from deliveries-app (ADR 0010).
//
// A read-only view over orders somebody can already see, so it adds no access of its own: whatever
// RLS and the module gate already allow through is what gets grouped here.

import { isOverdue } from "./business-time";

/** Stages where nothing further is expected to happen. */
export const CLOSED_STAGES = ["delivered", "canceled", "rejected"];

export interface AccountOrder {
  id: string;
  account?: string | null;
  stage?: string | null;
  delivery_date?: string | null;
  est_pallets?: number | null;
  actual_pallets?: number | null;
  delivery_fee?: number | null;
}

export interface AccountRow {
  name: string;
  orders: AccountOrder[];
  total: number;
  /** Still expected to move: not delivered, cancelled or rejected. */
  active: number;
  delivered: number;
  overdue: number;
  pallets: number;
  fees: number;
  /** Most recent delivery date, which is what "when did we last serve them" means. */
  lastDate: string | null;
}

/**
 * Group orders by account.
 *
 * Names are grouped case-insensitively but DISPLAYED as first seen. "Tile Depot" and "tile depot"
 * are one customer who has been typed two ways, and splitting them into two rows would understate
 * both — but silently lowercasing the name on screen would look like a bug of its own.
 */
export function accountRows<T extends AccountOrder>(
  orders: T[],
  now: Date = new Date()
): AccountRow[] {
  const by = new Map<string, AccountRow>();

  for (const o of orders) {
    const raw = (o.account ?? "").trim();
    // Orders with no account are grouped under one heading rather than dropped. They are usually a
    // data-entry gap worth seeing, not noise worth hiding.
    const display = raw || "(no account)";
    const key = display.toLowerCase();

    let row = by.get(key);
    if (!row) {
      row = {
        name: display,
        orders: [],
        total: 0,
        active: 0,
        delivered: 0,
        overdue: 0,
        pallets: 0,
        fees: 0,
        lastDate: null,
      };
      by.set(key, row);
    }

    row.orders.push(o);
    row.total++;
    const stage = o.stage ?? "";
    if (stage === "delivered") row.delivered++;
    if (!CLOSED_STAGES.includes(stage)) row.active++;
    if (isOverdue(o, now)) row.overdue++;
    row.pallets += Number(o.actual_pallets ?? o.est_pallets ?? 0) || 0;
    row.fees += Number(o.delivery_fee ?? 0) || 0;

    const d = o.delivery_date ?? null;
    if (d && (!row.lastDate || d > row.lastDate)) row.lastDate = d;
  }

  // Busiest first, then alphabetically so the tail is browsable rather than arbitrary.
  return [...by.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** Case- and space-insensitive name search, matching how people actually type a customer. */
export function filterAccounts(rows: AccountRow[], query: string): AccountRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q));
}
