// Read-only analytics over the deliveries + event log. Ported from the deliveries app (ADR 0010).
// Framework-free (ADR 0006): pure functions, no side effects, so the same numbers render from any
// data source.
//
// Ported as a transformation of the source rather than a rewrite — 15 interlocking functions where a
// hand-retyped comparison operator would silently shift a KPI — then verified by differential test.
// Only the imports and the Delivery/Stage types are localised; every formula is untouched.

import { isOverdue, businessTimeMs } from "./business-time";
import { parseWindow } from "./delivery-scheduling";

/** Straight-line distance in METRES (the POD-vs-destination check works at this scale). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

/**
 * Who gets sales credit for an order. An explicitly assigned rep wins over whoever logged it —
 * created_by always stays the person who actually did the data entry.
 */
export function orderOwner(d: { created_by?: string | null; assigned_sales_rep?: string | null }): string | null {
  return d.assigned_sales_rep ?? d.created_by ?? null;
}

export type Stage = string;

/** The order fields these analytics read. Structural, so any row shape carrying them works. */
export interface Delivery {
  id?: string;
  stage: Stage;
  assigned_driver?: string | null;
  delivery_date?: string | null;
  delivery_windows?: string | null;
  delivery_fee?: number | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  est_pallets?: number | null;
  actual_pallets?: number | null;
  route_miles?: number | null;
  csat_rating?: number | null;
  photos?: unknown[] | null;
  pod_delivered_at?: string | null;
  pod_lat?: number | null;
  pod_lng?: number | null;
  pod_signature?: string | null;
  pickup_gps_at?: string | null;
  departed_at?: string | null;
  arrived_at?: string | null;
  approved_at?: string | null;
  redelivery_of?: string | null;
  input_date?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  assigned_sales_rep?: string | null;
  store?: string | null;
  account?: string | null;
}

export interface DriverShift {
  driver_id: string;
  started_at: string;
  ended_at?: string | null;
}

export interface OrderEvent {
  delivery_id?: string | null;
  kind: string;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name?: string | null;
  role?: string | null;
}

export const POD_GPS_TOLERANCE_M = 250;

// ============================================================
// Read-only analytics over the deliveries + event log. Pure functions,
// mode-agnostic (works with both data providers), no side effects — so the
// Dashboard renders identically in local demo and Supabase modes.
// ============================================================

export interface Kpis {
  total: number;
  pending: number;      // awaiting approval
  approved: number;     // approved, not yet fulfilling
  inWarehouse: number;  // fulfilling + ready
  outForDelivery: number; // picked_up
  delivered: number;
  overdue: number;
  canceled: number;
  totalPallets: number;
  totalMiles: number;
  totalFees: number;        // delivery fees charged across these orders
  onTimePct: number | null; // delivered on/before delivery_date ÷ delivered with a date
}

const activeStages: Stage[] = ["draft", "pending", "approved", "fulfilling", "ready", "picked_up"];

/**
 * `now` exists so a caller can pin the clock. Production never passes it and behaves exactly as
 * before; the regression lock passes a fixed date, because "overdue" is measured against today and
 * a lock whose expected values change at midnight is not a lock. That is not hypothetical -- this
 * suite went red on its own when the date rolled over, with no code change behind it.
 */
