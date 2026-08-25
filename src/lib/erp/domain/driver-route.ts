import { routeOrder, splitIntoTrips, type DispatchOrder } from "./delivery-dispatch";
import { groupIntoLoads, hasManualLoads } from "./route-lanes";
import { isOverdue, todayISO } from "./business-time";

/**
 * "My route" — the driver's read-only copy of what logistics planned.
 *
 * Deliberately not the dispatcher's screen with the controls removed. A dispatcher is arranging a
 * fleet at a desk; a driver is in a cab with one question at a time. So the useful outputs here are
 * the next stop and the day's sequence — never a reordering, which stays logistics' job.
 */

export const DEFAULT_CAPACITY = 12;

export type RouteStop = DispatchOrder & { id: string; load_no?: number | null };

/**
 * Today's work for one driver.
 *
 * Includes anything overdue that never went out: a slipped stop is still theirs to finish, and a
 * route that silently drops it is how a stop gets forgotten for a second day.
 */
export function todaysStops<T extends RouteStop>(
  deliveries: T[],
  driverName: string,
  now: Date = new Date()
): T[] {
  if (!driverName) return [];
  const today = todayISO(now);

  const mine = deliveries.filter((d) => {
    if (d.assigned_driver !== driverName) return false;
    if (d.stage === "canceled" || d.stage === "rejected") return false;
    return d.delivery_date === today || isOverdue(d, now);
  });

  return routeOrder(mine);
}

/**
 * The same truckload grouping the dispatcher sees, so the driver's "Trip 2" is the dispatcher's
 * "Trip 2": explicit load numbers when somebody set them, otherwise split by what the truck holds.
 */
export function tripsFor<T extends RouteStop>(stops: T[], capacity: number): T[][] {
  return hasManualLoads(stops) ? groupIntoLoads(stops) : splitIntoTrips(stops, capacity);
}

/** The one stop that matters right now: first in sequence still to finish. */
export function nextStop<T extends RouteStop>(stops: T[]): T | null {
  return stops.find((d) => d.stage !== "delivered") ?? null;
}

/** This driver's truck capacity, falling back to the company default and then to a sane constant. */
export function capacityFor(
  driverName: string,
  perDriver: Record<string, number> | null | undefined,
  companyDefault: number | null | undefined
): number {
  return perDriver?.[driverName] ?? companyDefault ?? DEFAULT_CAPACITY;
}
