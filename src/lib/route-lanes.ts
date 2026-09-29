import type { Delivery } from "@/lib/types";

// ============================================================
// D-NEXT: there are no truckloads any more — a driver's day is ONE list of stops
// (lib/lista-unica). The load helpers that lived here (loadNoOf, groupIntoLoads,
// hasManualLoads, nextLoadFor) were removed with the trips; load_no is no longer
// written (targetPatch leaves it null).
//
// Route "lanes" — the pure logic behind the Routes Manager's multi-load and
// merge features. A lane is one truckload of a driver's day (or a route
// bucket). Its KEY groups the orders: the plain driver name for load 1
// (unchanged), or "Driver#L2" for the 2nd load, etc. Kept here (framework-free)
// so it's unit-testable without the page. See app/(app)/routes/page.tsx.
// ============================================================

export const LANE_SEP = "#L";

/** Strip a lane key back to the driver name ("José#L2" → "José"). */
export function driverOf(key: string): string {
  const i = key.lastIndexOf(LANE_SEP);
  return i >= 0 && /^\d+$/.test(key.slice(i + LANE_SEP.length)) ? key.slice(0, i) : key;
}

/** Build a lane key from a driver + load number (load 1 = the bare name). */
export function laneKeyFor(driver: string, load: number): string {
  return load > 1 ? `${driver}${LANE_SEP}${load}` : driver;
}

/** The load number encoded in a lane key (1 when there's none). */
export function loadFromKey(key: string): number {
  const i = key.lastIndexOf(LANE_SEP);
  const n = i >= 0 ? parseInt(key.slice(i + LANE_SEP.length), 10) : NaN;
  return Number.isFinite(n) ? n : 1;
}

type OrderLite = Pick<Delivery, "assigned_driver" | "load_no">;

/** Which lane an order belongs to — one lane per driver / temp driver. The load
 * number is NOT part of the key: a driver is a single route CARD, and loads are
 * truckload sections inside it (see groupIntoLoads). The `isBucket` arg is
 * accepted for signature stability but no longer needed. */
export function orderLaneKey(d: OrderLite, _isBucket?: (name: string) => boolean): string | null {
  return d.assigned_driver || null;
}

export interface LaneTarget { isBucket: boolean; driver: string; load: number; }

/** The order patch that puts a delivery onto a target lane (resets sequence). Since D-NEXT there are no trips: the
 * load is always cleared, whatever `target.load` says. */
export function targetPatch(target: LaneTarget): Partial<Delivery> {
  return { assigned_driver: target.driver, load_no: null, route_seq: null };
}

export interface LaneLite { key: string; isBucket: boolean; driver: string; load: number; }
export interface MergePlan { targetKey: string; patch: Partial<Delivery>; moveIds: string[]; removeBuckets: string[]; }

/** Plan a merge of the checked lanes into ONE route: the first checked lane (in
 * the given display order) is the target; every other checked lane's orders
 * move onto it, and emptied buckets are retired. Pure — the page applies it. */
export function planMerge(
  lanes: LaneLite[],
  selectedKeys: Set<string>,
  ordersByLane: Map<string, { id: string }[]>,
): MergePlan | null {
  const keys = lanes.filter((l) => selectedKeys.has(l.key)).map((l) => l.key);
  if (keys.length < 2) return null;
  const targetKey = keys[0];
  const target = lanes.find((l) => l.key === targetKey);
  if (!target) return null;
  const patch = targetPatch(target);
  const moveIds: string[] = [];
  const removeBuckets: string[] = [];
  for (const src of keys.slice(1)) {
    for (const d of ordersByLane.get(src) ?? []) moveIds.push(d.id);
    const lane = lanes.find((l) => l.key === src);
    if (lane?.isBucket) removeBuckets.push(src);
  }
  return { targetKey, patch, moveIds, removeBuckets };
}

/** Group orders by their lane key (mirrors the page's byDriver map). */
export function groupByLane(orders: Delivery[], isBucket: (name: string) => boolean): Map<string, Delivery[]> {
  const map = new Map<string, Delivery[]>();
  for (const d of orders) {
    const key = orderLaneKey(d, isBucket);
    if (!key) continue;
    (map.get(key) ?? map.set(key, []).get(key)!).push(d);
  }
  return map;
}
