import { describe, it, expect } from "vitest";
import { haversineMi, loadCostMi, planCostMi, buildGeoLoads, fillByCapacity, type BatchStop } from "./route-batching";

// Real RGV coordinates — the geography this heuristic actually runs against.
const DEPOT = { lat: 26.2034, lng: -98.23 }; // McAllen
const P = {
  mcallen2: { lat: 26.21, lng: -98.24 },
  pharr: { lat: 26.1948, lng: -98.1836 },
  edinburg: { lat: 26.3017, lng: -98.1633 },
  weslaco: { lat: 26.1595, lng: -97.9908 },
  harlingen: { lat: 26.1906, lng: -97.6961 },
  brownsville: { lat: 25.9017, lng: -97.4975 },
  brownsville2: { lat: 25.91, lng: -97.5 },
  spi: { lat: 26.1118, lng: -97.1681 },
};
const s = (id: string, p: { lat: number; lng: number }, pallets: number): BatchStop => ({
  id, lat: p.lat, lng: p.lng, pallets,
});
const groups = (loads: BatchStop[][]) => loads.map((l) => l.map((x) => x.id).sort().join("+"));

describe("haversineMi", () => {
  it("measures real Valley distances", () => {
    expect(haversineMi(DEPOT, P.pharr)).toBeCloseTo(2.94, 1);
    expect(haversineMi(DEPOT, P.brownsville)).toBeCloseTo(50.02, 1);
  });

  it("is zero for the same point and symmetric", () => {
    expect(haversineMi(DEPOT, DEPOT)).toBe(0);
    expect(haversineMi(DEPOT, P.spi)).toBeCloseTo(haversineMi(P.spi, DEPOT), 9);
  });
});

describe("loadCostMi", () => {
  it("is zero for an empty load and a there-and-back for one stop", () => {
    expect(loadCostMi(DEPOT, [])).toBe(0);
    expect(loadCostMi(DEPOT, [{ id: "a", ...P.pharr }])).toBeCloseTo(2 * haversineMi(DEPOT, P.pharr), 6);
  });

  it("never returns less than the round trip to its furthest stop", () => {
    const stops = [{ id: "a", ...P.pharr }, { id: "b", ...P.brownsville }, { id: "c", ...P.spi }];
    const furthest = Math.max(...stops.map((x) => haversineMi(DEPOT, x)));
    expect(loadCostMi(DEPOT, stops)).toBeGreaterThanOrEqual(2 * furthest - 1e-6);
  });

  it("does not depend on the order stops are handed in", () => {
    // Nearest-neighbour + 2-opt should reach the same tour cost either way for a small set.
    const a = [{ id: "a", ...P.pharr }, { id: "b", ...P.edinburg }, { id: "c", ...P.weslaco }];
    expect(loadCostMi(DEPOT, a)).toBeCloseTo(loadCostMi(DEPOT, [...a].reverse()), 6);
  });
});

