import { describe, it, expect } from "vitest";
import { computeKpis, driverStats, driverKpis, driverShiftKpis, driverQualityKpis, deliveryTrend, groupVolume, overdueOrders, inDateRange, approvalTurnaroundMs, salesRepStatsThisMonth } from "@/lib/analytics";
import { mkDelivery } from "@/lib/__fixtures";
import type { Delivery, DriverShift, OrderEvent, Profile } from "@/lib/types";

describe("computeKpis", () => {
  it("counts each stage into the right bucket", () => {
    const k = computeKpis([
      mkDelivery({ stage: "pending" }),
      mkDelivery({ stage: "approved" }),
      mkDelivery({ stage: "fulfilling" }),
      mkDelivery({ stage: "ready" }),
      mkDelivery({ stage: "picked_up" }),
      mkDelivery({ stage: "delivered" }),
      mkDelivery({ stage: "canceled" }),
    ]);
    expect(k.total).toBe(7);
    expect(k.pending).toBe(1);
    expect(k.approved).toBe(1);
    expect(k.inWarehouse).toBe(2); // fulfilling + ready
    expect(k.outForDelivery).toBe(1);
    expect(k.delivered).toBe(1);
    expect(k.canceled).toBe(1);
  });

  it("prefers actual pallets over estimated", () => {
    const k = computeKpis([mkDelivery({ est_pallets: 5, actual_pallets: 8 })]);
    expect(k.totalPallets).toBe(8);
  });

  it("sums delivery fees but excludes canceled orders", () => {
    const k = computeKpis([
      mkDelivery({ delivery_fee: 75 }),
      mkDelivery({ delivery_fee: 25 }),
      mkDelivery({ delivery_fee: 999, stage: "canceled" }),
    ]);
    expect(k.totalFees).toBe(100);
  });

  it("reports null on-time% when nothing delivered has a date", () => {
    expect(computeKpis([mkDelivery({ stage: "pending" })]).onTimePct).toBeNull();
  });

  it("counts a delivery completed before its date as on time", () => {
    const k = computeKpis([
      mkDelivery({ stage: "delivered", delivery_date: "2030-01-01", updated_at: "2029-12-31T10:00:00Z" }),
    ]);
    expect(k.onTimePct).toBe(100);
  });

  it("counts a delivery completed after its date as late", () => {
    const k = computeKpis([
      mkDelivery({ stage: "delivered", delivery_date: "2020-01-01", updated_at: "2020-01-05T10:00:00Z" }),
    ]);
    expect(k.onTimePct).toBe(0);
  });
});

describe("driverStats", () => {
  it("aggregates totals per driver, ignoring unassigned", () => {
    const stats = driverStats([
      mkDelivery({ assigned_driver: "Carlos", stage: "delivered", est_pallets: 2, route_miles: 10 }),
      mkDelivery({ assigned_driver: "Carlos", stage: "ready", est_pallets: 3, route_miles: 5 }),
      mkDelivery({ assigned_driver: null, stage: "ready" }),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ driver: "Carlos", total: 2, delivered: 1, active: 1, pallets: 5, miles: 15 });
  });
});

describe("groupVolume", () => {
  it("groups by store and sorts by volume desc", () => {
    const g = groupVolume([
      mkDelivery({ store: "Pharr" }),
      mkDelivery({ store: "McAllen" }),
      mkDelivery({ store: "McAllen" }),
    ], "store");
    expect(g[0]).toMatchObject({ key: "McAllen", total: 2 });
    expect(g[1]).toMatchObject({ key: "Pharr", total: 1 });
  });

  it("buckets blanks under a dash", () => {
    expect(groupVolume([mkDelivery({ account: null })], "account")[0].key).toBe("—");
  });
});

