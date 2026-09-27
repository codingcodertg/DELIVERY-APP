import { describe, it, expect } from "vitest";
import { parseWindow, suggestDriver, windowConflicts, routeOrder, splitIntoTrips, driverPalletsOn, assignmentWarnings, recommendDriver, unavailableDriverNames } from "@/lib/dispatch";
import { mkDelivery } from "@/lib/__fixtures";

describe("parseWindow", () => {
  it("parses HHMM-HHMM into minutes", () => {
    expect(parseWindow("0800-1200")).toEqual([480, 720]);
  });
  it("pads 3-digit times", () => {
    expect(parseWindow("830-930")).toEqual([510, 570]);
  });
  it("normalizes a reversed range", () => {
    expect(parseWindow("1200-0800")).toEqual([480, 720]);
  });
  it("returns null for junk or empty input", () => {
    expect(parseWindow("anytime")).toBeNull();
    expect(parseWindow(null)).toBeNull();
  });
});

describe("suggestDriver", () => {
  it("returns null when no drivers are configured", () => {
    expect(suggestDriver([], [])).toBeNull();
  });

  it("picks the driver with the fewest active assignments", () => {
    const deliveries = [
      mkDelivery({ assigned_driver: "Carlos", stage: "approved" }),
      mkDelivery({ assigned_driver: "Carlos", stage: "ready" }),
      mkDelivery({ assigned_driver: "Miguel", stage: "fulfilling" }),
    ];
    expect(suggestDriver(["Carlos", "Miguel"], deliveries)).toBe("Miguel");
  });

  it("does not count delivered/canceled orders as load", () => {
    const deliveries = [
      mkDelivery({ assigned_driver: "Carlos", stage: "delivered" }),
      mkDelivery({ assigned_driver: "Carlos", stage: "canceled" }),
      mkDelivery({ assigned_driver: "Miguel", stage: "approved" }),
    ];
    expect(suggestDriver(["Carlos", "Miguel"], deliveries)).toBe("Carlos");
  });
});

describe("windowConflicts", () => {
  const base = { id: "self", assigned_driver: "Carlos", delivery_date: "2026-07-20", delivery_windows: "0900-1100" };

  it("finds an overlapping window for the same driver and day", () => {
    const others = [mkDelivery({ order_no: 1002, assigned_driver: "Carlos", delivery_date: "2026-07-20", delivery_windows: "1000-1200", stage: "approved" })];
    expect(windowConflicts(base, others)).toHaveLength(1);
  });

  it("ignores a different driver", () => {
    const others = [mkDelivery({ assigned_driver: "Miguel", delivery_date: "2026-07-20", delivery_windows: "1000-1200", stage: "approved" })];
    expect(windowConflicts(base, others)).toHaveLength(0);
  });

  it("ignores non-overlapping windows", () => {
    const others = [mkDelivery({ assigned_driver: "Carlos", delivery_date: "2026-07-20", delivery_windows: "1100-1300", stage: "approved" })];
    expect(windowConflicts(base, others)).toHaveLength(0);
  });

  it("ignores delivered orders", () => {
    const others = [mkDelivery({ assigned_driver: "Carlos", delivery_date: "2026-07-20", delivery_windows: "1000-1200", stage: "delivered" })];
    expect(windowConflicts(base, others)).toHaveLength(0);
  });

  it("returns nothing when there is no driver assigned", () => {
    expect(windowConflicts({ ...base, assigned_driver: null }, [])).toEqual([]);
  });
});