export function computeKpis(deliveries: Delivery[], now: Date = new Date()): Kpis {
  let pending = 0, approved = 0, inWarehouse = 0, outForDelivery = 0, delivered = 0, canceled = 0;
  let overdue = 0, totalPallets = 0, totalMiles = 0, totalFees = 0;
  let onTimeEligible = 0, onTime = 0;

  for (const d of deliveries) {
    switch (d.stage) {
      case "pending": pending++; break;
      case "approved": approved++; break;
      case "fulfilling": case "ready": inWarehouse++; break;
      case "picked_up": outForDelivery++; break;
      case "delivered": delivered++; break;
      case "canceled": canceled++; break;
    }
    if (isOverdue(d, now)) overdue++;
    totalPallets += Number(d.actual_pallets ?? d.est_pallets ?? 0);
    totalMiles += Number(d.route_miles ?? 0);
    if (d.stage !== "canceled") totalFees += Number(d.delivery_fee ?? 0);
    if (d.stage === "delivered" && d.delivery_date) {
      onTimeEligible++;
      // Delivered on time if the last "delivered" event (or updated_at) is on/before the delivery date.
      const deliveredWhen = new Date(d.updated_at).getTime();
      const due = new Date(d.delivery_date + "T23:59:59").getTime();
      if (deliveredWhen <= due) onTime++;
    }
  }

  return {
    total: deliveries.length,
    pending, approved, inWarehouse, outForDelivery, delivered, canceled, overdue,
    totalPallets: Math.round(totalPallets),
    totalMiles: Math.round(totalMiles * 10) / 10,
    totalFees: Math.round(totalFees * 100) / 100,
    onTimePct: onTimeEligible ? Math.round((onTime / onTimeEligible) * 100) : null,
  };
}

export interface StageCount { stage: Stage; count: number; }
export function countByStage(deliveries: Delivery[], stages: Stage[]): StageCount[] {
  return stages.map((stage) => ({ stage, count: deliveries.filter((d) => d.stage === stage).length }));
}

export interface DriverStat {
  driver: string;
  total: number;
  delivered: number;
  active: number;
  pallets: number;
  miles: number;
}

/** Per-driver workload + throughput, sorted by total orders desc. */
export function driverStats(deliveries: Delivery[]): DriverStat[] {
  const map = new Map<string, DriverStat>();
  for (const d of deliveries) {
    if (!d.assigned_driver) continue;
    const s = map.get(d.assigned_driver) ?? { driver: d.assigned_driver, total: 0, delivered: 0, active: 0, pallets: 0, miles: 0 };
    s.total++;
    if (d.stage === "delivered") s.delivered++;
    if (activeStages.includes(d.stage)) s.active++;
    s.pallets += Number(d.actual_pallets ?? d.est_pallets ?? 0);
    s.miles += Number(d.route_miles ?? 0);
    map.set(d.assigned_driver, s);
  }
  return [...map.values()]
    .map((s) => ({ ...s, pallets: Math.round(s.pallets), miles: Math.round(s.miles * 10) / 10 }))
    .sort((a, b) => b.total - a.total);
}

// When an order was promised by (delivery_date + window end, or end of day). ms.
/**
 * When an order was promised by: its delivery date plus the end of its window, or end of day.
 *
 * DELIBERATE DIVERGENCE FROM THE SOURCE (ADR 0010). The original built this with
 * `new Date(date + "T00:00:00")`, which parses in the RUNTIME's timezone. That made the promised
 * moment depend on where the code ran: the same delivery was on time on a Central-time laptop and
 * late in production, which runs UTC on Vercel — so an 08:30-12:00 window was being measured against
 * 12:00 UTC, i.e. 07:00 Central. Deliveries completed inside their actual window were recorded as
 * late, and the on-time percentage was understated for every order with a window.
 *
 * The promise is a wall-clock time in Texas, so it is built as one. This is the one place the port
 * intentionally does NOT match the source; everything else in this file is byte-identical.
 */
function promisedDue(d: Delivery): number | null {
  if (!d.delivery_date) return null;
  const win = parseWindow(d.delivery_windows);
  const endMin = win ? win[1] : 24 * 60 - 1;
  return businessTimeMs(d.delivery_date, endMin);
}
// When it was actually delivered — the POD timestamp, else the last update. ms.
function deliveredAtMs(d: Delivery): number | null {
  const t = d.pod_delivered_at ?? (d.stage === "delivered" ? d.updated_at : null);
  return t ? new Date(t).getTime() : null;
}

export interface TrendPoint {
  label: string;             // short bucket label, e.g. "8/3"
  delivered: number;         // deliveries completed in the bucket
  onTimePct: number | null;  // on-time rate in the bucket
  avgCsat: number | null;    // avg rating in the bucket
}

