// Dispatch helpers — driver assignment, capacity checks, window conflicts, route ordering and trip
// splitting. Ported from the deliveries app (ADR 0010). Framework-free (ADR 0006).
//
// Deliberately i18n-free: these return STRUCTURED warnings (a kind plus the numbers behind it), and
// the UI turns them into sentences. That is what lets the same logic serve the dispatch panel, the
// order form and any future surface without each one re-deriving the rule.

import { parseWindow } from "./delivery-scheduling";

export interface DispatchOrder {
  id?: string;
  order_no?: number | null;
  stage?: string | null;
  assigned_driver?: string | null;
  delivery_date?: string | null;
  delivery_windows?: string | null;
  est_pallets?: number | null;
  actual_pallets?: number | null;
  route_seq?: number | null;
  route_miles?: number | null;
  morning_priority?: boolean | null;
}

/** Stages where an order still occupies a driver's day. */
const ACTIVE = ["approved", "fulfilling", "ready", "picked_up"];

/** Least-loaded driver by count of active (not-yet-delivered) assignments. */
export function suggestDriver(driverNames: string[], deliveries: DispatchOrder[]): string | null {
  if (!driverNames.length) return null;
  const load = new Map<string, number>();
  for (const name of driverNames) load.set(name, 0);
  for (const d of deliveries) {
    if (d.assigned_driver && d.stage && ACTIVE.includes(d.stage) && load.has(d.assigned_driver)) {
      load.set(d.assigned_driver, load.get(d.assigned_driver)! + 1);
    }
  }
  return [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

/** Half-open overlap: touching edges do not conflict (one ends exactly as the next begins). */
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

export interface WindowCheck {
  id?: string;
  assigned_driver: string | null | undefined;
  delivery_date: string | null | undefined;
  delivery_windows: string | null | undefined;
}

/** Other active orders sharing this order's driver + date whose windows overlap it. */
export function windowConflicts(order: WindowCheck, deliveries: DispatchOrder[]): DispatchOrder[] {
  if (!order.assigned_driver || !order.delivery_date) return [];
  const mine = parseWindow(order.delivery_windows);
  if (!mine) return [];
  return deliveries.filter((d) => {
    if (d.id === order.id) return false;
    if (d.assigned_driver !== order.assigned_driver) return false;
    if (d.delivery_date !== order.delivery_date) return false;
    if (d.stage === "delivered" || d.stage === "canceled" || d.stage === "rejected") return false;
    const w = parseWindow(d.delivery_windows);
    return w ? overlaps(mine, w) : false;
  });
}

/** Pallets already committed to a driver on a date (active orders only). */
export function driverPalletsOn(
  driver: string | null | undefined,
  date: string | null | undefined,
  deliveries: DispatchOrder[],
  excludeId?: string
): number {
  if (!driver || !date) return 0;
  let total = 0;
  for (const d of deliveries) {
    if (d.id === excludeId) continue;
    if (d.assigned_driver !== driver) continue;
    if (d.delivery_date !== date) continue;
    if (d.stage === "delivered" || d.stage === "canceled" || d.stage === "rejected") continue;
    total += Number(d.actual_pallets ?? d.est_pallets ?? 0);
  }
  return total;
}

export interface AssignWarning {
  kind: "conflict" | "over_capacity";
  /** conflict: the other orders overlapping this one for the driver + date. */
  conflicts?: DispatchOrder[];
  /** over_capacity: pallets already booked, this order's pallets, and the cap. */
  used?: number;
  adding?: number;
  capacity?: number;
}

/** What would go wrong assigning `order` to `driver` — empty means clean. */
export function assignmentWarnings(
  order: DispatchOrder,
  driver: string,
  deliveries: DispatchOrder[],
  capacity: number | undefined
): AssignWarning[] {
  const out: AssignWarning[] = [];
  const conflicts = windowConflicts(
    {
      id: order.id,
      assigned_driver: driver,
      delivery_date: order.delivery_date,
      delivery_windows: order.delivery_windows,
    },
    deliveries
  );
  if (conflicts.length) out.push({ kind: "conflict", conflicts });
  if (capacity && capacity > 0) {
    const used = driverPalletsOn(driver, order.delivery_date, deliveries, order.id);
    const adding = Number(order.actual_pallets ?? order.est_pallets ?? 0);
    if (used + adding > capacity) out.push({ kind: "over_capacity", used, adding, capacity });
  }
  return out;
}

export interface DriverPick {
  driver: string;
  warnings: AssignWarning[];
  pallets: number;
}

/** Best driver for an order: fewest warnings, then the lightest current load. */
export function recommendDriver(
  order: DispatchOrder,
  driverNames: string[],
  deliveries: DispatchOrder[],
  capacityOf: (driver: string) => number | undefined
): DriverPick | null {
  if (!driverNames.length) return null;
  const scored: DriverPick[] = driverNames.map((driver) => ({
    driver,
    warnings: assignmentWarnings(order, driver, deliveries, capacityOf(driver)),
    pallets: driverPalletsOn(driver, order.delivery_date, deliveries, order.id),
  }));
  scored.sort((a, b) => a.warnings.length - b.warnings.length || a.pallets - b.pallets);
  return scored[0];
}

/**
 * Order a driver's stops for display.
 *
 * A dispatcher's optimized sequence (route_seq) wins when set — the whole point of optimizing is
 * that the result is followed. Anything not yet sequenced falls back to window start, then miles.
 * A reprogrammed order flagged for the morning jumps ahead of everything.
 */
export function routeOrder<T extends DispatchOrder>(deliveries: T[]): T[] {
  return [...deliveries].sort((a, b) => {
    if (!!a.morning_priority !== !!b.morning_priority) return a.morning_priority ? -1 : 1;
    if (a.route_seq != null && b.route_seq != null) return a.route_seq - b.route_seq;
    if (a.route_seq != null) return -1;
    if (b.route_seq != null) return 1;
    const wa = parseWindow(a.delivery_windows);
    const wb = parseWindow(b.delivery_windows);
    const sa = wa ? wa[0] : Number.MAX_SAFE_INTEGER;
    const sb = wb ? wb[0] : Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return (a.route_miles ?? Number.MAX_SAFE_INTEGER) - (b.route_miles ?? Number.MAX_SAFE_INTEGER);
  });
}

/**
 * Greedily bucket a driver's stops (in their given order) into capacity-respecting truckloads, so a
 * day too big for one trip becomes several round trips.
 *
 * A single stop over capacity on its own still gets its own bucket — splitting ONE order across two
 * truckloads is not something this does, because a partial load is an operational decision (which
 * pallets go first), not an arithmetic one.
 */
export function splitIntoTrips<T extends DispatchOrder>(stops: T[], capacity: number): T[][] {
  const trips: T[][] = [];
  let current: T[] = [];
  let load = 0;
  for (const d of stops) {
    const pallets = d.actual_pallets ?? d.est_pallets ?? 0;
    if (current.length && load + pallets > capacity) {
      trips.push(current);
      current = [];
      load = 0;
    }
    current.push(d);
    load += pallets;
  }
  if (current.length) trips.push(current);
  return trips;
}
