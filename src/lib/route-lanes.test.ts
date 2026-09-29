import { describe, it, expect } from "vitest";
import type { Delivery } from "@/lib/types";
import {
  driverOf, laneKeyFor, loadFromKey, orderLaneKey,
  targetPatch, planMerge, groupByLane, type LaneLite,
} from "@/lib/route-lanes";

// A tiny order factory — only the fields the lane logic reads.
const mk = (id: string, assigned_driver: string | null, load_no: number | null = null): Delivery =>
  ({ id, assigned_driver, load_no, route_seq: null } as unknown as Delivery);

// In the sandbox, route buckets are just names in a list.
const bucketSet = (names: string[]) => (n: string) => names.includes(n);

describe("lane key helpers", () => {
  it("keeps load 1 as the bare driver name; load ≥2 gets a suffix", () => {
    expect(laneKeyFor("José", 1)).toBe("José");
    expect(laneKeyFor("José", 2)).toBe("José#L2");
    expect(driverOf("José")).toBe("José");
    expect(driverOf("José#L2")).toBe("José");
    expect(loadFromKey("José#L2")).toBe(2);
    expect(loadFromKey("José")).toBe(1);
  });

  it("doesn't mistake a driver name that contains #L for a load", () => {
    expect(driverOf("A#Lpha")).toBe("A#Lpha"); // not digits after #L
    expect(loadFromKey("A#Lpha")).toBe(1);
  });

  it("resolves an order's lane: one lane per driver/temp driver (load is a sub-section)", () => {
    const isB = bucketSet(["Route 1"]);
    expect(orderLaneKey(mk("x", null), isB)).toBeNull();
    expect(orderLaneKey(mk("x", "Route 1"), isB)).toBe("Route 1");
    expect(orderLaneKey(mk("x", "José", 1), isB)).toBe("José");
    expect(orderLaneKey(mk("x", "José", 2), isB)).toBe("José"); // same card: an old load 2 is just part of the list (D-NEXT)
  });
});

describe("targetPatch", () => {
  it("bucket target clears the load", () => {
    expect(targetPatch({ isBucket: true, driver: "Route 2", load: 1 }))
      .toEqual({ assigned_driver: "Route 2", load_no: null, route_seq: null });
  });
  it("a driver target clears the load too: no trips since D-NEXT", () => {
    expect(targetPatch({ isBucket: false, driver: "José", load: 1 }))
      .toEqual({ assigned_driver: "José", load_no: null, route_seq: null });
    expect(targetPatch({ isBucket: false, driver: "José", load: 2 }))
      .toEqual({ assigned_driver: "José", load_no: null, route_seq: null });
  });
});

// Full teaching-mode-style flow, run purely on the lane logic (no DB): create
// orders, drop them into route buckets, hand a bucket to a driver as a load,
// then merge two lanes into one.
describe("routes flow: temp drivers, split loads, merge", () => {
  const lanesFor = (orders: Delivery[], drivers: string[], buckets: string[]): LaneLite[] => {
    const out: LaneLite[] = [];
    for (const dr of drivers) out.push({ key: dr, driver: dr, load: 1, isBucket: false });
    for (const b of buckets) out.push({ key: b, driver: b, load: 1, isBucket: true });
    return out;
  };

  it("assigning two temp drivers' orders to a driver puts them in ONE lane (no truckloads since D-NEXT)", () => {
    const isB = bucketSet(["Route 1", "Route 2"]);
    const orders: Delivery[] = [
      mk("a", "Route 1"), mk("b", "Route 1"),
      mk("c", "Route 2"), mk("d", "Route 2"), mk("e", "Route 2"),
    ];
    // Hand Route 1 → José (its own truckload), Route 2 → José as a second load.
    for (const d of orders) if (d.assigned_driver === "Route 1") d.assigned_driver = "José";
    for (const d of orders) if (d.assigned_driver === "Route 2") { d.assigned_driver = "José"; d.load_no = 2; }

    // ONE lane/card for José — not one per load.
    const byLane = groupByLane(orders, isB);
    expect([...byLane.keys()]).toEqual(["José"]);
    expect(byLane.get("José")!.map((o) => o.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("merging two temp drivers retires the emptied one", () => {
    const buckets = ["Route 1", "Route 2"];
    const isB = bucketSet(buckets);
    const orders = [mk("a", "Route 1"), mk("b", "Route 2"), mk("c", "Route 2")];
    const lanes = lanesFor(orders, [], buckets);
    const plan = planMerge(lanes, new Set(["Route 1", "Route 2"]), groupByLane(orders, isB));
    expect(plan!.targetKey).toBe("Route 1");
    expect(plan!.moveIds).toEqual(["b", "c"]);
    expect(plan!.removeBuckets).toEqual(["Route 2"]); // emptied bucket retired
  });

  it("won't merge with fewer than two lanes checked", () => {
    const orders = [mk("a", "José", 1)];
    const lanes = lanesFor(orders, ["José"], []);
    expect(planMerge(lanes, new Set(["José"]), groupByLane(orders, bucketSet([])))).toBeNull();
  });
});