/** Time series of delivery volume / on-time / rating over [from, to],
 * bucketed daily for short ranges and into ≤maxPoints week-ish chunks for long
 * ones. Buckets by each order's delivery date (fallback input/created). */
export function deliveryTrend(deliveries: Delivery[], from: string, to: string, maxPoints = 12): TrendPoint[] {
  const dayMs = 86_400_000;
  const start = Date.parse(from + "T00:00:00");
  const end = Date.parse(to + "T00:00:00");
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const days = Math.round((end - start) / dayMs) + 1;
  const bucketDays = days <= 21 ? 1 : Math.ceil(days / maxPoints);
  const nBuckets = Math.ceil(days / bucketDays);
  interface B { delivered: number; onElig: number; onTime: number; csatSum: number; csatN: number; }
  const buckets: B[] = Array.from({ length: nBuckets }, () => ({ delivered: 0, onElig: 0, onTime: 0, csatSum: 0, csatN: 0 }));
  for (const d of deliveries) {
    if (d.stage !== "delivered") continue;
    const dayStr = d.delivery_date || d.input_date || d.created_at.slice(0, 10);
    const dTime = Date.parse(dayStr + "T00:00:00");
    if (Number.isNaN(dTime) || dTime < start || dTime > end) continue;
    const idx = Math.min(nBuckets - 1, Math.floor((dTime - start) / (bucketDays * dayMs)));
    const b = buckets[idx];
    b.delivered++;
    const due = promisedDue(d), done = deliveredAtMs(d);
    if (due != null && done != null) { b.onElig++; if (done <= due) b.onTime++; }
    if (d.csat_rating != null) { b.csatSum += Number(d.csat_rating); b.csatN++; }
  }
  return buckets.map((b, i) => {
    const bStart = new Date(start + i * bucketDays * dayMs);
    return {
      label: `${bStart.getMonth() + 1}/${bStart.getDate()}`,
      delivered: b.delivered,
      onTimePct: b.onElig ? Math.round((b.onTime / b.onElig) * 100) : null,
      avgCsat: b.csatN ? Math.round((b.csatSum / b.csatN) * 10) / 10 : null,
    };
  });
}

export interface DriverKpi {
  driver: string;
  orders: number;
  delivered: number;
  routes: number;            // distinct delivery days worked
  avgStops: number;          // orders ÷ routes
  miles: number;
  avgRouteMiles: number;     // miles ÷ routes
  revenue: number;           // delivery fees on their orders
  revPerMile: number | null;
  onTimePct: number | null;  // delivered on/before the promised time
  avgDelayMin: number | null;// avg minutes past promised across delivered (0 if on time)
  pallets: number;
  utilizationPct: number | null; // avg pallets/day ÷ capacity
  fuelCost: number | null;       // miles ÷ mpg × fuel price
  costPerDelivery: number | null;// (fuel + flat overhead × orders) ÷ orders
  avgCsat: number | null;        // avg 1–5 rating across rated deliveries
  csatCount: number;
}

/** Company cost model — the pieces the fuel/cost KPIs derive from. */
export interface CostModel { fuelPrice?: number | null; mpg?: number | null; base?: number | null; }

/** Rich per-driver KPIs (Epic D). Cancelled/rejected orders are excluded.
 * capacityOf gives each driver's per-day pallet capacity; cost (optional)
 * drives the fuel-cost / cost-per-delivery figures. */
