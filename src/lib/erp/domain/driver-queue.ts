// The driver's own queue: which orders a driver may see, and in what order.
// Ported from deliveries-app's /driver page (ADR 0010), which computed all of
// this inline in a client component. It is real access logic — "a driver sees
// only their own stops" is a visibility rule, not a display preference — so it
// lives here where it can be tested, and is applied on the server.

import { todayISO, shiftDateISO } from "./business-time";
import { routeOrder } from "./delivery-dispatch";

/**
 * How many days of already-past deliveries stay in the near-term queue.
 *
 * NOTE FOR ANYONE READING THE SOURCE APP: the comment there says "two days back
 * through tomorrow", but the constant is 1 — a dated order is kept when its date
 * is yesterday or later. The code is what shipped and what staff are used to, so
 * the behaviour is preserved and the comment corrected rather than the reverse.
 */
export const RETENTION_DAYS_BACK = 1;

export interface QueueOrder {
  order_no: number;
  stage: string;
  store?: string | null;
  invoice_num?: string | null;
  account?: string | null;
  delivery_date?: string | null;
  delivery_windows?: string | null;
  assigned_driver?: string | null;
  created_by?: string | null;
  address?: string | null;
}

export interface QueueViewer {
  id: string;
  full_name: string;
  role: string;
}

/** An undated order is still being scheduled, so it never ages out. */
export function withinRetention(
  d: { delivery_date?: string | null },
  today: string = todayISO(),
): boolean {
  if (!d.delivery_date) return true;
  return d.delivery_date.slice(0, 10) >= shiftDateISO(today, -RETENTION_DAYS_BACK);
}

export const DRIVER_TABS = [
  { key: "approved", label: "Pending Preparation", label_es: "Preparación Pendiente" },
  { key: "fulfilling", label: "Started", label_es: "Iniciado" },
  { key: "ready", label: "Staged", label_es: "Preparado" },
  { key: "picked_up", label: "Out for delivery", label_es: "En reparto" },
  { key: "delivered", label: "Delivered", label_es: "Entregadas" },
  { key: "all", label: "All", label_es: "Todas" },
] as const;

export type DriverTab = (typeof DRIVER_TABS)[number]["key"];

export interface QueueInput<T extends QueueOrder> {
  deliveries: T[];
  me: QueueViewer;
  /** An admin previewing the driver role sees every order, unscoped, to test with real data. */
  adminAllAccess?: boolean;
  storeFilter?: string;
  query?: string;
  today?: string;
}

/**
 * Everything this viewer may see, before the stage tab narrows it.
 *
 * Three rules, in the source's order — the order matters, because the invoice
 * search deliberately bypasses the date window and is the only way to reach
 * older history from this screen.
 */
export function scopedForDriver<T extends QueueOrder>(input: QueueInput<T>): T[] {
  const { deliveries, me, adminAllAccess = false, storeFilter = "", query = "" } = input;
  const today = input.today ?? todayISO();
  const needle = query.trim().toLowerCase();

  return deliveries.filter((d) => {
    // A driver sees only what is assigned to them, plus anything they logged
    // themselves. Office roles sharing this screen still see everything.
    if (!adminAllAccess && me.role === "driver" && d.assigned_driver !== me.full_name && d.created_by !== me.id) {
      return false;
    }
    // The store filter never hides a driver's own assignment — narrowing to a
    // store is for finding work, not for losing your own.
    if (storeFilter && d.store !== storeFilter && d.assigned_driver !== me.full_name) return false;
    if (needle) return (d.invoice_num || "").toLowerCase().includes(needle);
    if (!adminAllAccess && !withinRetention(d, today)) return false;
    return true;
  });
}

export function stageCounts(scoped: QueueOrder[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const d of scoped) c[d.stage] = (c[d.stage] ?? 0) + 1;
  return c;
}

/** The two active driving tabs are sequenced into a route; the rest are not. */
export function isRoutedTab(tab: DriverTab): boolean {
  return tab === "ready" || tab === "picked_up";
}

export function rowsForTab<T extends QueueOrder>(scoped: T[], tab: DriverTab): T[] {
  const list =
    tab === "all"
      ? [...scoped].sort((a, b) => b.order_no - a.order_no)
      : scoped.filter((d) => d.stage === tab);
  return isRoutedTab(tab) ? routeOrder(list as never) as unknown as T[] : list;
}
