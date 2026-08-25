// Route "lanes" — the logic behind multi-load routes and lane merging. Ported from the deliveries app
// (ADR 0010). Framework-free (ADR 0006) so it is testable without the page that drives it.
//
// A lane is one driver's route card. Loads are truckload sections INSIDE that card, not separate
// lanes — which is why the load number is deliberately not part of the lane key. The key encoding
// ("José#L2") is still parsed because older data and links carry it.

export const LANE_SEP = "#L";

export interface LaneOrder {
  id?: string;
  assigned_driver?: string | null;
  load_no?: number | null;
  route_seq?: number | null;
}

/** Strip a lane key back to the driver name ("José#L2" → "José"). */
export function driverOf(key: string): string {
  const i = key.lastIndexOf(LANE_SEP);
  return i >= 0 && /^\d+$/.test(key.slice(i + LANE_SEP.length)) ? key.slice(0, i) : key;
}

/** Build a lane key from a driver + load number (load 1 = the bare name). */
export function laneKeyFor(driver: string, load: number): string {
  return load > 1 ? `${driver}${LANE_SEP}${load}` : driver;
}

/** The load number encoded in a lane key (1 when there is none). */
export function loadFromKey(key: string): number {
  const i = key.lastIndexOf(LANE_SEP);
  const n = i >= 0 ? parseInt(key.slice(i + LANE_SEP.length), 10) : NaN;
  return Number.isFinite(n) ? n : 1;
}

/** An order's effective load number (null or 1 → 1). */
export function loadNoOf(d: { load_no?: number | null }): number {
  return d.load_no && d.load_no > 1 ? d.load_no : 1;
}

/**
 * Which lane an order belongs to — one lane per driver.
 *
 * The load number is NOT part of the key: a driver is a single route card, and loads are sections
 * inside it. `_isBucket` is accepted for signature stability with the source and is unused.
 */
export function orderLaneKey(d: LaneOrder, _isBucket?: (name: string) => boolean): string | null {
  return d.assigned_driver || null;
}

/**
 * Split a lane's stops into truckloads by load number — each distinct load is one truckload, in
 * ascending order. Used when the dispatcher has assigned loads by hand; otherwise the route splits
 * by truck capacity instead.
 */
export function groupIntoLoads<T extends { load_no?: number | null }>(stops: T[]): T[][] {
  const byLoad = new Map<number, T[]>();
  for (const d of stops) {
    const L = d.load_no && d.load_no > 1 ? d.load_no : 1;
    const bucket = byLoad.get(L) ?? (byLoad.set(L, []), byLoad.get(L)!);
    bucket.push(d);
  }
  return [...byLoad.keys()].sort((a, b) => a - b).map((L) => byLoad.get(L)!);
}

/** True when a lane's stops carry manual load assignments (any load ≥ 2). */
export function hasManualLoads(stops: { load_no?: number | null }[]): boolean {
  return stops.some((d) => (d.load_no ?? 1) > 1);
}

/** Next free load number for a driver: 1 if they have no work yet, else one past their highest. */
export function nextLoadFor(orders: LaneOrder[], driver: string): number {
  let max = 0;
  for (const d of orders) if (d.assigned_driver === driver) max = Math.max(max, loadNoOf(d));
  return max === 0 ? 1 : max + 1;
}

export interface LaneTarget {
  isBucket: boolean;
  driver: string;
  load: number;
}

/**
 * The patch that puts an order onto a target lane.
 *
 * route_seq is always cleared: a stop moved to another truck has no meaningful position in the old
 * truck's optimized sequence, and leaving the number behind would place it wrongly on the new one.
 */
export function targetPatch(target: LaneTarget): LaneOrder {
  return target.isBucket
    ? { assigned_driver: target.driver, load_no: null, route_seq: null }
    : { assigned_driver: target.driver, load_no: target.load > 1 ? target.load : null, route_seq: null };
}

export interface LaneLite {
  key: string;
  isBucket: boolean;
  driver: string;
  load: number;
}

export interface MergePlan {
  targetKey: string;
  patch: LaneOrder;
  moveIds: string[];
  removeBuckets: string[];
}

/**
 * Plan a merge of the checked lanes into ONE route.
 *
 * The FIRST checked lane in display order is the target — not the largest or the closest — so the
 * dispatcher can predict the outcome from what they see. Every other checked lane's orders move onto
 * it and emptied buckets are retired. Pure: the caller applies the plan.
 */
export function planMerge(
  lanes: LaneLite[],
  selectedKeys: Set<string>,
  ordersByLane: Map<string, { id: string }[]>
): MergePlan | null {
  const keys = lanes.filter((l) => selectedKeys.has(l.key)).map((l) => l.key);
  if (keys.length < 2) return null; // nothing to merge into anything
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

/** Group orders by their lane key. Orders with no driver are omitted — they are not on any route. */
export function groupByLane<T extends LaneOrder>(
  orders: T[],
  isBucket: (name: string) => boolean
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const d of orders) {
    const key = orderLaneKey(d, isBucket);
    if (!key) continue;
    const bucket = map.get(key) ?? (map.set(key, []), map.get(key)!);
    bucket.push(d);
  }
  return map;
}