describe("overdueOrders", () => {
  it("includes past-due active orders and excludes delivered/canceled", () => {
    const rows = [
      mkDelivery({ order_no: 1, stage: "ready", delivery_date: "2020-01-01" }),
      mkDelivery({ order_no: 2, stage: "delivered", delivery_date: "2020-01-01" }),
      mkDelivery({ order_no: 3, stage: "canceled", delivery_date: "2020-01-01" }),
      mkDelivery({ order_no: 4, stage: "ready", delivery_date: "2099-01-01" }),
    ];
    expect(overdueOrders(rows).map((d) => d.order_no)).toEqual([1]);
  });
});

describe("inDateRange", () => {
  it("includes the range boundaries", () => {
    const rows = [
      mkDelivery({ order_no: 1, delivery_date: "2026-07-01" }),
      mkDelivery({ order_no: 2, delivery_date: "2026-07-15" }),
      mkDelivery({ order_no: 3, delivery_date: "2026-07-31" }),
    ];
    expect(inDateRange(rows, "2026-07-01", "2026-07-15").map((d) => d.order_no)).toEqual([1, 2]);
  });
});

describe("approvalTurnaroundMs", () => {
  it("measures pending → approved from the event log", () => {
    const d = mkDelivery({ id: "x", approved_at: "2026-07-15T11:00:00Z" });
    const events: OrderEvent[] = [
      { id: "e1", delivery_id: "x", kind: "pending", note: null, created_by: null, created_at: "2026-07-15T09:00:00Z" },
    ];
    const { avgMs, count } = approvalTurnaroundMs([d], events);
    expect(count).toBe(1);
    expect(avgMs).toBe(2 * 60 * 60 * 1000); // 2 hours
  });

  it("ignores orders that were never approved", () => {
    expect(approvalTurnaroundMs([mkDelivery({ approved_at: null })], []).count).toBe(0);
  });
});

describe("driverKpis", () => {
  it("computes orders, revenue, revenue/mile and on-time %", () => {
    const dels = [
      mkDelivery({ assigned_driver: "Ana", stage: "delivered", delivery_date: "2026-07-20", delivery_windows: "1000-1200", route_miles: 10, delivery_fee: 100, pod_delivered_at: "2026-07-20T11:00:00", est_pallets: 6 }),
      mkDelivery({ assigned_driver: "Ana", stage: "delivered", delivery_date: "2026-07-20", delivery_windows: "1000-1200", route_miles: 10, delivery_fee: 100, pod_delivered_at: "2026-07-20T14:00:00", est_pallets: 6 }),
      mkDelivery({ assigned_driver: "Ana", stage: "canceled", delivery_date: "2026-07-20", delivery_fee: 999 }),
    ];
    const [k] = driverKpis(dels, () => 12);
    expect(k.driver).toBe("Ana");
    expect(k.orders).toBe(2);        // canceled excluded
    expect(k.delivered).toBe(2);
    expect(k.revenue).toBe(200);
    expect(k.miles).toBe(20);
    expect(k.revPerMile).toBe(10);
    expect(k.onTimePct).toBe(50);    // one of two delivered on time
    expect(k.routes).toBe(1);
    expect(k.avgStops).toBe(2);
  });

  it("derives utilization from avg pallets per day vs capacity", () => {
    const dels = [
      mkDelivery({ assigned_driver: "Ana", stage: "approved", delivery_date: "2026-07-20", est_pallets: 6 }),
      mkDelivery({ assigned_driver: "Ana", stage: "approved", delivery_date: "2026-07-20", est_pallets: 6 }),
    ];
    const [k] = driverKpis(dels, () => 12);
    expect(k.utilizationPct).toBe(100); // 12 pallets / 1 day ÷ 12 cap
  });

  it("computes fuel cost, cost per delivery and CSAT from the cost model", () => {
    const dels = [
      mkDelivery({ assigned_driver: "Ana", stage: "delivered", delivery_date: "2026-07-20", route_miles: 20, csat_rating: 5 }),
      mkDelivery({ assigned_driver: "Ana", stage: "delivered", delivery_date: "2026-07-20", route_miles: 20, csat_rating: 3 }),
    ];
    const [k] = driverKpis(dels, () => 12, { fuelPrice: 4, mpg: 20, base: 10 });
    expect(k.fuelCost).toBe(8);          // 40 mi ÷ 20 mpg = 2 gal × $4
    expect(k.costPerDelivery).toBe(14);  // ($8 fuel + $10×2 base) ÷ 2 orders
    expect(k.avgCsat).toBe(4);           // (5 + 3) / 2
    expect(k.csatCount).toBe(2);
  });

  it("leaves fuel/cost null without a cost model", () => {
    const [k] = driverKpis([mkDelivery({ assigned_driver: "Ana", stage: "approved", route_miles: 10 })], () => 12);
    expect(k.fuelCost).toBeNull();
    expect(k.costPerDelivery).toBeNull();
    expect(k.avgCsat).toBeNull();
  });
});