describe("routeOrder", () => {
  it("sequences stops by window start, then by shortest drive", () => {
    const a = mkDelivery({ order_no: 1, delivery_windows: "1300-1500" });
    const b = mkDelivery({ order_no: 2, delivery_windows: "0800-1000" });
    const c = mkDelivery({ order_no: 3, delivery_windows: "0800-1000", route_miles: 2 });
    // b has no miles → sorts after c which has 2 miles, both at 0800
    expect(routeOrder([a, b, c]).map((d) => d.order_no)).toEqual([3, 2, 1]);
  });

  it("puts windowless stops last", () => {
    const a = mkDelivery({ order_no: 1, delivery_windows: null });
    const b = mkDelivery({ order_no: 2, delivery_windows: "0900-1000" });
    expect(routeOrder([a, b]).map((d) => d.order_no)).toEqual([2, 1]);
  });

  it("prefers a logistics-optimized route_seq over the window/miles guess", () => {
    // Window order would put b (earlier window) before a, but a's route_seq
    // says it comes first — the optimizer's answer wins.
    const a = mkDelivery({ order_no: 1, delivery_windows: "1300-1500", route_seq: 0 });
    const b = mkDelivery({ order_no: 2, delivery_windows: "0800-1000", route_seq: 1 });
    expect(routeOrder([a, b]).map((d) => d.order_no)).toEqual([1, 2]);
  });

  it("puts un-sequenced stops after sequenced ones, then falls back to window order among them", () => {
    const sequenced = mkDelivery({ order_no: 1, delivery_windows: "1300-1500", route_seq: 0 });
    const unseqEarly = mkDelivery({ order_no: 2, delivery_windows: "0800-1000", route_seq: null });
    const unseqLate = mkDelivery({ order_no: 3, delivery_windows: "1100-1200", route_seq: null });
    expect(routeOrder([unseqLate, sequenced, unseqEarly]).map((d) => d.order_no)).toEqual([1, 2, 3]);
  });
});

describe("splitIntoTrips", () => {
  it("keeps everything in one trip when it fits under capacity", () => {
    const stops = [
      mkDelivery({ order_no: 1, est_pallets: 4 }),
      mkDelivery({ order_no: 2, est_pallets: 3 }),
    ];
    expect(splitIntoTrips(stops, 10).map((trip) => trip.map((d) => d.order_no))).toEqual([[1, 2]]);
  });

  it("starts a new truckload once the next stop would exceed capacity", () => {
    const stops = [
      mkDelivery({ order_no: 1, est_pallets: 6 }),
      mkDelivery({ order_no: 2, est_pallets: 5 }),
      mkDelivery({ order_no: 3, est_pallets: 4 }),
    ];
    // 6 + 5 = 11 > 10, so #2 starts a new load; 5 + 4 = 9 fits with #3.
    expect(splitIntoTrips(stops, 10).map((trip) => trip.map((d) => d.order_no))).toEqual([[1], [2, 3]]);
  });

  it("gives an over-capacity single stop its own truckload rather than dropping it", () => {
    const stops = [mkDelivery({ order_no: 1, est_pallets: 20 })];
    expect(splitIntoTrips(stops, 10).map((trip) => trip.map((d) => d.order_no))).toEqual([[1]]);
  });

  it("prefers actual_pallets (warehouse-confirmed) over est_pallets when both are set", () => {
    const stops = [
      mkDelivery({ order_no: 1, est_pallets: 2, actual_pallets: 9 }),
      mkDelivery({ order_no: 2, est_pallets: 2, actual_pallets: 9 }),
    ];
    // By est_pallets (2+2=4) these'd fit in one 10-pallet load; by the
    // warehouse-confirmed actual_pallets (9+9=18) they don't.
    expect(splitIntoTrips(stops, 10).map((trip) => trip.map((d) => d.order_no))).toEqual([[1], [2]]);
  });
});

