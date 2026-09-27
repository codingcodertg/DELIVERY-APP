import type { Delivery, Stage } from "@/lib/types";
import { aLaDecima, palletsDeLaOrden } from "./pallets";

// ============================================================
// Dispatch helpers: driver auto-assignment (#6), delivery-window conflict
// detection (#5), and simple route ordering (#2). Pure functions, shared by
// the order modal and the driver page, mode-agnostic.
// ============================================================

const ACTIVE: Stage[] = ["approved", "fulfilling", "ready", "picked_up"];

/** Least-loaded driver by count of active (not-yet-delivered) assignments. */
export function suggestDriver(driverNames: string[], deliveries: Delivery[]): string | null {
  if (!driverNames.length) return null;
  const load = new Map<string, number>();
  for (const name of driverNames) load.set(name, 0);
  for (const d of deliveries) {
    if (d.assigned_driver && ACTIVE.includes(d.stage) && load.has(d.assigned_driver)) {
      load.set(d.assigned_driver, load.get(d.assigned_driver)! + 1);
    }
  }
  return [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

/** Parse a "HHMM-HHMM" window into [startMin, endMin], or null if unparseable. */
export function parseWindow(win: string | null | undefined): [number, number] | null {
  if (!win) return null;
  const m = win.match(/(\d{3,4})\s*[-–]\s*(\d{3,4})/);
  if (!m) return null;
  const toMin = (s: string) => {
    const p = s.padStart(4, "0");
    return parseInt(p.slice(0, 2), 10) * 60 + parseInt(p.slice(2), 10);
  };
  const a = toMin(m[1]), b = toMin(m[2]);
  return a <= b ? [a, b] : [b, a];
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

interface WindowCheck {
  id?: string;
  assigned_driver: string | null | undefined;
  delivery_date: string | null | undefined;
  delivery_windows: string | null | undefined;
}

/** Other active orders that share this order's driver + date and overlap its window. */
export function windowConflicts(order: WindowCheck, deliveries: Delivery[]): Delivery[] {
  if (!order.assigned_driver || !order.delivery_date) return [];
  const mine = parseWindow(order.delivery_windows);
  if (!mine) return [];
  return deliveries.filter((d) => {
    if (d.id === order.id) return false;
    if (d.assigned_driver !== order.assigned_driver) return false;
    if (d.delivery_date !== order.delivery_date) return false;
    if (d.stage === "delivered" || d.stage === "canceled") return false;
    const w = parseWindow(d.delivery_windows);
    return w ? overlaps(mine, w) : false;
  });
}

// ---- Smart driver assignment (Epic B) -------------------------------------
// Structured warnings + a capacity/conflict-aware recommendation, shared by the
// Map dispatch panel and (later) the order form. The lib stays i18n-free — the
// UI formats these into sentences.

/** Pallets already committed to a driver on a given date (active orders only). */
export function driverPalletsOn(
  driver: string | null | undefined,
  date: string | null | undefined,
  deliveries: Delivery[],
  excludeId?: string,
): number {
  if (!driver || !date) return 0;
  let total = 0;
  for (const d of deliveries) {
    if (d.id === excludeId) continue;
    if (d.assigned_driver !== driver) continue;
    if (d.delivery_date !== date) continue;
    if (d.stage === "delivered" || d.stage === "canceled" || d.stage === "rejected") continue;
    total += palletsDeLaOrden(d);
  }
  // A la décima (D-362): esta suma es la que pinta «4.43/12» en la lista de choferes.
  return aLaDecima(total);
}

export interface AssignWarning {
  kind: "conflict" | "over_capacity";
  /** conflict: the other orders that overlap this one for the driver + date. */
  conflicts?: Delivery[];
  /** over_capacity: pallets already booked, this order's pallets, and the cap. */
  used?: number;
  adding?: number;
  capacity?: number;
}

/** What would go wrong assigning `order` to `driver` — empty means clean. */
export function assignmentWarnings(
  order: Pick<Delivery, "id" | "delivery_date" | "delivery_windows" | "actual_pallets" | "est_pallets">,
  driver: string,
  deliveries: Delivery[],
  capacity: number | undefined,
): AssignWarning[] {
  const out: AssignWarning[] = [];
  const conflicts = windowConflicts(
    { id: order.id, assigned_driver: driver, delivery_date: order.delivery_date, delivery_windows: order.delivery_windows },
    deliveries,
  );
  if (conflicts.length) out.push({ kind: "conflict", conflicts });
  if (capacity && capacity > 0) {
    const used = driverPalletsOn(driver, order.delivery_date, deliveries, order.id);
    const adding = palletsDeLaOrden(order);
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
  order: Delivery,
  driverNames: string[],
  deliveries: Delivery[],
  capacityOf: (driver: string) => number | undefined,
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

// ---- Auto-assign (Epic A) — quitado en D-419 -------------------------------------------------------
// Aquí vivía `autoAssign`: un reparto voraz en línea recta que trataba cualquier solape de ventanas como choque (con el
// 77 % de las órdenes en 08:30–17:30, un clic colocaba una orden por chofer), empezaba a cada chofer en 0 pallets aunque
// ya llevara carga, y no miraba base, turno ni si el chofer rutea. «✨ Auto-asignar» (Gestor y mapa) reparte ahora con el
// motor de «Planificar el día»: `lib/route-plan/reparto.ts`.

/** Driver full-names that are unavailable on a given date, from availability
 * rows (vacation/sick/maintenance). `nameById` maps a driver's user id to their
 * full name (which is how assignments reference drivers). */
export function unavailableDriverNames(
  availability: { driver_id: string; start_date: string; end_date: string }[],
  nameById: Map<string, string>,
  dateISO: string,
): Set<string> {
  const out = new Set<string>();
  for (const a of availability) {
    if (a.start_date <= dateISO && dateISO <= a.end_date) {
      const name = nameById.get(a.driver_id);
      if (name) out.add(name);
    }
  }
  return out;
}

/** Order a driver's stops for display. A Logistics Manager's optimized
 * sequence (route_seq) wins when set; anything not yet sequenced falls back
 * to delivery window start (then miles) — a simple, dependency-free guess. */
export function routeOrder(deliveries: Delivery[]): Delivery[] {
  return [...deliveries].sort((a, b) => {
    // A reprogrammed order flagged for the morning goes out first.
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

/** Greedily bucket a driver's stops (in their given order) into
 * capacity-respecting truckloads — each bucket's pallets never exceed
 * capacity, so a load that's too big for one trip becomes several round
 * trips instead. A single stop over capacity on its own still gets its own
 * bucket; splitting one order across two truckloads isn't something this
 * does. Used by the Routes tool's multi-trip planner. */
export function splitIntoTrips(stops: Delivery[], capacity: number): Delivery[][] {
  const trips: Delivery[][] = [];
  let current: Delivery[] = [];
  let load = 0;
  for (const d of stops) {
    const pallets = palletsDeLaOrden(d);
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