describe("driverShiftKpis", () => {
  const mkShift = (over: Partial<DriverShift> = {}): DriverShift => ({
    id: "s1", driver_id: "u1", started_at: "2026-08-01T08:00:00.000Z",
    ended_at: "2026-08-01T16:00:00.000Z", note: null, device_id: null, created_at: "2026-08-01T08:00:00.000Z", ...over,
  });
  const nameOf = (id: string) => (id === "u1" ? "Alex" : undefined);

  it("idle = on-clock minus active pickup→delivered time", () => {
    // 8h clocked; one delivery worked 2h → 6h idle, 25% active.
    const shifts = [mkShift()];
    const deliveries = [mkDelivery({
      assigned_driver: "Alex", stage: "delivered",
      pickup_gps_at: "2026-08-01T09:00:00.000Z", pod_delivered_at: "2026-08-01T11:00:00.000Z",
    })];
    const [k] = driverShiftKpis(shifts, deliveries, nameOf);
    expect(k.driver).toBe("Alex");
    expect(k.onClockMin).toBe(8 * 60);
    expect(k.activeMin).toBe(2 * 60);
    expect(k.idleMin).toBe(6 * 60);
    expect(k.activePct).toBe(25);
    expect(k.open).toBe(false);
  });

  it("counts the drive-to-pickup leg (departed_at) as active when present", () => {
    // 8h clocked; departed 08:30, delivered 11:00 → 2.5h active (vs 2h from pickup).
    const shifts = [mkShift()];
    const deliveries = [mkDelivery({
      assigned_driver: "Alex", stage: "delivered",
      departed_at: "2026-08-01T08:30:00.000Z",
      pickup_gps_at: "2026-08-01T09:00:00.000Z", pod_delivered_at: "2026-08-01T11:00:00.000Z",
    })];
    const [k] = driverShiftKpis(shifts, deliveries, nameOf);
    expect(k.activeMin).toBe(150); // 2h30 from departed_at, not 2h from pickup
    expect(k.idleMin).toBe(8 * 60 - 150);
  });

  it("open shift counts up to `now` and is flagged", () => {
    const now = new Date("2026-08-01T10:00:00.000Z").getTime();
    const shifts = [mkShift({ ended_at: null })]; // started 08:00, now 10:00 → 2h
    const [k] = driverShiftKpis(shifts, [], nameOf, now);
    expect(k.onClockMin).toBe(2 * 60);
    expect(k.open).toBe(true);
    expect(k.idleMin).toBe(2 * 60); // no deliveries → all idle
  });

  it("computes deliveries per active hour", () => {
    // 8h clocked; 4h active over 2 deliveries → 0.5 deliveries/active-hr.
    const shifts = [mkShift()];
    const deliveries = [
      mkDelivery({ assigned_driver: "Alex", stage: "delivered", pickup_gps_at: "2026-08-01T09:00:00.000Z", pod_delivered_at: "2026-08-01T11:00:00.000Z" }),
      mkDelivery({ assigned_driver: "Alex", stage: "delivered", pickup_gps_at: "2026-08-01T12:00:00.000Z", pod_delivered_at: "2026-08-01T14:00:00.000Z" }),
    ];
    const [k] = driverShiftKpis(shifts, deliveries, nameOf);
    expect(k.delivered).toBe(2);
    expect(k.activeMin).toBe(4 * 60);
    expect(k.perActiveHr).toBe(0.5);
  });

  it("caps active at on-clock time and ignores unknown drivers", () => {
    const shifts = [mkShift(), mkShift({ id: "s2", driver_id: "ghost" })];
    const deliveries = [mkDelivery({
      assigned_driver: "Alex", stage: "delivered",
      pickup_gps_at: "2026-08-01T00:00:00.000Z", pod_delivered_at: "2026-08-02T00:00:00.000Z", // 24h > 8h
    })];
    const rows = driverShiftKpis(shifts, deliveries, nameOf);
    expect(rows).toHaveLength(1); // ghost driver_id resolves to undefined → dropped
    expect(rows[0].activeMin).toBe(8 * 60); // capped at on-clock
    expect(rows[0].idleMin).toBe(0);
    expect(rows[0].activePct).toBe(100);
  });
});

