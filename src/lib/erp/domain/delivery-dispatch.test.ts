import { describe, it, expect } from "vitest";
import {
  suggestDriver,
  windowConflicts,
  driverPalletsOn,
  assignmentWarnings,
  recommendDriver,
  routeOrder,
  splitIntoTrips,
  type DispatchOrder,
} from "./delivery-dispatch";

const D = "2026-08-25";
const fleet: DispatchOrder[] = [
  { id: "1", order_no: 1, assigned_driver: "Ana", stage: "ready", delivery_date: D, delivery_windows: "0830-1200", est_pallets: 4 },
  { id: "2", order_no: 2, assigned_driver: "Ana", stage: "approved", delivery_date: D, delivery_windows: "1300-1600", est_pallets: 3 },
  { id: "3", order_no: 3, assigned_driver: "Beto", stage: "picked_up", delivery_date: D, delivery_windows: "0900-1100", est_pallets: 6 },
  { id: "4", order_no: 4, assigned_driver: "Ana", stage: "delivered", delivery_date: D, delivery_windows: "0830-1200", est_pallets: 9 },
  { id: "5", order_no: 5, assigned_driver: "Ana", stage: "canceled", delivery_date: D, delivery_windows: "0830-1200", est_pallets: 9 },
  { id: "6", order_no: 6, assigned_driver: "Ana", stage: "ready", delivery_date: "2026-08-26", delivery_windows: "0830-1200", est_pallets: 5 },
  { id: "7", order_no: 7, assigned_driver: "Beto", stage: "ready", delivery_date: D, delivery_windows: "1400-1600", actual_pallets: 2, est_pallets: 8 },
];

describe("suggestDriver", () => {
  it("picks the driver with the fewest ACTIVE assignments", () => {
    // Caro has none; Ana and Beto both have active work.
    expect(suggestDriver(["Ana", "Beto", "Caro"], fleet)).toBe("Caro");
  });

  it("returns null when there are no drivers", () => {
    expect(suggestDriver([], fleet)).toBeNull();
  });

  it("returns the only driver even if loaded", () => {
    expect(suggestDriver(["Zed"], fleet)).toBe("Zed");
  });
});

describe("driverPalletsOn", () => {
  it("sums only active orders for that driver and date", () => {
    // Ana: 4 (ready) + 3 (approved) = 7. The delivered and canceled 9s are excluded, as is the
    // order on another date.
    expect(driverPalletsOn("Ana", D, fleet)).toBe(7);
  });

  it("prefers actual pallets over the estimate once known", () => {
    // Beto: 6 + actual 2 (not the est 8) = 8.
    expect(driverPalletsOn("Beto", D, fleet)).toBe(8);
  });

  it("can exclude the order being edited, so it does not count against itself", () => {
    expect(driverPalletsOn("Ana", D, fleet, "1")).toBe(3);
  });

  it("returns 0 for a missing driver or date rather than throwing", () => {
    expect(driverPalletsOn(null, D, fleet)).toBe(0);
    expect(driverPalletsOn("Ana", null, fleet)).toBe(0);
  });
});

describe("windowConflicts", () => {
  const check = (win: string | null, driver: string) =>
    windowConflicts({ id: "x", assigned_driver: driver, delivery_date: D, delivery_windows: win }, fleet).map(
      (d) => d.order_no
    );

  it("finds every overlapping order for that driver and date", () => {
    expect(check("1000-1400", "Ana")).toEqual([1, 2]);
  });

  it("does NOT flag windows that merely touch — one ends as the next begins", () => {
    // 1200-1300 sits exactly between Ana's 0830-1200 and 1300-1600. Half-open intervals, so this is
    // a legal back-to-back pair, not a conflict.
    expect(check("1200-1300", "Ana")).toEqual([]);
  });

  it("reports nothing for a driver with no orders that day", () => {
    expect(check("1000-1400", "Caro")).toEqual([]);
  });

  it("reports nothing when the order has no parseable window", () => {
    expect(check(null, "Ana")).toEqual([]);
  });
});

