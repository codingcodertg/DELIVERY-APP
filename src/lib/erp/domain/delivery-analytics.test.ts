import { test, expect, beforeAll } from "vitest";
// Regression lock for the analytics port (ADR 0010).
//
// These expectations were produced by the ORIGINAL implementation and compared value-for-value,
// function by function — a stronger assertion than hand-written numbers, because they came from the
// code this must not drift from.
//
// WITH ONE DELIBERATE EXCEPTION, and it is the reason this note exists. promisedDue() now builds the
// promised delivery moment in BUSINESS time rather than the runtime's timezone. The source parsed
// `date + "T00:00:00"`, which meant production (UTC on Vercel) measured an 08:30-12:00 Central window
// against 07:00 Central — recording deliveries that arrived inside their window as late, and
// understating the on-time rate for every order that had one.
//
// So the on-time figures below intentionally DIFFER from the source: on this fixture Ana's on-time
// went 50% -> 100% and her average delay 150 min -> 0. Everything else in this file is still
// byte-identical to the original.
//
// A failure here means the port drifted somewhere it should not have. Re-derive before changing a
// number, and do not 'fix' the on-time values back toward the source.
import { computeKpis, countByStage, driverStats, deliveryTrend, driverKpis, driverShiftKpis, driverQualityKpis, groupVolume, approvalTurnaroundMs, overdueOrders, inDateRange, salesRepStatsThisMonth, POD_GPS_TOLERANCE_M, type Delivery, type DriverShift, type OrderEvent, type Profile, type Stage } from "./delivery-analytics";
const mk = (o: Partial<Delivery>): Delivery =>
  ({ created_at: "2026-08-01T10:00:00Z", updated_at: "2026-08-01T10:00:00Z", stage: "draft", ...o }) as Delivery;

/**
 * The moment these expectations were captured. Chosen so the fixture straddles it: order 1
 * (2026-08-20) is late and order 4 (2026-08-24) is not yet, which is what makes the overdue
 * assertions say something.
 */
const AS_OF = new Date("2026-08-24T12:00:00Z");

const FLEET: Delivery[] = [
  mk({ id: "1", stage: "pending", est_pallets: 3, route_miles: 10, delivery_fee: 100, delivery_date: "2026-08-20", assigned_driver: "Ana", created_by: "u1" }),
  mk({ id: "2", stage: "approved", est_pallets: 2, route_miles: 5, delivery_fee: 80, delivery_date: "2026-08-26", assigned_driver: "Ana", created_by: "u1" }),
  mk({ id: "3", stage: "fulfilling", actual_pallets: 4, est_pallets: 3, route_miles: 7.5, delivery_fee: 120, assigned_driver: "Beto", created_by: "u2" }),
  mk({ id: "4", stage: "ready", est_pallets: 1, route_miles: 3, delivery_date: "2026-08-24", assigned_driver: "Beto" }),
  mk({ id: "5", stage: "picked_up", est_pallets: 5, route_miles: 20, delivery_fee: 200, delivery_date: "2026-08-25", assigned_driver: "Ana",
       departed_at: "2026-08-25T13:00:00Z", pickup_gps_at: "2026-08-25T13:30:00Z" }),
  mk({ id: "6", stage: "delivered", est_pallets: 2, route_miles: 15, delivery_fee: 150, delivery_date: "2026-08-20",
       updated_at: "2026-08-20T18:00:00Z", pod_delivered_at: "2026-08-20T17:00:00Z", csat_rating: 5,
       assigned_driver: "Ana", delivery_windows: "0830-1200", pod_signature: "sig", created_by: "u1",
       delivery_lat: 26.2, delivery_lng: -98.23, pod_lat: 26.2, pod_lng: -98.23,
       pickup_gps_at: "2026-08-20T14:00:00Z", arrived_at: "2026-08-20T16:30:00Z", departed_at: "2026-08-20T13:00:00Z",
       approved_at: "2026-08-19T09:00:00Z" }),
  mk({ id: "7", stage: "delivered", est_pallets: 3, route_miles: 8, delivery_fee: 90, delivery_date: "2026-08-21",
       updated_at: "2026-08-23T18:00:00Z", pod_delivered_at: "2026-08-23T18:00:00Z", csat_rating: 3,
       assigned_driver: "Beto", delivery_windows: "0830-1200", photos: ["p"], created_by: "u2",
       delivery_lat: 26.2, delivery_lng: -98.23, pod_lat: 25.9, pod_lng: -97.5, redelivery_of: "6" }),
  mk({ id: "8", stage: "canceled", est_pallets: 9, route_miles: 50, delivery_fee: 999, delivery_date: "2026-08-01" }),
  mk({ id: "9", stage: "delivered", est_pallets: 1, delivery_date: "2026-08-22", updated_at: "2026-08-22T10:00:00Z",
       assigned_driver: "Ana", assigned_sales_rep: "u3", created_by: "u1", delivery_fee: 60 }),
];