export function driverKpis(deliveries: Delivery[], capacityOf: (driver: string) => number, cost?: CostModel): DriverKpi[] {
  interface Acc {
    orders: number; delivered: number; days: Set<string>; miles: number; revenue: number;
    onTimeElig: number; onTime: number; delaySum: number; delayCount: number; pallets: number;
    csatSum: number; csatCount: number;
  }
  const map = new Map<string, Acc>();
  for (const d of deliveries) {
    if (!d.assigned_driver) continue;
    if (d.stage === "canceled" || d.stage === "rejected") continue;
    const a = map.get(d.assigned_driver) ?? { orders: 0, delivered: 0, days: new Set<string>(), miles: 0, revenue: 0, onTimeElig: 0, onTime: 0, delaySum: 0, delayCount: 0, pallets: 0, csatSum: 0, csatCount: 0 };
    a.orders++;
    if (d.delivery_date) a.days.add(d.delivery_date);
    a.miles += Number(d.route_miles ?? 0);
    a.revenue += Number(d.delivery_fee ?? 0);
    a.pallets += Number(d.actual_pallets ?? d.est_pallets ?? 0);
    if (d.stage === "delivered") {
      a.delivered++;
      const due = promisedDue(d);
      const done = deliveredAtMs(d);
      if (due != null && done != null) {
        a.onTimeElig++;
        if (done <= due) a.onTime++;
        a.delaySum += Math.max(0, done - due);
        a.delayCount++;
      }
      if (d.csat_rating != null) { a.csatSum += Number(d.csat_rating); a.csatCount++; }
    }
    map.set(d.assigned_driver, a);
  }
  const fuelReady = cost?.fuelPrice != null && cost?.mpg != null && cost.mpg > 0;
  const base = cost?.base ?? null;
  return [...map.entries()]
    .map(([driver, a]) => {
      const routes = a.days.size || 1;
      const cap = capacityOf(driver) || 0;
      const avgPerDay = a.pallets / routes;
      const fuelCost = fuelReady ? Math.round((a.miles / (cost!.mpg as number)) * (cost!.fuelPrice as number) * 100) / 100 : null;
      const costTotal = (fuelCost ?? 0) + (base ?? 0) * a.orders;
      const costPerDelivery = a.orders > 0 && (fuelCost != null || base != null) ? Math.round((costTotal / a.orders) * 100) / 100 : null;
      return {
        driver,
        orders: a.orders,
        delivered: a.delivered,
        routes: a.days.size,
        avgStops: Math.round((a.orders / routes) * 10) / 10,
        miles: Math.round(a.miles * 10) / 10,
        avgRouteMiles: Math.round((a.miles / routes) * 10) / 10,
        revenue: Math.round(a.revenue * 100) / 100,
        revPerMile: a.miles > 0 ? Math.round((a.revenue / a.miles) * 100) / 100 : null,
        onTimePct: a.onTimeElig ? Math.round((a.onTime / a.onTimeElig) * 100) : null,
        avgDelayMin: a.delayCount ? Math.round(a.delaySum / a.delayCount / 60_000) : null,
        pallets: Math.round(a.pallets),
        utilizationPct: cap ? Math.round((avgPerDay / cap) * 100) : null,
        fuelCost,
        costPerDelivery,
        avgCsat: a.csatCount ? Math.round((a.csatSum / a.csatCount) * 10) / 10 : null,
        csatCount: a.csatCount,
      };
    })
    .sort((x, y) => y.orders - x.orders);
}

export interface DriverShiftKpi {
  driver: string;                 // driver's name
  onClockMin: number;             // total minutes clocked in
  activeMin: number;              // minutes actively working a delivery (departure/pickup → delivered)
  idleMin: number;                // on-clock minus active, floored at 0
  activePct: number | null;       // active ÷ on-clock
  delivered: number;              // deliveries completed in the window
  perActiveHr: number | null;     // deliveries ÷ active hours (throughput)
  open: boolean;                  // currently on the clock
}

/** Per-driver idle-time KPIs. On-clock time comes from the shift clock;
 * active time is the sum of pickup→delivered spans on their orders. `nameOf`
 * resolves a shift's driver_id to the name used on deliveries.assigned_driver.
 * Pass already date-scoped shifts + deliveries to scope the window. */
