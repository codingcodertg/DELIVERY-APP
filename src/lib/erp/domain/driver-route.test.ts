import { describe, it, expect } from "vitest";
import { todaysStops, tripsFor, nextStop, capacityFor, type RouteStop } from "./driver-route";

// Pinned: "today" and "overdue" are business-time notions, and a live clock makes these pass or
// fail by the hour the suite runs.
const NOW = new Date("2026-08-20T15:00:00Z"); // 2026-08-20 in America/Chicago
const TODAY = "2026-08-20";

const s = (over: Partial<RouteStop> & { id: string }): RouteStop => ({
  stage: "ready",
  assigned_driver: "Nick Huerta",
  delivery_date: TODAY,
  ...over,
});

describe("todaysStops", () => {
  it("keeps only this driver's stops", () => {
    const rows = todaysStops([s({ id: "mine" }), s({ id: "theirs", assigned_driver: "Ana" })], "Nick Huerta", NOW);
    expect(rows.map((r) => r.id)).toEqual(["mine"]);
  });

  it("carries an overdue stop forward — a slipped stop is still theirs to finish", () => {
    const rows = todaysStops([s({ id: "slipped", delivery_date: "2026-08-18" })], "Nick Huerta", NOW);
    expect(rows.map((r) => r.id)).toEqual(["slipped"]);
  });

  it("leaves out a future stop", () => {
    const rows = todaysStops([s({ id: "tomorrow", delivery_date: "2026-08-21" })], "Nick Huerta", NOW);
    expect(rows).toEqual([]);
  });

  it("leaves out cancelled and rejected work", () => {
    const rows = todaysStops(
      [s({ id: "a", stage: "canceled" }), s({ id: "b", stage: "rejected" }), s({ id: "c" })],
      "Nick Huerta",
      NOW
    );
    expect(rows.map((r) => r.id)).toEqual(["c"]);
  });

  it("does not carry forward an overdue stop that was already delivered", () => {
    // isOverdue() excludes delivered/canceled, so a stop closed late must not reappear tomorrow.
    const rows = todaysStops([s({ id: "done", delivery_date: "2026-08-18", stage: "delivered" })], "Nick Huerta", NOW);
    expect(rows).toEqual([]);
  });

  it("returns nothing for a driver with no name rather than matching every unassigned order", () => {
    // assigned_driver is null on unassigned orders; a bare equality check would hand them all over.
    const rows = todaysStops([s({ id: "unassigned", assigned_driver: null })], "", NOW);
    expect(rows).toEqual([]);
  });

  it("follows the dispatcher's sequence when one was set", () => {
    const rows = todaysStops(
      [s({ id: "second", route_seq: 2 }), s({ id: "first", route_seq: 1 })],
      "Nick Huerta",
      NOW
    );
    expect(rows.map((r) => r.id)).toEqual(["first", "second"]);
  });

  it("puts a morning-priority stop ahead of the sequence", () => {
    const rows = todaysStops(
      [s({ id: "seq1", route_seq: 1 }), s({ id: "urgent", route_seq: 9, morning_priority: true })],
      "Nick Huerta",
      NOW
    );
    expect(rows[0].id).toBe("urgent");
  });
});

describe("tripsFor", () => {
  it("uses explicit load numbers when somebody set them", () => {
    const stops = [s({ id: "a", load_no: 1 }), s({ id: "b", load_no: 2 }), s({ id: "c", load_no: 1 })];
    const trips = tripsFor(stops, 100);
    // Grouped by load, not by capacity — capacity is huge here and would otherwise give one trip.
    expect(trips).toHaveLength(2);
  });

  it("splits by truck capacity when no load numbers were set", () => {
    const stops = [
      s({ id: "a", est_pallets: 8 }),
      s({ id: "b", est_pallets: 8 }),
      s({ id: "c", est_pallets: 8 }),
    ];
    const trips = tripsFor(stops, 12);
    expect(trips.map((t) => t.map((x) => x.id))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("prefers actual pallets over the estimate once the truck is loaded", () => {
    const stops = [s({ id: "a", est_pallets: 2, actual_pallets: 10 }), s({ id: "b", est_pallets: 2 })];
    expect(tripsFor(stops, 11)).toHaveLength(2);
  });

  it("gives a single oversized stop its own trip rather than splitting one order", () => {
    const trips = tripsFor([s({ id: "huge", est_pallets: 40 })], 12);
    expect(trips).toEqual([[expect.objectContaining({ id: "huge" })]]);
  });
});

describe("nextStop", () => {
  it("is the first stop still to finish", () => {
    const stops = [s({ id: "a", stage: "delivered" }), s({ id: "b" }), s({ id: "c" })];
    expect(nextStop(stops)?.id).toBe("b");
  });

  it("is null once the day is done", () => {
    expect(nextStop([s({ id: "a", stage: "delivered" })])).toBeNull();
  });

  it("is null for an empty day", () => {
    expect(nextStop([])).toBeNull();
  });
});

describe("capacityFor", () => {
  it("prefers this driver's own capacity", () => {
    expect(capacityFor("Nick Huerta", { "Nick Huerta": 20 }, 15)).toBe(20);
  });

  it("falls back to the company default", () => {
    expect(capacityFor("Nick Huerta", {}, 15)).toBe(15);
  });

  it("falls back to the constant when nothing is configured", () => {
    expect(capacityFor("Nick Huerta", null, null)).toBe(12);
  });
});
