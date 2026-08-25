// What one truckload actually costs the day. Ported from the deliveries app (ADR 0010).
// Framework-free (ADR 0006), and already dependency-free in the source.
//
// What one truckload actually costs the day.
//
// Wheel time alone understates it badly: a load of six stops spends over an
// hour standing still while it's unloaded, and that time is already programmed
// per order as `delivery_duration`. A route judged on driving time only looks
// like it fits an 8-hour shift when it doesn't.
// ============================================================

/** Minutes budgeted to unload one order. */
export const DEFAULT_SERVICE_MIN = 15;

/** Minutes to reload at the pickup between truckloads. */
export const RELOAD_MIN = 20;

/**
 * The unload time programmed on an order.
 *
 * `delivery_duration` is free text the office types ("30", "30 min", "1 hr"),
 * so the leading number is what counts. Anything unreadable falls back to the
 * default rather than silently costing zero — a stop is never instant.
 */
export function serviceMin(duration: string | null | undefined): number {
  const m = String(duration ?? "").match(/\d+/);
  if (!m) return DEFAULT_SERVICE_MIN;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SERVICE_MIN;
}

export interface TripTiming {
  /** Time behind the wheel, pickup out and back. */
  driveMin: number;
  /** Time parked, unloading — the sum of this load's stop durations. */
  serviceMin: number;
  /** driveMin + serviceMin: how long the truck is busy on this load. */
  totalMin: number;
}

/** Roll a truckload's drive time and its stops' unload times into one figure. */
export function tripTiming(driveMin: number, durations: (string | null | undefined)[]): TripTiming {
  const service = durations.reduce((n, d) => n + serviceMin(d), 0);
  return { driveMin, serviceMin: service, totalMin: driveMin + service };
}

/**
 * The driver's whole day: every truckload, plus a reload at the pickup between
 * consecutive loads.
 *
 * The reload after the LAST load isn't counted — the truck is done, not being
 * turned around for another run.
 */
export function dayMinutes(trips: TripTiming[], reloadMin = RELOAD_MIN): number {
  const busy = trips.reduce((n, t) => n + t.totalMin, 0);
  return busy + Math.max(0, trips.length - 1) * reloadMin;
}
