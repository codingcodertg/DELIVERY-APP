import { describe, it, expect } from "vitest";
import {
  driverOf, laneKeyFor, loadFromKey, loadNoOf, orderLaneKey,
  groupIntoLoads, hasManualLoads, nextLoadFor, targetPatch, planMerge, groupByLane,
  type LaneOrder, type LaneLite,
} from "./route-lanes";

describe("lane key encoding", () => {
  it("round-trips a driver and load", () => {
    expect(laneKeyFor("José", 2)).toBe("José#L2");
    expect(driverOf("José#L2")).toBe("José");
    expect(loadFromKey("José#L2")).toBe(2);
  });

  it("uses the bare name for load 1 — and for anything below it", () => {
    expect(laneKeyFor("Ana", 1)).toBe("Ana");
    expect(laneKeyFor("Ana", 0)).toBe("Ana");
    expect(laneKeyFor("Ana", -1)).toBe("Ana");
  });

  it("handles multi-digit loads", () => {
    expect(driverOf("José#L10")).toBe("José");
    expect(loadFromKey("José#L10")).toBe(10);
  });

  it("leaves a malformed suffix attached rather than truncating a real name", () => {
    // "#L" with no digits, or a non-numeric suffix, is part of the name as far as this is concerned
    // — better than silently renaming a driver.
    expect(driverOf("José#L")).toBe("José#L");
    expect(driverOf("José#Lx")).toBe("José#Lx");
    expect(loadFromKey("José#L")).toBe(1);
  });

  it("is case-sensitive on the separator", () => {
    expect(driverOf("Ana#l2")).toBe("Ana#l2");
  });

  it("splits on the LAST separator", () => {
    expect(driverOf("A#L2#L3")).toBe("A#L2");
    expect(loadFromKey("A#L2#L3")).toBe(3);
  });
});

describe("loadNoOf", () => {
  it("normalises null, undefined, 0, 1 and negatives to 1", () => {
    for (const v of [null, undefined, 0, 1, -3]) {
      expect(loadNoOf({ load_no: v as number })).toBe(1);
    }
  });

  it("passes real load numbers through", () => {
    expect(loadNoOf({ load_no: 2 })).toBe(2);
    expect(loadNoOf({ load_no: 5 })).toBe(5);
  });
});

describe("orderLaneKey", () => {
  it("is the driver name — the load is NOT part of the key", () => {
    // A driver is one route card; loads are sections inside it.
    expect(orderLaneKey({ assigned_driver: "Ana", load_no: 2 })).toBe("Ana");
  });

  it("is null for an unassigned order", () => {
    expect(orderLaneKey({ assigned_driver: null })).toBeNull();
    expect(orderLaneKey({ assigned_driver: "" })).toBeNull();
  });
});