describe("driverQualityKpis", () => {
  it("computes leg times, redelivery, POD compliance, rating response, short loads", () => {
    const dels = [
      // Full success: 30m drive, 90m transit (45m dwell), signed, rated, full load.
      mkDelivery({
        assigned_driver: "Sam", stage: "delivered", est_pallets: 6, actual_pallets: 6,
        departed_at: "2026-08-01T08:00:00.000Z", pickup_gps_at: "2026-08-01T08:30:00.000Z",
        arrived_at: "2026-08-01T09:15:00.000Z", pod_delivered_at: "2026-08-01T10:00:00.000Z",
        pod_signature: "sig", csat_rating: 5,
      }),
      // Redelivery, short load, no POD, unrated.
      mkDelivery({
        assigned_driver: "Sam", stage: "delivered", est_pallets: 6, actual_pallets: 4,
        redelivery_of: "old-1",
      }),
      // Cancelled — excluded entirely.
      mkDelivery({ assigned_driver: "Sam", stage: "canceled" }),
    ];
    const [k] = driverQualityKpis(dels);
    expect(k.orders).toBe(2);              // cancelled excluded
    expect(k.delivered).toBe(2);
    expect(k.avgDriveToPickupMin).toBe(30);
    expect(k.avgTransitMin).toBe(90);      // only the first has both stamps
    expect(k.avgDwellMin).toBe(45);        // arrived → delivered
    expect(k.redeliveries).toBe(1);
    expect(k.redeliveryPct).toBe(50);
    expect(k.podCompliancePct).toBe(50);   // 1 of 2 delivered signed
    expect(k.csatResponsePct).toBe(50);    // 1 of 2 rated
    expect(k.shortLoads).toBe(1);          // 4 < 6 pallets
  });

  it("counts a photo (no signature) as POD compliant", () => {
    const [k] = driverQualityKpis([
      mkDelivery({ assigned_driver: "Sam", stage: "delivered", photos: ["p1"] }),
    ]);
    expect(k.podCompliancePct).toBe(100);
  });

  // D-NEXT (177): la fila de la lista no trae `photos`; el conteo viene en `photo_count`.
  it("counts photo_count (a list row without photos) as POD compliant", () => {
    const { photos: _p, photo_meta: _m, ...fila } = mkDelivery({ assigned_driver: "Sam", stage: "delivered", photo_count: 1 });
    const { photos: _p2, photo_meta: _m2, ...sin } = mkDelivery({ assigned_driver: "Sam", stage: "delivered", photo_count: 0 });
    const [k] = driverQualityKpis([fila, sin] as Delivery[]);
    expect(k.podCompliancePct).toBe(50);
  });

  it("flags a POD GPS stamp far from the geocoded destination", () => {
    const dest = { delivery_lat: 26.2, delivery_lng: -98.2 };
    const [k] = driverQualityKpis([
      // On-site: same coords → within tolerance.
      mkDelivery({ assigned_driver: "Sam", stage: "delivered", pod_lat: 26.2, pod_lng: -98.2, ...dest }),
      // ~1.5 km away → flagged.
      mkDelivery({ assigned_driver: "Sam", stage: "delivered", pod_lat: 26.213, pod_lng: -98.2, ...dest }),
      // Missing POD coords → not checked.
      mkDelivery({ assigned_driver: "Sam", stage: "delivered", ...dest }),
    ]);
    expect(k.podGpsChecked).toBe(2);
    expect(k.podGpsFar).toBe(1);
  });
});

