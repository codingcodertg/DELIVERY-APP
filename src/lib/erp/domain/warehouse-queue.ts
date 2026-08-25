// The warehouse queue: which orders are "at" a branch, and who is locked to one.
// Ported from deliveries-app's /warehouse page (ADR 0010), which computed it inline in a client
// component. Like the driver queue, this is visibility logic rather than presentation, so it lives
// here and runs on the server.

import { withinRetention } from "./driver-queue";
import type { QueueOrder } from "./driver-queue";

export interface WarehouseOrder extends QueueOrder {
  pickup_name?: string | null;
  pickup_address?: string | null;
}

export const WAREHOUSE_TABS = [
  { key: "approved", label: "Approved (new)", label_es: "Aprobado (nuevo)" },
  { key: "fulfilling", label: "Preparing", label_es: "Preparando" },
  { key: "ready", label: "Ready", label_es: "Listo" },
  { key: "picked_up", label: "Out for delivery", label_es: "En reparto" },
  { key: "delivered", label: "Delivered", label_es: "Entregado" },
  { key: "all", label: "All", label_es: "Todas" },
] as const;

export type WarehouseTab = (typeof WAREHOUSE_TABS)[number]["key"];

/** Stages that still represent work in the building or on the road. */
export const ACTIVE_LOAD_STAGES = ["approved", "fulfilling", "ready", "picked_up"];

/**
 * Which store a warehouse worker is actually looking at.
 *
 * A real warehouse worker is pinned to their own branch. An ADMIN previewing the warehouse role is
 * NOT pinned — they get the picker, so they can check each store's queue against real data.
 */
export function effectiveStore(opts: {
  role: string;
  realRole?: string;
  ownStore?: string | null;
  picked?: string;
}): { store: string; locked: boolean; unassigned: boolean } {
  const locked = opts.role === "warehouse" && opts.realRole !== "admin";
  if (!locked) return { store: opts.picked ?? "", locked: false, unassigned: false };
  const own = (opts.ownStore ?? "").trim();
  // No branch on the profile means we cannot narrow at all. The source app shows everything and
  // says so, rather than showing an empty queue somebody would read as "no work today".
  return { store: own, locked: true, unassigned: own === "" };
}

/**
 * Is this order "at" the given store?
 *
 * Three ways, and the last two are the point: an order SOLD from another branch but physically
 * picked up here is this warehouse's work. Match by pickup name, or by the pickup address matching
 * the branch's own address.
 */
export function atStore(
  d: WarehouseOrder,
  store: string,
  storeAddress = ""
): boolean {
  if (!store) return true;
  if (d.store === store) return true;
  if ((d.pickup_name || "").trim() === store) return true;
  const addr = storeAddress.trim();
  if (addr && (d.pickup_address || "").trim() === addr) return true;
  return false;
}

export interface WarehouseInput<T extends WarehouseOrder> {
  deliveries: T[];
  store: string;
  storeAddress?: string;
  /** An admin previewing the role bypasses the recent-work window and sees all history. */
  adminAllAccess?: boolean;
  query?: string;
  today?: string;
}

export function scopedForWarehouse<T extends WarehouseOrder>(input: WarehouseInput<T>): T[] {
  const { deliveries, store, storeAddress = "", adminAllAccess = false, query = "" } = input;
  const needle = query.trim().toLowerCase();
  return deliveries.filter((d) => {
    if (store && !atStore(d, store, storeAddress)) return false;
    // Invoice search deliberately runs BEFORE the date window — it is the one way to reach older
    // history from this screen, so it has to survive the filter below.
    if (needle) return (d.invoice_num || "").toLowerCase().includes(needle);
    if (!adminAllAccess && !withinRetention(d, input.today)) return false;
    return true;
  });
}

export function warehouseRows<T extends WarehouseOrder>(scoped: T[], tab: WarehouseTab): T[] {
  // Unlike the driver queue, nothing here is route-sequenced: the warehouse works a pile, not a
  // route, and newest-first is what the source shows.
  if (tab === "all") return [...scoped].sort((a, b) => b.order_no - a.order_no);
  return scoped.filter((d) => d.stage === tab);
}

/** The orders that belong on a given day's load sheets for this store. */
export function loadSheetOrders<T extends WarehouseOrder>(
  deliveries: T[],
  dateISO: string,
  store: string,
  storeAddress = ""
): T[] {
  return deliveries.filter(
    (d) =>
      d.delivery_date === dateISO &&
      ACTIVE_LOAD_STAGES.includes(d.stage) &&
      (!store || atStore(d, store, storeAddress))
  );
}

// --- Load sheets ------------------------------------------------------------

export interface LoadSheetOrder extends WarehouseOrder {
  route_seq?: number | null;
  est_pallets?: number | null;
  actual_pallets?: number | null;
  delivery_name?: string | null;
  delivery_notes?: string | null;
  delivery_address?: string | null;
  po2?: string | null;
  so_num?: string | null;
  estimate_num?: string | null;
}

export interface LoadSheetGroup<T> {
  driver: string;
  /** True for the catch-all page of stops nobody is driving yet. */
  unassigned: boolean;
  stops: T[];
  pallets: number;
}

/** Start of the delivery window in minutes, or 9999 when it cannot be read. */
export function windowStartMinutes(windows: string | null | undefined): number {
  const m = String(windows ?? "").match(/(\d{2})(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 9999;
}

/**
 * One page per driver: their stops for the day, in the order they should be loaded.
 *
 * DELIBERATE DIVERGENCE FROM THE SOURCE, and a small one. The source groups unassigned stops under
 * a " " sentinel with the comment "sentinel sorts unassigned last". It does not — a space sorts
 * BEFORE every name, so the page for stops nobody is driving printed on top of the stack. Whoever
 * hands the sheets out gets a page that goes to no one first. The comment is the stated intent and
 * the behaviour was a one-character slip, so the intent is what is implemented here; print order
 * carries no data risk either way.
 */
export function loadSheetGroups<T extends LoadSheetOrder>(orders: T[]): LoadSheetGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const o of orders) {
    const key = (o.assigned_driver || "").trim();
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  }

  const keys = [...groups.keys()].sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const stops = [...groups.get(key)!].sort((a, b) => {
      // Route sequence when logistics has planned one; otherwise earliest window first.
      const ra = a.route_seq ?? 1e9;
      const rb = b.route_seq ?? 1e9;
      return ra !== rb ? ra - rb : windowStartMinutes(a.delivery_windows) - windowStartMinutes(b.delivery_windows);
    });
    return {
      driver: key === "" ? "Unassigned" : key,
      unassigned: key === "",
      stops,
      pallets: stops.reduce((s, o) => s + Number(o.actual_pallets ?? o.est_pallets ?? 0), 0),
    };
  });
}

/** The reference the load sheet prints for a stop, in the source's fallback order. */
export function stopRef(o: LoadSheetOrder): string {
  return o.invoice_num || o.po2 || o.so_num || o.estimate_num || "—";
}