const SHIFTS: DriverShift[] = [
  { id: "s1", driver_id: "d-ana", started_at: "2026-08-25T13:00:00Z", ended_at: "2026-08-25T21:00:00Z" } as unknown as DriverShift,
  { id: "s2", driver_id: "d-ana", started_at: "2026-08-26T13:00:00Z", ended_at: null } as unknown as DriverShift,
  { id: "s3", driver_id: "d-beto", started_at: "2026-08-25T14:00:00Z", ended_at: "2026-08-25T20:00:00Z" } as unknown as DriverShift,
];
const EVENTS: OrderEvent[] = [
  { id: "e1", delivery_id: "6", kind: "pending", created_at: "2026-08-19T08:00:00Z" } as unknown as OrderEvent,
  { id: "e2", delivery_id: "6", kind: "approved", created_at: "2026-08-19T09:00:00Z" } as unknown as OrderEvent,
];
const USERS: Profile[] = [
  { id: "u1", full_name: "Rep One", role: "sales" } as unknown as Profile,
  { id: "u2", full_name: "Rep Two", role: "sales" } as unknown as Profile,
  { id: "u3", full_name: "Rep Three", role: "sales" } as unknown as Profile,
];

const EXPECTED = `
tol|250
kpi|{"total":9,"pending":1,"approved":1,"inWarehouse":2,"outForDelivery":1,"delivered":3,"canceled":1,"overdue":1,"totalPallets":30,"totalMiles":118.5,"totalFees":800,"onTimePct":67}
kpi-empty|{"total":0,"pending":0,"approved":0,"inWarehouse":0,"outForDelivery":0,"delivered":0,"canceled":0,"overdue":0,"totalPallets":0,"totalMiles":0,"totalFees":0,"onTimePct":null}
stages|[{"stage":"pending","count":1},{"stage":"delivered","count":3},{"stage":"canceled","count":1}]
dstats|[{"driver":"Ana","total":5,"delivered":2,"active":3,"pallets":13,"miles":50},{"driver":"Beto","total":3,"delivered":1,"active":2,"pallets":8,"miles":18.5}]
trend|[{"label":"8/18","delivered":0,"onTimePct":null,"avgCsat":null},{"label":"8/19","delivered":0,"onTimePct":null,"avgCsat":null},{"label":"8/20","delivered":1,"onTimePct":100,"avgCsat":5},{"label":"8/21","delivered":1,"onTimePct":0,"avgCsat":3},{"label":"8/22","delivered":1,"onTimePct":100,"avgCsat":null},{"label":"8/23","delivered":0,"onTimePct":null,"avgCsat":null},{"label":"8/24","delivered":0,"onTimePct":null,"avgCsat":null},{"label":"8/25","delivered":0,"onTimePct":null,"avgCsat":null},{"label":"8/26","delivered":0,"onTimePct":null,"avgCsat":null}]
trend-1|[{"label":"8/20","delivered":1,"onTimePct":100,"avgCsat":5}]
dkpi|[{"driver":"Ana","orders":5,"delivered":2,"routes":4,"avgStops":1.3,"miles":50,"avgRouteMiles":12.5,"revenue":590,"revPerMile":11.8,"onTimePct":100,"avgDelayMin":0,"pallets":13,"utilizationPct":33,"fuelCost":21.88,"costPerDelivery":24.38,"avgCsat":5,"csatCount":1},{"driver":"Beto","orders":3,"delivered":1,"routes":2,"avgStops":1.5,"miles":18.5,"avgRouteMiles":9.3,"revenue":210,"revPerMile":11.35,"onTimePct":0,"avgDelayMin":2940,"pallets":8,"utilizationPct":40,"fuelCost":8.09,"costPerDelivery":22.7,"avgCsat":3,"csatCount":1}]
dkpi-nocost|[{"driver":"Ana","orders":5,"delivered":2,"routes":4,"avgStops":1.3,"miles":50,"avgRouteMiles":12.5,"revenue":590,"revPerMile":11.8,"onTimePct":100,"avgDelayMin":0,"pallets":13,"utilizationPct":null,"fuelCost":null,"costPerDelivery":null,"avgCsat":5,"csatCount":1},{"driver":"Beto","orders":3,"delivered":1,"routes":2,"avgStops":1.5,"miles":18.5,"avgRouteMiles":9.3,"revenue":210,"revPerMile":11.35,"onTimePct":0,"avgDelayMin":2940,"pallets":8,"utilizationPct":null,"fuelCost":null,"costPerDelivery":null,"avgCsat":3,"csatCount":1}]
shift|[{"driver":"Ana","onClockMin":900,"activeMin":240,"idleMin":660,"activePct":27,"delivered":1,"perActiveHr":0.3,"open":true},{"driver":"Beto","onClockMin":360,"activeMin":0,"idleMin":360,"activePct":0,"delivered":1,"perActiveHr":null,"open":false}]
qual|[{"driver":"Ana","orders":5,"delivered":2,"avgDriveToPickupMin":45,"avgTransitMin":180,"avgDwellMin":30,"redeliveries":0,"redeliveryPct":0,"podCompliancePct":50,"csatResponsePct":50,"shortLoads":0,"podGpsChecked":1,"podGpsFar":0},{"driver":"Beto","orders":3,"delivered":1,"avgDriveToPickupMin":null,"avgTransitMin":null,"avgDwellMin":null,"redeliveries":1,"redeliveryPct":33,"podCompliancePct":100,"csatResponsePct":100,"shortLoads":0,"podGpsChecked":1,"podGpsFar":1}]
vol-store|[{"key":"—","total":9,"delivered":3,"pallets":30}]
vol-acct|[{"key":"—","total":9,"delivered":3,"pallets":30}]
appr|{"avgMs":3600000,"count":1}
appr-none|{"avgMs":1551600000,"count":1}
over|1
range|1,6,7,9
reps|[{"rep":"Rep One","deliveries":3,"chargedTotal":330,"avgPerDelivery":110},{"rep":"Rep Two","deliveries":2,"chargedTotal":210,"avgPerDelivery":105},{"rep":"Rep Three","deliveries":1,"chargedTotal":60,"avgPerDelivery":60}]
`.trim().split("\n");