describe("groupIntoLoads", () => {
  const orders: LaneOrder[] = [
    { id: "a", assigned_driver: "Ana", load_no: null },
    { id: "b", assigned_driver: "Ana", load_no: 2 },
    { id: "c", assigned_driver: "Ana", load_no: 2 },
    { id: "d", assigned_driver: "Beto", load_no: 3 },
  ];

  it("groups by load number in ascending order", () => {
    expect(groupIntoLoads(orders).map((g) => g.map((x) => x.id))).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("treats null/1 as the same first load", () => {
    const g = groupIntoLoads([{ id: "x", load_no: null }, { id: "y", load_no: 1 }]);
    expect(g).toHaveLength(1);
    expect(g[0].map((o) => o.id)).toEqual(["x", "y"]);
  });

  it("returns nothing for no stops", () => {
    expect(groupIntoLoads([])).toEqual([]);
  });

  it("never loses a stop", () => {
    expect(groupIntoLoads(orders).flat()).toHaveLength(orders.length);
  });
});

describe("hasManualLoads", () => {
  it("is true only when some stop carries load ≥ 2", () => {
    expect(hasManualLoads([{ load_no: null }, { load_no: 2 }])).toBe(true);
    expect(hasManualLoads([{ load_no: null }, { load_no: 1 }])).toBe(false);
    expect(hasManualLoads([])).toBe(false);
  });
});

describe("nextLoadFor", () => {
  const orders: LaneOrder[] = [
    { id: "a", assigned_driver: "Ana", load_no: null },
    { id: "b", assigned_driver: "Ana", load_no: 2 },
    { id: "d", assigned_driver: "Beto", load_no: 3 },
  ];

  it("is one past the driver's highest load", () => {
    expect(nextLoadFor(orders, "Ana")).toBe(3);
    expect(nextLoadFor(orders, "Beto")).toBe(4);
  });

  it("is 1 for a driver with no work yet", () => {
    expect(nextLoadFor(orders, "Nobody")).toBe(1);
  });
});

describe("targetPatch", () => {
  it("always clears route_seq", () => {
    // A stop moved to another truck has no meaningful position in the old truck's sequence, and
    // leaving the number behind would place it wrongly on the new one.
    for (const t of [
      { isBucket: false, driver: "Ana", load: 1 },
      { isBucket: false, driver: "Ana", load: 3 },
      { isBucket: true, driver: "Zone A", load: 2 },
    ]) {
      expect(targetPatch(t).route_seq).toBeNull();
    }
  });

  it("stores load 1 as null rather than 1", () => {
    expect(targetPatch({ isBucket: false, driver: "Ana", load: 1 }).load_no).toBeNull();
    expect(targetPatch({ isBucket: false, driver: "Ana", load: 3 }).load_no).toBe(3);
  });

  it("a bucket never carries a load number", () => {
    expect(targetPatch({ isBucket: true, driver: "Zone A", load: 2 }).load_no).toBeNull();
  });
});

describe("planMerge", () => {
  const lanes: LaneLite[] = [
    { key: "Ana", isBucket: false, driver: "Ana", load: 1 },
    { key: "Beto", isBucket: false, driver: "Beto", load: 1 },
    { key: "Zone A", isBucket: true, driver: "Zone A", load: 1 },
  ];
  const byLane = new Map<string, { id: string }[]>([
    ["Ana", [{ id: "a" }]],
    ["Beto", [{ id: "d" }]],
    ["Zone A", [{ id: "z1" }, { id: "z2" }]],
  ]);

  it("merges everything onto the first checked lane in DISPLAY order", () => {
    const p = planMerge(lanes, new Set(["Ana", "Beto"]), byLane)!;
    expect(p.targetKey).toBe("Ana");
    expect(p.moveIds).toEqual(["d"]);
  });

  it("uses display order, not selection order, so the outcome is predictable", () => {
    // Selecting Zone A first still targets Ana, because Ana comes first on screen.
    expect(planMerge(lanes, new Set(["Zone A", "Ana"]), byLane)!.targetKey).toBe("Ana");
  });

  it("retires an emptied bucket", () => {
    const p = planMerge(lanes, new Set(["Ana", "Zone A"]), byLane)!;
    expect(p.moveIds).toEqual(["z1", "z2"]);
    expect(p.removeBuckets).toEqual(["Zone A"]);
  });

  it("does nothing with fewer than two lanes selected", () => {
    expect(planMerge(lanes, new Set(["Ana"]), byLane)).toBeNull();
    expect(planMerge(lanes, new Set(), byLane)).toBeNull();
  });

  it("PINNED: an unknown key silently aborts the whole merge", () => {
    // A key not present in `lanes` is dropped, so {Ghost, Ana} collapses to one lane and returns
    // null — the merge quietly does nothing rather than merging the lanes that ARE valid. Reachable
    // if a lane disappears between render and click. Ported as-is.
    expect(planMerge(lanes, new Set(["Ghost", "Ana"]), byLane)).toBeNull();
  });
});

describe("groupByLane", () => {
  it("groups by driver and omits unassigned orders", () => {
    const orders: LaneOrder[] = [
      { id: "a", assigned_driver: "Ana", load_no: null },
      { id: "b", assigned_driver: "Ana", load_no: 2 },
      { id: "d", assigned_driver: "Beto", load_no: 3 },
      { id: "e", assigned_driver: null },
      { id: "f", assigned_driver: "" },
    ];
    const g = groupByLane(orders, () => false);
    expect([...g.keys()]).toEqual(["Ana", "Beto"]);
    expect(g.get("Ana")!.map((o) => o.id)).toEqual(["a", "b"]);
  });
});