describe("deliveryTrend", () => {
  it("buckets daily for short ranges with on-time and rating", () => {
    const dels = [
      mkDelivery({ stage: "delivered", delivery_date: "2026-08-01", delivery_windows: "1000-1200", pod_delivered_at: "2026-08-01T11:00:00", csat_rating: 5 }),
      mkDelivery({ stage: "delivered", delivery_date: "2026-08-01", delivery_windows: "1000-1200", pod_delivered_at: "2026-08-01T15:00:00", csat_rating: 3 }),
      mkDelivery({ stage: "delivered", delivery_date: "2026-08-03", delivery_windows: "1000-1200", pod_delivered_at: "2026-08-03T11:00:00" }),
      mkDelivery({ stage: "ready", delivery_date: "2026-08-02" }), // not delivered → ignored
    ];
    const t = deliveryTrend(dels, "2026-08-01", "2026-08-03");
    expect(t).toHaveLength(3);              // one bucket per day
    expect(t[0]).toMatchObject({ label: "8/1", delivered: 2, onTimePct: 50, avgCsat: 4 });
    expect(t[1]).toMatchObject({ delivered: 0, onTimePct: null, avgCsat: null });
    expect(t[2]).toMatchObject({ delivered: 1, onTimePct: 100 });
  });

  it("collapses long ranges into fewer week-ish buckets", () => {
    const t = deliveryTrend([], "2026-01-01", "2026-06-30", 12);
    expect(t.length).toBeLessThanOrEqual(12);
    expect(t.length).toBeGreaterThan(1);
  });

  it("returns [] for an inverted range", () => {
    expect(deliveryTrend([], "2026-08-10", "2026-08-01")).toEqual([]);
  });
});

// Nota D-553 (hallazgo 4.6 del traspaso del ERP): salesRepStatsThisMonth leía el reloj del sistema
// por dentro, y la única prueba que la nombraba (panel-por-tienda.test.ts) solo mira que la pantalla la
// llame. Ahora recibe `now`; esto la ejercita con un mes fijo, así que no caduca al cambiar de mes.
describe("salesRepStatsThisMonth con un `now` fijo", () => {
  const users = [{ id: "u1", full_name: "Ana" }, { id: "u2", full_name: "Beto" }] as unknown as Profile[];
  const deliveries = [
    mkDelivery({ created_by: "u1", created_at: "2026-10-03T15:00:00.000Z", delivery_fee: 50 }),
    mkDelivery({ created_by: "u1", created_at: "2026-10-20T15:00:00.000Z", delivery_fee: 30 }),
    mkDelivery({ created_by: "u2", created_at: "2026-10-09T15:00:00.000Z", delivery_fee: 100 }),
    mkDelivery({ created_by: "u2", created_at: "2026-09-28T15:00:00.000Z", delivery_fee: 999 }),
    mkDelivery({ created_by: "u1", created_at: "2026-11-02T15:00:00.000Z", delivery_fee: 999 }),
  ];

  it("cuenta solo el mes de `now`, no el del reloj", () => {
    expect(salesRepStatsThisMonth(deliveries, users, new Date(2026, 9, 14, 12))).toEqual([
      { rep: "Beto", deliveries: 1, chargedTotal: 100, avgPerDelivery: 100 },
      { rep: "Ana", deliveries: 2, chargedTotal: 80, avgPerDelivery: 40 },
    ]);
  });

  it("otro `now`, otro mes: septiembre solo ve la orden de septiembre", () => {
    expect(salesRepStatsThisMonth(deliveries, users, new Date(2026, 8, 15, 12))).toEqual([
      { rep: "Beto", deliveries: 1, chargedTotal: 999, avgPerDelivery: 999 },
    ]);
  });
});