// TZ is pinned to UTC, and that pin is load-bearing.
//
// promisedDue() in the source parses `YYYY-MM-DDT00:00:00` with NO zone, so the promised moment
// lands at LOCAL midnight. The on-time percentage therefore changes with the machine's timezone:
// the same delivery is on time on a Central-time laptop and late in UTC. Production runs UTC on
// Vercel, so UTC is the figure that matters and the one locked here.
//
// This is a property of the ported code, faithfully preserved — not something introduced here.
beforeAll(() => { process.env.TZ = "UTC"; });

test("analytics port matches the original implementation exactly", () => {
  const out: string[] = [];
  const j = (v: unknown) => JSON.stringify(v);

  out.push(`tol|${POD_GPS_TOLERANCE_M}`);
  // The clock is PINNED. "Overdue" is measured against today, so with a live clock these
  // expectations change at midnight — and they did: this suite went red on its own when the date
  // rolled past a fixture's delivery_date, with no code change behind it. A regression lock whose
  // values depend on when it runs is not a lock.
  out.push(`kpi|${j(computeKpis(FLEET, AS_OF))}`);
  out.push(`kpi-empty|${j(computeKpis([], AS_OF))}`);
  out.push(`stages|${j(countByStage(FLEET, ["pending", "delivered", "canceled"] as Stage[]))}`);
  out.push(`dstats|${j(driverStats(FLEET))}`);
  out.push(`trend|${j(deliveryTrend(FLEET, "2026-08-18", "2026-08-26", 5))}`);
  out.push(`trend-1|${j(deliveryTrend(FLEET, "2026-08-20", "2026-08-20", 12))}`);
  out.push(`dkpi|${j(driverKpis(FLEET, () => 10, { fuelPrice: 3.5, mpg: 8, base: 20 }))}`);
  out.push(`dkpi-nocost|${j(driverKpis(FLEET, () => 0))}`);
    const NAMES: Record<string, string> = { "d-ana": "Ana", "d-beto": "Beto" };
  const NOW = Date.parse("2026-08-26T20:00:00Z");
  out.push(`shift|${j(driverShiftKpis(SHIFTS, FLEET, (id) => NAMES[id], NOW))}`);
  out.push(`qual|${j(driverQualityKpis(FLEET))}`);
  out.push(`vol-store|${j(groupVolume(FLEET, "store"))}`);
  out.push(`vol-acct|${j(groupVolume(FLEET, "account"))}`);
  out.push(`appr|${j(approvalTurnaroundMs(FLEET, EVENTS))}`);
  out.push(`appr-none|${j(approvalTurnaroundMs(FLEET, []))}`);
  out.push(`over|${overdueOrders(FLEET, AS_OF).map((d) => d.id).join(",")}`);
  out.push(`range|${inDateRange(FLEET, "2026-08-20", "2026-08-22").map((d) => d.id).join(",")}`);
  out.push(`reps|${j(salesRepStatsThisMonth(FLEET, USERS))}`);

  expect(out).toEqual(EXPECTED);
});