describe("driverPalletsOn", () => {
  const dels = [
    mkDelivery({ assigned_driver: "Ana", delivery_date: "2026-07-20", stage: "approved", est_pallets: 4 }),
    mkDelivery({ assigned_driver: "Ana", delivery_date: "2026-07-20", stage: "ready", actual_pallets: 3, est_pallets: 5 }),
    mkDelivery({ assigned_driver: "Ana", delivery_date: "2026-07-20", stage: "delivered", est_pallets: 9 }),
    mkDelivery({ assigned_driver: "Ana", delivery_date: "2026-07-21", stage: "approved", est_pallets: 2 }),
  ];
  it("sums active pallets for a driver+date, preferring actual over est", () => {
    expect(driverPalletsOn("Ana", "2026-07-20", dels)).toBe(7); // 4 + 3, delivered excluded
  });
  it("returns 0 for a missing driver or date", () => {
    expect(driverPalletsOn(null, "2026-07-20", dels)).toBe(0);
    expect(driverPalletsOn("Ana", null, dels)).toBe(0);
  });
});

describe("assignmentWarnings", () => {
  it("flags an overlapping window for the same driver+date", () => {
    const order = mkDelivery({ id: "x", order_no: 2000, delivery_date: "2026-07-20", delivery_windows: "1100-1300" });
    const other = mkDelivery({ order_no: 1001, assigned_driver: "Ana", delivery_date: "2026-07-20", delivery_windows: "1000-1200", stage: "approved" });
    const w = assignmentWarnings(order, "Ana", [order, other], undefined);
    expect(w.some((x) => x.kind === "conflict")).toBe(true);
  });
  it("flags over-capacity", () => {
    const order = mkDelivery({ id: "x", delivery_date: "2026-07-20", delivery_windows: "0800-0900", est_pallets: 5 });
    const other = mkDelivery({ assigned_driver: "Ana", delivery_date: "2026-07-20", stage: "approved", est_pallets: 10 });
    const w = assignmentWarnings(order, "Ana", [order, other], 12);
    expect(w.some((x) => x.kind === "over_capacity")).toBe(true);
  });
  it("is clean with no conflict and within capacity", () => {
    const order = mkDelivery({ id: "x", delivery_date: "2026-07-20", delivery_windows: "0800-0900", est_pallets: 2 });
    expect(assignmentWarnings(order, "Ana", [order], 12)).toEqual([]);
  });
});

describe("recommendDriver", () => {
  it("prefers a clean driver over a conflicted one", () => {
    const order = mkDelivery({ id: "x", order_no: 3000, delivery_date: "2026-07-20", delivery_windows: "1000-1200", est_pallets: 2 });
    const busy = mkDelivery({ order_no: 1001, assigned_driver: "Ana", delivery_date: "2026-07-20", delivery_windows: "1000-1200", stage: "approved", est_pallets: 2 });
    const pick = recommendDriver(order, ["Ana", "Beto"], [order, busy], () => 12);
    expect(pick?.driver).toBe("Beto");
    expect(pick?.warnings).toEqual([]);
  });
  it("returns null when there are no drivers", () => {
    expect(recommendDriver(mkDelivery({}), [], [], () => 12)).toBeNull();
  });
});

// `autoAssign` se quitó en D-419: «✨ Auto-asignar» reparte con el motor. Sus pruebas viven en
// `route-plan/reparto.test.ts` (con días reales anonimizados), incluida la de que dos órdenes con ventanas que se solapan
// pueden ir con el MISMO chofer — la que aquí fijaba lo contrario («splits window-overlapping orders across drivers»)
// fijaba el fallo.

describe("unavailableDriverNames", () => {
  const nameById = new Map([["u1", "Ana"], ["u2", "Beto"]]);
  const rows = [
    { driver_id: "u1", start_date: "2026-07-20", end_date: "2026-07-25" },
    { driver_id: "u2", start_date: "2026-08-01", end_date: "2026-08-01" },
  ];
  it("flags a driver whose range covers the date", () => {
    expect([...unavailableDriverNames(rows, nameById, "2026-07-22")]).toEqual(["Ana"]);
  });
  it("is empty on a date nobody is off", () => {
    expect(unavailableDriverNames(rows, nameById, "2026-07-30").size).toBe(0);
  });
  it("includes range boundaries", () => {
    expect(unavailableDriverNames(rows, nameById, "2026-08-01").has("Beto")).toBe(true);
  });
});