describe("buildGeoLoads — the point of the module", () => {
  it("keeps two stops on the same street on ONE truck", () => {
    // This is the bug the module exists to fix: the old splitter cut loads by capacity in list
    // order, so two Brownsville deliveries could land on different trucks purely because the
    // boundary fell between them — and reordering afterwards cannot undo that.
    const stops = [s("a", P.brownsville, 4), s("b", P.brownsville2, 4), s("c", P.edinburg, 4)];
    expect(groups(buildGeoLoads(stops, DEPOT, 8)).sort()).toEqual(["a+b", "c"]);
  });

  it("separates the far cluster from the near one", () => {
    const stops = [
      s("a", P.mcallen2, 3), s("b", P.pharr, 3), s("c", P.edinburg, 3),
      s("d", P.brownsville, 3), s("e", P.brownsville2, 3), s("f", P.spi, 3),
    ];
    expect(groups(buildGeoLoads(stops, DEPOT, 9)).sort()).toEqual(["a+b+c", "d+e+f"]);
  });

  it("sends the furthest-reaching load out first", () => {
    const stops = [
      s("a", P.mcallen2, 3), s("b", P.pharr, 3), s("c", P.edinburg, 3),
      s("d", P.brownsville, 3), s("e", P.brownsville2, 3), s("f", P.spi, 3),
    ];
    // The long haul wants the morning.
    expect(groups(buildGeoLoads(stops, DEPOT, 9))[0]).toBe("d+e+f");
  });

  it("never exceeds capacity on any load", () => {
    const stops = [s("a", P.pharr, 5), s("b", P.edinburg, 5), s("c", P.weslaco, 5)];
    for (const load of buildGeoLoads(stops, DEPOT, 5)) {
      expect(load.reduce((n, x) => n + x.pallets, 0)).toBeLessThanOrEqual(5);
    }
  });

  it("puts everything on one truck when capacity allows", () => {
    const stops = [s("a", P.pharr, 1), s("b", P.edinburg, 1), s("c", P.harlingen, 1)];
    expect(groups(buildGeoLoads(stops, DEPOT, 100))).toEqual(["a+b+c"]);
  });

  it("is deterministic — re-running optimize gives the dispatcher the same answer", () => {
    // Ties are broken by id precisely so this holds.
    const stops = [
      s("a", P.mcallen2, 3), s("b", P.pharr, 3), s("c", P.edinburg, 3),
      s("d", P.brownsville, 3), s("e", P.brownsville2, 3), s("f", P.spi, 3),
    ];
    const once = groups(buildGeoLoads(stops, DEPOT, 9)).sort();
    expect(groups(buildGeoLoads(stops, DEPOT, 9)).sort()).toEqual(once);
    // ...and the input order does not change which stops travel together.
    expect(groups(buildGeoLoads([...stops].reverse(), DEPOT, 9)).sort()).toEqual(once);
  });

  it("loses no stop, ever", () => {
    const stops = [
      s("a", P.pharr, 2), s("b", P.edinburg, 2),
      { id: "u1", lat: null, lng: null, pallets: 2 },
      { id: "u2", lat: null, lng: null, pallets: 99 },
    ];
    const ids = buildGeoLoads(stops, DEPOT, 8).flat().map((x) => x.id).sort();
    expect(ids).toEqual(["a", "b", "u1", "u2"]);
  });

  it("tucks an unpinned stop into a load with room, and gives an oversize one its own", () => {
    const stops = [
      s("a", P.pharr, 2), s("b", P.edinburg, 2),
      { id: "u1", lat: null, lng: null, pallets: 2 },
      { id: "u2", lat: null, lng: null, pallets: 99 },
    ];
    expect(groups(buildGeoLoads(stops, DEPOT, 8)).sort()).toEqual(["a+b+u1", "u2"]);
  });

  it("handles zero-pallet stops without looping", () => {
    expect(groups(buildGeoLoads([s("a", P.pharr, 0), s("b", P.edinburg, 0)], DEPOT, 5))).toEqual(["a+b"]);
  });
});

describe("buildGeoLoads fallbacks", () => {
  const stops = [s("a", P.brownsville, 4), s("b", P.brownsville2, 4), s("c", P.edinburg, 4)];

  it("falls back to plain capacity filling with no depot to measure from", () => {
    expect(groups(buildGeoLoads(stops, null, 8))).toEqual(["a+b", "c"]);
  });

  it("falls back with no capacity limit — nothing to cluster against", () => {
    expect(groups(buildGeoLoads(stops, DEPOT, 0))).toEqual(["a+b+c"]);
  });

  it("falls back with fewer than two located stops", () => {
    expect(groups(buildGeoLoads([s("a", P.pharr, 2)], DEPOT, 8))).toEqual(["a"]);
  });
});

describe("fillByCapacity (the old behaviour, kept as fallback)", () => {
  it("fills in list order until full, then starts another", () => {
    const stops = [s("a", P.pharr, 3), s("b", P.edinburg, 4), s("c", P.weslaco, 5)];
    expect(groups(fillByCapacity(stops, 7))).toEqual(["a+b", "c"]);
  });

  it("treats capacity 0 as unlimited", () => {
    expect(groups(fillByCapacity([s("a", P.pharr, 3), s("b", P.edinburg, 4)], 0))).toEqual(["a+b"]);
  });

  it("returns nothing for no stops", () => {
    expect(fillByCapacity([], 5)).toEqual([]);
  });
});

describe("planCostMi", () => {
  it("sums the cost of every load", () => {
    const loads = [[s("a", P.pharr, 1)], [s("b", P.brownsville, 1)]];
    expect(planCostMi(DEPOT, loads)).toBeCloseTo(
      loadCostMi(DEPOT, [{ id: "a", ...P.pharr }]) + loadCostMi(DEPOT, [{ id: "b", ...P.brownsville }]),
      6
    );
  });

  it("ignores unpinned stops rather than treating them as the depot", () => {
    const loads = [[s("a", P.pharr, 1), { id: "u", lat: null, lng: null, pallets: 1 }]];
    expect(planCostMi(DEPOT, loads)).toBeCloseTo(loadCostMi(DEPOT, [{ id: "a", ...P.pharr }]), 6);
  });
});