describe("assignmentWarnings", () => {
  const order: DispatchOrder = { id: "x", delivery_date: D, delivery_windows: "1000-1400", est_pallets: 4 };

  it("reports a conflict and over-capacity together with the numbers behind them", () => {
    const w = assignmentWarnings(order, "Ana", fleet, 5);
    expect(w.map((x) => x.kind)).toEqual(["conflict", "over_capacity"]);
    expect(w[1]).toMatchObject({ used: 7, adding: 4, capacity: 5 });
  });

  it("still reports over-capacity when the cap is exceeded only by this order", () => {
    expect(assignmentWarnings(order, "Ana", fleet, 10).map((x) => x.kind)).toContain("over_capacity");
  });

  it("skips the capacity check entirely when no cap is configured", () => {
    // 0 and undefined both mean "no cap", not "cap of zero" — otherwise every assignment would warn.
    expect(assignmentWarnings(order, "Ana", fleet, 0).map((x) => x.kind)).toEqual(["conflict"]);
    expect(assignmentWarnings(order, "Ana", fleet, undefined).map((x) => x.kind)).toEqual(["conflict"]);
  });
});

describe("recommendDriver", () => {
  const order: DispatchOrder = { id: "x", delivery_date: D, delivery_windows: "1000-1400", est_pallets: 2 };

  it("prefers the driver with no warnings", () => {
    const r = recommendDriver(order, ["Ana", "Beto", "Caro"], fleet, () => 10);
    expect(r).toMatchObject({ driver: "Caro", pallets: 0 });
    expect(r!.warnings).toEqual([]);
  });

  it("breaks a warning-count tie by the lighter load", () => {
    // Both Ana and Beto have 2 warnings at cap 5; Ana carries 7 pallets to Beto's 8.
    const r = recommendDriver(order, ["Ana", "Beto"], fleet, () => 5);
    expect(r).toMatchObject({ driver: "Ana", pallets: 7 });
  });

  it("returns null with no drivers to choose from", () => {
    expect(recommendDriver(order, [], fleet, () => 10)).toBeNull();
  });
});

describe("routeOrder", () => {
  const stops: DispatchOrder[] = [
    { id: "a", order_no: 10, route_seq: 3, delivery_windows: "0900-1000" },
    { id: "b", order_no: 11, route_seq: 1, delivery_windows: "1500-1600" },
    { id: "c", order_no: 12, delivery_windows: "0800-0900", route_miles: 5 },
    { id: "d", order_no: 13, delivery_windows: "0800-0900", route_miles: 2 },
    { id: "e", order_no: 14, morning_priority: true, delivery_windows: "1600-1700" },
    { id: "f", order_no: 15, delivery_windows: null },
  ];

  it("puts a morning-priority order first, ahead of even a sequenced one", () => {
    expect(routeOrder(stops)[0].order_no).toBe(14);
  });

  it("honours the dispatcher's optimized sequence before any guess", () => {
    // The point of optimizing is that the result is followed.
    expect(routeOrder(stops).map((s) => s.order_no)).toEqual([14, 11, 10, 13, 12, 15]);
  });

  it("falls back to window start, then miles, for unsequenced stops", () => {
    const r = routeOrder(stops).map((s) => s.order_no);
    expect(r.indexOf(13)).toBeLessThan(r.indexOf(12)); // same window, fewer miles first
  });

  it("sends stops with no window to the end", () => {
    expect(routeOrder(stops).at(-1)!.order_no).toBe(15);
  });

  it("does not mutate the input array", () => {
    const before = stops.map((s) => s.order_no);
    routeOrder(stops);
    expect(stops.map((s) => s.order_no)).toEqual(before);
  });
});

describe("splitIntoTrips", () => {
  const stops = (pallets: number[]): DispatchOrder[] =>
    pallets.map((p, i) => ({ id: `s${i}`, order_no: i, est_pallets: p }));

  it("packs stops into capacity-respecting truckloads", () => {
    expect(splitIntoTrips(stops([3, 4, 5, 2]), 10).map((t) => t.length)).toEqual([2, 2]);
  });

  it("starts a new trip as soon as the next stop would exceed capacity", () => {
    expect(splitIntoTrips(stops([3, 4, 5, 2]), 5).map((t) => t.length)).toEqual([1, 1, 1, 1]);
  });

  it("gives an oversize stop its own trip rather than splitting one order", () => {
    // Splitting a single order across two trucks is an operational decision (which pallets go
    // first), not an arithmetic one.
    const t = splitIntoTrips(stops([9, 1, 1]), 5);
    expect(t.map((x) => x.length)).toEqual([1, 2]);
  });

  it("keeps zero-pallet stops together instead of looping forever", () => {
    expect(splitIntoTrips(stops([0, 0, 0]), 5)).toHaveLength(1);
  });

  it("returns nothing for no stops", () => {
    expect(splitIntoTrips([], 5)).toEqual([]);
  });
});