export function driverShiftKpis(
  shifts: DriverShift[],
  deliveries: Delivery[],
  nameOf: (driverId: string) => string | undefined,
  now: number = Date.now(),
): DriverShiftKpi[] {
  // On-clock time per driver name (open shifts count up to `now`).
  const clock = new Map<string, { onClock: number; open: boolean }>();
  for (const s of shifts) {
    const name = nameOf(s.driver_id);
    if (!name) continue;
    const start = new Date(s.started_at).getTime();
    const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
    if (!Number.isFinite(start) || end <= start) continue;
    const c = clock.get(name) ?? { onClock: 0, open: false };
    c.onClock += end - start;
    if (!s.ended_at) c.open = true;
    clock.set(name, c);
  }
  // Active (working) time on each delivered order: from when the driver set off
  // toward the pickup (departed_at) — or, failing that, the pickup stamp — up to
  // delivery. Using departed_at counts the drive-to-pickup leg as work.
  const active = new Map<string, number>();
  const delivered = new Map<string, number>();
  for (const d of deliveries) {
    if (!d.assigned_driver || !d.pod_delivered_at) continue;
    delivered.set(d.assigned_driver, (delivered.get(d.assigned_driver) ?? 0) + 1);
    const start = d.departed_at ?? d.pickup_gps_at;
    if (!start) continue;
    const span = new Date(d.pod_delivered_at).getTime() - new Date(start).getTime();
    if (span > 0) active.set(d.assigned_driver, (active.get(d.assigned_driver) ?? 0) + span);
  }
  const names = new Set<string>([...clock.keys(), ...active.keys()]);
  return [...names]
    .map((driver) => {
      const onClock = clock.get(driver)?.onClock ?? 0;
      // Active can't exceed on-clock (some work may predate a clock-in).
      const act = onClock > 0 ? Math.min(active.get(driver) ?? 0, onClock) : (active.get(driver) ?? 0);
      const idle = Math.max(0, onClock - act);
      const activeMin = Math.round(act / 60_000);
      const del = delivered.get(driver) ?? 0;
      return {
        driver,
        onClockMin: Math.round(onClock / 60_000),
        activeMin,
        idleMin: Math.round(idle / 60_000),
        activePct: onClock > 0 ? Math.round((act / onClock) * 100) : null,
        delivered: del,
        perActiveHr: activeMin > 0 ? Math.round((del / (activeMin / 60)) * 10) / 10 : null,
        open: clock.get(driver)?.open ?? false,
      };
    })
    .sort((a, b) => b.onClockMin - a.onClockMin);
}

export interface DriverQualityKpi {
  driver: string;
  orders: number;                     // active (non-cancelled) orders
  delivered: number;
  avgDriveToPickupMin: number | null; // departed → pickup
  avgTransitMin: number | null;       // pickup → delivered
  avgDwellMin: number | null;         // arrived → delivered (service time at the stop)
  redeliveries: number;               // orders that are a redelivery of a failed attempt
  redeliveryPct: number | null;       // redeliveries ÷ orders
  podCompliancePct: number | null;    // delivered with a signature or photo ÷ delivered
  csatResponsePct: number | null;     // delivered that got rated ÷ delivered
  shortLoads: number;                 // loaded fewer pallets than ordered
  podGpsChecked: number;              // delivered with both POD GPS + geocoded destination
  podGpsFar: number;                  // of those, stamped beyond the tolerance from the destination
}

/** Per-driver timing + quality KPIs (Tier 1). Cancelled/rejected excluded.
 * Timing averages only count orders that carry the needed stamps. */
export function driverQualityKpis(deliveries: Delivery[]): DriverQualityKpi[] {
  interface Acc {
    orders: number; delivered: number;
    driveSum: number; driveN: number;
    transitSum: number; transitN: number;
    dwellSum: number; dwellN: number;
    redeliveries: number; podOk: number; rated: number; shortLoads: number;
    podGpsChecked: number; podGpsFar: number;
  }
  const zero = (): Acc => ({ orders: 0, delivered: 0, driveSum: 0, driveN: 0, transitSum: 0, transitN: 0, dwellSum: 0, dwellN: 0, redeliveries: 0, podOk: 0, rated: 0, shortLoads: 0, podGpsChecked: 0, podGpsFar: 0 });
  const span = (from: string | null | undefined, to: string | null | undefined) => (from && to ? new Date(to).getTime() - new Date(from).getTime() : NaN);
  const map = new Map<string, Acc>();
  for (const d of deliveries) {
    if (!d.assigned_driver) continue;
    if (d.stage === "canceled" || d.stage === "rejected") continue;
    const a = map.get(d.assigned_driver) ?? zero();
    a.orders++;
    if (d.redelivery_of) a.redeliveries++;
    if (d.actual_pallets != null && d.est_pallets != null && d.actual_pallets < d.est_pallets) a.shortLoads++;
    const drive = span(d.departed_at, d.pickup_gps_at);
    if (drive > 0) { a.driveSum += drive; a.driveN++; }
    if (d.stage === "delivered") {
      a.delivered++;
      const transit = span(d.pickup_gps_at, d.pod_delivered_at);
      if (transit > 0) { a.transitSum += transit; a.transitN++; }
      const dwell = span(d.arrived_at, d.pod_delivered_at);
      if (dwell > 0) { a.dwellSum += dwell; a.dwellN++; }
      if (d.pod_signature || (d.photos?.length ?? 0) > 0) a.podOk++;
      if (d.csat_rating != null) a.rated++;
      // POD GPS accuracy: compare where the driver stamped delivery to the
      // geocoded destination, when both are known.
      if (d.pod_lat != null && d.pod_lng != null && d.delivery_lat != null && d.delivery_lng != null) {
        a.podGpsChecked++;
        const m = distanceMeters({ lat: d.pod_lat, lng: d.pod_lng }, { lat: d.delivery_lat, lng: d.delivery_lng });
        if (m > POD_GPS_TOLERANCE_M) a.podGpsFar++;
      }
    }
    map.set(d.assigned_driver, a);
  }
  const avgMin = (sum: number, n: number) => (n ? Math.round(sum / n / 60_000) : null);
  return [...map.entries()]
    .map(([driver, a]) => ({
      driver,
      orders: a.orders,
      delivered: a.delivered,
      avgDriveToPickupMin: avgMin(a.driveSum, a.driveN),
      avgTransitMin: avgMin(a.transitSum, a.transitN),
      avgDwellMin: avgMin(a.dwellSum, a.dwellN),
      redeliveries: a.redeliveries,
      redeliveryPct: a.orders ? Math.round((a.redeliveries / a.orders) * 100) : null,
      podCompliancePct: a.delivered ? Math.round((a.podOk / a.delivered) * 100) : null,
      csatResponsePct: a.delivered ? Math.round((a.rated / a.delivered) * 100) : null,
      shortLoads: a.shortLoads,
      podGpsChecked: a.podGpsChecked,
      podGpsFar: a.podGpsFar,
    }))
    .sort((x, y) => y.orders - x.orders);
}

export interface GroupStat { key: string; total: number; delivered: number; pallets: number; }

/** Volume grouped by an arbitrary string field (store / account). */
export function groupVolume(deliveries: Delivery[], field: "store" | "account"): GroupStat[] {
  const map = new Map<string, GroupStat>();
  for (const d of deliveries) {
    const key = (d[field] || "").trim() || "—";
    const s = map.get(key) ?? { key, total: 0, delivered: 0, pallets: 0 };
    s.total++;
    if (d.stage === "delivered") s.delivered++;
    s.pallets += Number(d.actual_pallets ?? d.est_pallets ?? 0);
    map.set(key, s);
  }
  return [...map.values()]
    .map((s) => ({ ...s, pallets: Math.round(s.pallets) }))
    .sort((a, b) => b.total - a.total);
}

/** Average approval turnaround (pending → approved) in ms, from the event log. */
export function approvalTurnaroundMs(deliveries: Delivery[], events: OrderEvent[]): { avgMs: number | null; count: number } {
  let sum = 0, count = 0;
  const byDelivery = new Map<string, OrderEvent[]>();
  for (const e of events) {
    const key = e.delivery_id ?? "";
    (byDelivery.get(key) ?? byDelivery.set(key, []).get(key)!).push(e);
  }
  for (const d of deliveries) {
    if (!d.approved_at) continue;
    const evs = byDelivery.get(d.id ?? "") ?? [];
    // Earliest moment the order entered "pending".
    const pendingEv = evs.filter((e) => e.kind === "pending").sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))[0];
    const start = pendingEv ? new Date(pendingEv.created_at).getTime() : new Date(d.created_at).getTime();
    const end = new Date(d.approved_at).getTime();
    if (end > start) { sum += end - start; count++; }
  }
  return { avgMs: count ? Math.round(sum / count) : null, count };
}

/** Orders whose delivery date has passed but that aren't delivered/canceled. */
export function overdueOrders(deliveries: Delivery[], now: Date = new Date()): Delivery[] {
  return deliveries
    .filter((d) => isOverdue(d, now))
    .sort((a, b) => (a.delivery_date || "").localeCompare(b.delivery_date || ""));
}

/** Filter deliveries to those whose delivery_date (fallback input_date) falls in [from, to] inclusive. */
export function inDateRange(deliveries: Delivery[], from: string, to: string): Delivery[] {
  return deliveries.filter((d) => {
    const day = d.delivery_date || d.input_date || d.created_at.slice(0, 10);
    return day >= from && day <= to;
  });
}

export interface SalesRepStat { rep: string; deliveries: number; chargedTotal: number; avgPerDelivery: number; }

/** Per sales-rep stats for the current calendar month (by when they logged
 * the order, i.e. created_at) — deliveries count, total delivery fees
 * charged, and the average fee per delivery. */
export function salesRepStatsThisMonth(deliveries: Delivery[], users: Profile[]): SalesRepStat[] {
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const nameById = new Map(users.map((u) => [u.id, u.full_name]));
  const map = new Map<string, { deliveries: number; chargedTotal: number }>();
  for (const d of deliveries) {
    const owner = orderOwner(d);
    if (!owner || !d.created_at.startsWith(monthPrefix)) continue;
    const rep = nameById.get(owner) ?? "—";
    const s = map.get(rep) ?? { deliveries: 0, chargedTotal: 0 };
    s.deliveries++;
    s.chargedTotal += Number(d.delivery_fee ?? 0);
    map.set(rep, s);
  }
  return [...map.entries()]
    .map(([rep, s]) => ({
      rep,
      deliveries: s.deliveries,
      chargedTotal: Math.round(s.chargedTotal * 100) / 100,
      avgPerDelivery: s.deliveries ? Math.round((s.chargedTotal / s.deliveries) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.chargedTotal - a.chargedTotal);
}

export interface OnTimeCoverage {
  /** Delivered orders that could be measured at all (they have a delivery date). */
  measurable: number;
  /** Of those, how many carry a real proof-of-delivery timestamp. */
  withProof: number;
  /** withProof / measurable, 0-100, or null when there is nothing to measure. */
  pct: number | null;
}

/**
 * How much of the on-time figure is actually evidence.
 *
 * deliveredAtMs() falls back to `updated_at` when an order has no `pod_delivered_at` — whenever the
 * row was last touched. For an order closed in bulk during a backlog import that is long after the
 * real delivery, so its "on time" answer is not about the delivery at all; it is about when somebody
 * last edited the record.
 *
 * Measured on the live data at the time of writing: 9 of 52 delivered orders had a real POD stamp.
 * The other 43 were being scored on an edit timestamp, which is why the on-time rate read at roughly
 * 6% rather than anything believable.
 *
 * This does not fix that — the missing timestamps are a capture problem out on the road, not a
 * calculation one — but a percentage shown without its coverage invites a decision the data cannot
 * support. Show both.
 */
export function onTimeCoverage(deliveries: Delivery[]): OnTimeCoverage {
  let measurable = 0;
  let withProof = 0;
  for (const d of deliveries) {
    if (d.stage !== "delivered" || !d.delivery_date) continue;
    measurable++;
    if (d.pod_delivered_at) withProof++;
  }
  return {
    measurable,
    withProof,
    pct: measurable ? Math.round((withProof / measurable) * 100) : null,
  };
}
