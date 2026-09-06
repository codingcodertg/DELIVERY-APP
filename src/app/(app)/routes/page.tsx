"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { canPlanRoutes, stageInfo, stageLabel } from "@/lib/constants";
import { autoAssign, parseWindow, splitIntoTrips, unavailableDriverNames } from "@/lib/dispatch";
import { MapView, type MapLine, type MapPoint } from "@/components/MapView";
import { OrderModal } from "@/components/OrderModalLazy";
import { DispatchBoard, type BoardColumn } from "@/components/DispatchBoard";
import { GanttTimeline, type GanttRow } from "@/components/GanttTimeline";
import { printRouteManifest } from "@/lib/manifest";
import { fallbackDriverColor, fmtDate, fmtMoney, fmtWindows, isOverdue, orderLabel, shiftDateISO, todayISO } from "@/lib/utils";
import { serviceMin, tripTiming, dayMinutes, RELOAD_MIN } from "@/lib/trip-timing";
import { buildGeoLoads, fillByCapacity, planCostMi } from "@/lib/route-batching";
import { driverOf, groupIntoLoads, hasManualLoads, loadNoOf, nextLoadFor as nextLoadForPure, orderLaneKey as orderLaneKeyPure, planMerge } from "@/lib/route-lanes";
import { useColWidths } from "@/lib/use-col-widths";
import { liveDriverNames, trackingGaps } from "@/lib/tracking-health";
import { useAutoGeocode } from "@/lib/useAutoGeocode";
import { useStoreMarkers } from "@/lib/useStoreMarkers";
import type { Delivery, DriverIncident, Profile } from "@/lib/types";

// ============================================================
// Logistics Manager tool: assign the day's approved-but-undelivered orders
// to a driver, then let the system work out the best visiting order for
// that driver's stops (a real routing solve via OSRM, not just a guess).
//
// Scope is deliberately just sequencing, not auto-assignment — a person
// still decides which driver takes which order; the system only decides
// the best order to run them in once that's settled.
//
// Each driver's truck has a pallet capacity. When their assigned stops add
// up to more than it can carry in one load, the route is split into
// several round trips — out to a batch of stops, back to the driver's home
// store to reload, out again — rather than one trip that assumes an
// infinitely large truck.
//
// The page is driven by a driver switcher: pick one driver to see just
// their pins, routes and truckloads (or "All" for the whole day at once).
// With a driver selected, adding an order first SIMULATES the resulting
// route (dashed trace + totals) and asks to confirm before assigning.
// ============================================================

const UNASSIGNED_COLOR = "#6b7686";
// Distinct colors for multiple selected unassigned loads (route + pin).
const SEL_PALETTE = ["#2456c9", "#0f8a8a", "#d1782e", "#7c4dbc", "#1f9d61", "#d64545", "#e9a13b"];
// Orders that can be scheduled/assigned here. Logistics can plan ANY order that
// isn't already out the door (picked_up/delivered) or off the board
// (rejected/canceled) — so an order still in draft/pending, not yet approved or
// prepared, can be dropped onto a route ahead of time. The warehouse still has
// to get it ready before it actually ships; this just lets dispatch pre-plan it.
// Drafts are excluded: a draft hasn't been submitted, so it isn't an order yet
// — planning a truck around one is planning around something nobody has
// committed to. Pending and unprepared orders DO belong here, which was the
// actual point of D-004: dispatch shouldn't have to wait for the warehouse.
const ROUTE_STAGES: Delivery["stage"][] = ["pending", "approved", "fulfilling", "ready"];
// Used whenever a driver has no capacity set yet in Settings.
const DEFAULT_CAPACITY = 12;

// The day's routes are timed from this clock, with a reload buffer added at
// the pickup between truckloads. Service (unload) time per stop comes from
// the order's own delivery_duration.
const DAY_START_MIN = 8 * 60; // 08:00

function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}

function fmtClock(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function hexToHsl(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16) / 255, g = parseInt(c.slice(2, 4), 16) / 255, b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hx = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

// Truckload 1 keeps the driver's own color; later truckloads rotate the HUE
// far away (not a lighter shade), so each loop is an unmistakably different
// color from the driver's and from each other.
const HUE_OFFSETS = [150, 60, 240, 300, 120, 30, 210];

/** A distinctly different color per truckload. */
function tripColor(base: string, index: number): string {
  if (index === 0) return base;
  const [h, s] = hexToHsl(base);
  return hslToHex(h + HUE_OFFSETS[(index - 1) % HUE_OFFSETS.length], Math.max(0.6, s), 0.45);
}

/** One truckload's traced path, split so the delivery run and the empty
 * drive back to the pickup can be styled differently (solid vs dashed). */
interface TripTrace {
  delivery: [number, number][];
  ret: [number, number][];
}

/** What one truckload actually costs. Wheel time alone understates the day:
 * a load of six stops spends over an hour standing still being unloaded, and
 * that time is already programmed per order (delivery_duration). */
interface TripStat {
  miles: number;
  /** Time behind the wheel, pickup out and back. */
  driveMin: number;
  /** Time parked, unloading — the sum of this load's stop durations. */
  serviceMin: number;
  /** driveMin + serviceMin: the truck is busy this long. */
  totalMin: number;
  stops: number;
  /** Leaves the pickup / back at the pickup, "HH:MM". */
  start: string;
  end: string;
}

/** A fully-solved (but not yet saved) plan for one driver's day. */
interface RoutePlan {
  orderedIds: string[];
  miles: number;
  seconds: number;
  traces: TripTrace[];
  trips: number;
  /** Per-truckload breakdown, in the order the loads go out. */
  tripStats: TripStat[];
  /** Stop ids per truckload, so the grouping the batcher chose can be saved.
   * null = the loads were a person's doing and were left untouched. */
  loadGroups: string[][] | null;
  /** Straight-line miles the regrouping saved vs. the old capacity fill.
   * 0 when nothing was regrouped. */
  regroupSavedMi: number;
  /** Whole day: driving + unloading + reloading between truckloads. */
  dayMinutes: number;
  /** Estimated arrival time per stop id, "HH:MM". */
  etas: Record<string, string>;
}

export default function RoutesPage() {
  const { me, users, deliveries, settings, saveSettings, updateDelivery, reorderStops, addNote, notify, availability, ready, incidents, addIncident, removeIncident, driverLocations, shifts } = useData();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const [date, setDate] = useState(todayISO());
  // "All dates" ignores the date filter so every routable order (and the routes
  // built on them) shows regardless of delivery date — handy when a route was
  // built for another day and seems to have vanished.
  const [allDates, setAllDates] = useState(false);
  // Layout: full-width route cards (see all info) and a collapsible map/driver
  // panel so the route detail can use the whole screen.
  const [wideRoutes, setWideRoutes] = useState(true);
  const [showTop, setShowTop] = useState(true);
  // Stops table Address on a single line; a toggle expands it when the full
  // address is needed. Kept narrow by default so Windows + the row-action
  // arrows never get pushed off the right edge.
  const [addrWide, setAddrWide] = useState(false);
  // Excel-style resizable columns, remembered per table. Tighter defaults (and
  // bumped keys, so they replace older wide ones) so the route + truckload
  // tables fit the screen without horizontal scrolling. Columns are still
  // draggable from here.
  const schedCols = useColWidths("rtg_routes_sched3", [72, 140, 140, 52, 52, 100, 60, 44]);
  const poolCols = useColWidths("rtg_routes_pool3", [28, 70, 128, 92, 60, 100, 92, 88, 116]);
  // [#, ID, Account, Address(expanded), ETA, Windows, actions]. Address is
  // forced to 92px when collapsed; everything else is sized to show its value
  // in full so Windows and the ↑↓ action arrows never get clipped.
  const stopCols = useColWidths("rtg_routes_stops7", [40, 96, 140, 70, 240, 56, 110, 150]);
  // Which drivers are highlighted on the map / focused in the tables. Empty
  // set = "no drivers selected" → everything shown at full strength (like
  // OptimoRoute). Selecting some highlights them and dims the rest.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"routes" | "orders" | "board" | "timeline" | "scheduled" | "incidents">("routes");
  const [busyDriver, setBusyDriver] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<Record<string, { miles: number; duration_text: string; trips: number; minutes: number; dayMinutes: number; dayText: string }>>({});
  // Per-truckload numbers, keyed by driver then load index.
  const [routeTrips, setRouteTrips] = useState<Record<string, TripStat[]>>({});
  const [routeLines, setRouteLines] = useState<Record<string, TripTrace[]>>({});
  const [routeEtas, setRouteEtas] = useState<Record<string, Record<string, string>>>({});
  const [depotCoords, setDepotCoords] = useState<Record<string, [number, number]>>({});
  // A simulated "what if we add this order to this driver" plan, shown as a
  // dashed trace + totals until it's either confirmed (saved) or dismissed.
  const [preview, setPreview] = useState<{ orderId: string; code: string; driver: string; plan: RoutePlan } | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const [optimizingAll, setOptimizingAll] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  // Multi-select + search + saved filter for the unassigned pool.
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  // Drag-and-drop in the Routes tab: which order is being dragged, and which
  // lane card is currently under the cursor (for the drop highlight).
  // (Row drag-and-drop was removed from the Routes tab — stops are reordered
  // with the ↑/↓ arrows, and orders are assigned from the "Assign to…" picker.)
  const [orderSearch, setOrderSearch] = useState("");
  const [poolFilter, setPoolFilter] = useState<"all" | "overdue" | "noloc" | "windowed">("all");
  // Cached pickup→dropoff geometry for selected unassigned loads (drawn on the map).
  const [selRouteCache, setSelRouteCache] = useState<Record<string, [number, number][]>>({});
  // Geocoded pickup coords per selected load — lets us show a pickup "P" pin and
  // a straight PU→DEL line immediately, before (or if) the road geometry loads.
  const [selPickup, setSelPickup] = useState<Record<string, [number, number]>>({});
  const [err, setErr] = useState<string | null>(null);
  // Which router actually answered last — so the page can say whether the
  // mileage/ETAs account for traffic (Google) or are free-flow (OSRM fallback).
  const lastProviderRef = useRef<{ provider: string; traffic: boolean } | null>(null);
  const [routerInfo, setRouterInfo] = useState<{ provider: string; traffic: boolean } | null>(null);
  // Which panels are collapsed — the unassigned pool ("__unassigned__") and
  // each driver (by name), so a busy board can be folded down to just the
  // one being worked on.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const isCollapsed = (id: string) => collapsed.has(id);
  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // A newly-viewed date invalidates any optimize summary/trace from before.
  useEffect(() => { setRouteInfo({}); setRouteTrips({}); setRouteLines({}); setRouteEtas({}); setPreview(null); setErr(null); }, [date]);
  // Changing the driver selection drops any half-finished simulation.
  useEffect(() => { setPreview(null); }, [selected]);

  const focusOnly = (name: string) => setSelected(new Set([name]));
  const toggleDriver = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  // Viewing today also carries forward anything overdue that never went out AND
  // anything not yet dated — an order that has no delivery date can't belong to
  // any specific day, so it would otherwise be invisible until someone dated it.
  // Logistics needs to see both to actually dispatch/plan them, not just what's
  // newly due today. Browsing another date (planning ahead) shows only that date.
  const viewingToday = date === todayISO();
  const dayOrders = useMemo(
    () =>
      deliveries.filter((d) => {
        if (!ROUTE_STAGES.includes(d.stage)) return false;
        if (allDates) return true;               // ignore the date filter entirely
        if (d.delivery_date === date) return true;
        return viewingToday && (isOverdue(d) || !d.delivery_date);
      }),
    [deliveries, date, viewingToday, allDates],
  );

  // The one thing logistics can change on a carried-forward order: push its
  // delivery date up to today, or leave it — either way it's on this list.
  const reschedule = (id: string, delivery_date: string) => updateDelivery(id, { delivery_date });

  const geocoding = useAutoGeocode(dayOrders, updateDelivery);
  // Every store as a big red landmark point, always shown on the route map.
  const storeMarkers = useStoreMarkers(settings.stores);

  // On-shift drivers whose phone has gone quiet. Recomputed on a timer so the
  // warning appears as the gap opens, not only when something else rerenders.
  const [healthTick, setHealthTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHealthTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const trackingIssues = useMemo(
    () => trackingGaps(users, shifts, driverLocations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, shifts, driverLocations, healthTick],
  );
  // Drivers on shift AND reporting — drives the LIVE tag. Recomputed on the
  // same minute tick so the tag clears by itself when a phone goes quiet, not
  // only when a new position happens to arrive.
  const liveNames = useMemo(
    () => liveDriverNames(users, shifts, driverLocations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, shifts, driverLocations, healthTick],
  );
  // Set by tapping a driver's LIVE tag: frame the map on where they are right
  // now. Cleared as soon as anything else takes over the map, so it's a
  // one-shot "show me" rather than a mode to get stuck in.
  const [locateDriver, setLocateDriver] = useState<string | null>(null);
  useEffect(() => { setLocateDriver(null); }, [selected, selectedOrders]);
  // The order opened from a stop's ID — the dispatcher wants the order itself,
  // not just its pin.
  const [openOrder, setOpenOrder] = useState<Delivery | null>(null);

  // Where each driver's phone last reported from, so the dispatcher can see
  // the fleet against the routes they planned.
  const liveDrivers = useMemo(() => {
    const nameById = new Map(users.map((u) => [u.id, u.full_name]));
    return driverLocations.flatMap((loc) => {
      const name = nameById.get(loc.driver_id);
      if (!name) return [];
      const ageMin = (Date.now() - new Date(loc.recorded_at).getTime()) / 60000;
      if (ageMin > 60) return [];   // not live any more
      return [{
        driver: name, lat: loc.lat, lng: loc.lng,
        color: settings.driver_colors?.[name] || fallbackDriverColor(name),
        accuracy_m: loc.accuracy_m,
        ageMin,
        label: `🚚 ${name} · ${ageMin < 1 ? t("now", "ahora") : t(`${Math.round(ageMin)} min ago`, `hace ${Math.round(ageMin)} min`)}`,
      }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverLocations, users, settings.driver_colors]);

  const drivers = useMemo(() => users.filter((u) => u.role === "driver"), [users]);
  const realDriverNames = useMemo(() => new Set(drivers.map((d) => d.full_name)), [drivers]);
  const isRealDriver = (name: string) => realDriverNames.has(name);

  // "Route buckets" — build routes before a real driver exists. Each bucket is a
  // pseudo-driver (its name lives in assigned_driver) so the whole route/optimize
  // machinery works on it; later the route is handed to an actual driver.
  const bucketNames = useMemo(
    () => (settings.route_buckets ?? []).filter((n) => !drivers.some((d) => d.full_name === n)),
    [settings.route_buckets, drivers],
  );
  const isBucket = (name: string) => bucketNames.includes(name);

  // ---- Loads: a driver can run several routes in a day, each a separate
  // truckload/trip. A "lane" is one such load (or a route bucket). The pure
  // lane logic (keys, grouping, merge) lives in lib/route-lanes for testing;
  // these thin wrappers bind it to this page's `isBucket` / `dayOrders`. ----
  const orderLaneKey = (d: Delivery) => orderLaneKeyPure(d, isBucket);

  interface Lane { id: string; key: string; driver: string; load: number; label: string; isBucket: boolean; store: string | null; }
  // Lanes = each real driver's load(s) + each bucket, used everywhere we DISPLAY
  // or build routes. Auto-assign still uses `drivers` only.
  const lanes = useMemo<Lane[]>(() => {
    const out: Lane[] = [];
    const seen = new Set<string>();
    const add = (l: Lane) => { if (!seen.has(l.key)) { seen.add(l.key); out.push(l); } };
    // One lane / card per driver and per temp driver. Loads are truckload
    // sections INSIDE the card (see groupIntoLoads), not separate lanes.
    for (const dr of drivers) add({ id: dr.id, key: dr.full_name, driver: dr.full_name, load: 1, label: dr.full_name, isBucket: false, store: dr.store ?? null });
    for (const n of bucketNames) add({ id: `bucket:${n}`, key: n, driver: n, load: 1, label: n, isBucket: true, store: null });
    // Safety net: any assigned group in the day's orders that DIDN'T match a
    // current driver or temp driver still gets a lane — so its route always
    // shows and is counted (e.g. a retired temp driver, or a removed driver).
    for (const d of dayOrders) {
      const key = orderLaneKey(d);
      if (!key || seen.has(key)) continue;
      const bucket = isBucket(d.assigned_driver || "");
      add({ id: `orphan:${key}`, key, driver: key, load: 1, label: key, isBucket: bucket, store: null });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, dayOrders, bucketNames, t]);

  // The next free load number for a driver (1 if they have no work yet).
  const nextLoadFor = (driver: string) => nextLoadForPure(dayOrders, driver);
  // Highest truckload number a driver currently has (1 if none set).
  const maxLoadForDriver = (name: string) => {
    let m = 1;
    for (const d of dayOrders) if (d.assigned_driver === name) m = Math.max(m, loadNoOf(d));
    return m;
  };
  // Move one already-assigned stop to a different truckload/pickup of the same
  // driver (keeps the driver, changes the load number, resets its sequence).
  const moveStopToLoad = async (d: Delivery, load: number) => {
    const driver = d.assigned_driver;
    if (!driver) return;
    clearRouteFor(driver);
    const stops = byDriver.get(driver) ?? [];
    // If the lane is still auto-split by capacity (no manual load numbers yet),
    // first stamp every OTHER stop with the truckload it's currently shown in —
    // otherwise moving just this one flips the lane to manual grouping and the
    // rest collapse/reshuffle. This keeps every other stop exactly where it is.
    if (!hasManualLoads(stops)) {
      const trips = buildTrips(stops, capacityFor(driver));
      await Promise.all(trips.flatMap((batch, ti) =>
        batch.filter((s) => s.id !== d.id).map((s) => updateDelivery(s.id, { load_no: ti + 1 > 1 ? ti + 1 : null })),
      ));
    }
    // Hand-placed: from here on the optimizer reorders this lane but leaves the
    // grouping alone, so the dispatcher's call survives pressing Optimize.
    await updateDelivery(d.id, { load_no: load > 1 ? load : null, route_seq: null, load_auto: false });
    notify(t(`Moved to truckload ${load}`, `Movido al viaje ${load}`));
  };
  // Split a lane's stops into truckloads: by the dispatcher's manual load
  // numbers when set, otherwise automatically by truck capacity.
  const buildTrips = (stops: Delivery[], capacity: number): Delivery[][] =>
    hasManualLoads(stops) ? groupIntoLoads(stops) : splitIntoTrips(stops, capacity);
  // Clear all manual load numbers on a route so its stops collapse back into a
  // single truckload (capacity permitting).
  const combineLoads = async (laneKey: string) => {
    const stops = byDriver.get(laneKey) ?? [];
    // Also the way back: with no manual loads left, the next optimize is free
    // to regroup the lane by area from scratch.
    for (const d of stops) await updateDelivery(d.id, { load_no: null, route_seq: null, load_auto: false });
    clearRouteFor(laneKey);
    notify(t("Combined into one truckload", "Unido en un solo viaje"));
  };
  // Drop a lane's pinned truckloads and let the batcher regroup it by area.
  //
  // Needed because pinned loads are deliberately left alone by Optimize — so
  // without this, a lane whose loads were pinned once could never benefit from
  // area grouping again, and the Optimize button would look broken.
  const regroupByArea = async (laneKey: string) => {
    const stops = byDriver.get(laneKey) ?? [];
    if (!stops.length) return;
    setBusyDriver(laneKey);
    try {
      await Promise.all(stops.map((d) => updateDelivery(d.id, { load_no: null, route_seq: null, load_auto: false })));
      clearRouteFor(laneKey);
    } finally {
      setBusyDriver(null);
    }
    // Re-read: the stops carry fresh load numbers now, and batching reads them.
    await optimize(laneKey);
  };
  // Split a lane's stops evenly into two manual truckloads (first half → 1,
  // second half → 2), preserving the current order.
  const splitLoads = async (laneKey: string) => {
    const stops = [...(byDriver.get(laneKey) ?? [])]
      .sort((a, b) => (a.route_seq ?? 9e9) - (b.route_seq ?? 9e9) || a.order_no - b.order_no);
    if (stops.length < 2) return;
    const half = Math.ceil(stops.length / 2);
    await Promise.all(stops.map((d, i) => updateDelivery(d.id, { load_no: i < half ? null : 2, route_seq: null, load_auto: false })));
    clearRouteFor(laneKey);
    notify(t("Split into 2 truckloads", "Dividido en 2 viajes"));
  };
  // Friendly display name for a lane key.
  const laneLabel = (key: string) => lanes.find((l) => l.key === key)?.label ?? key;

  // Merge every checked lane's stops into ONE route (the first checked lane, in
  // panel order). The other lanes' orders take on the target's identity
  // (driver + load, or bucket); emptied buckets are removed and the sequence is
  // cleared so the combined route can be re-optimized as one.
  const mergeSelectedLanes = async () => {
    const plan = planMerge(lanes, selected, byDriver);
    if (!plan) return;
    for (const id of plan.moveIds) await updateDelivery(id, plan.patch);
    for (const b of plan.removeBuckets) removeBucket(b);
    clearRouteFor(plan.targetKey);
    setSelected(new Set([plan.targetKey]));
    notify(t(`Merged ${plan.moveIds.length} stop(s) into ${laneLabel(plan.targetKey)}`, `${plan.moveIds.length} parada(s) unidas en ${laneLabel(plan.targetKey)}`));
  };

  // Create a temp driver / route bucket. An optional custom name is used as-is
  // (de-duplicated); otherwise auto-names "Route N".
  const addBucket = (customName?: string): string => {
    const existing = settings.route_buckets ?? [];
    const taken = (nm: string) => existing.includes(nm) || drivers.some((d) => d.full_name === nm);
    let name = (customName ?? "").trim();
    if (name) {
      let base = name, k = 2;
      while (taken(name)) { name = `${base} ${k++}`; }
    } else {
      let n = 1;
      while (taken(`Route ${n}`)) n++;
      name = `Route ${n}`;
    }
    saveSettings({ route_buckets: [...existing, name] });
    notify(t(`Added ${name}`, `${name} agregada`));
    return name;
  };
  const removeBucket = (name: string) => {
    return saveSettings({ route_buckets: (settings.route_buckets ?? []).filter((b) => b !== name) });
  };
  // Rename a temp driver: move its orders onto the new name and update the list.
  const renameBucket = async (oldName: string) => {
    const nm = window.prompt(t("Rename temp driver:", "Renombrar chofer temp:"), oldName);
    if (nm === null) return;
    const newName = nm.trim();
    if (!newName || newName === oldName) return;
    if ((settings.route_buckets ?? []).includes(newName) || drivers.some((d) => d.full_name === newName)) {
      notify(t("That name is already taken.", "Ese nombre ya está en uso."));
      return;
    }
    for (const d of [...(byDriver.get(oldName) ?? [])]) await updateDelivery(d.id, { assigned_driver: newName });
    saveSettings({ route_buckets: (settings.route_buckets ?? []).map((b) => (b === oldName ? newName : b)) });
    notify(t(`Renamed to ${newName}`, `Renombrado a ${newName}`));
  };
  // Hand a whole bucket's route to a real driver as a distinct LOAD (keeping its
  // optimized sequence), then retire the bucket. If the driver already has
  // work, this becomes their next load — so one driver can carry several routes.
  const assignRouteToDriver = async (bucket: string, driver: string) => {
    if (!driver) return;
    const stops = byDriver.get(bucket) ?? [];
    const load = nextLoadFor(driver);
    for (const d of stops) {
      await updateDelivery(d.id, { assigned_driver: driver, load_no: load });
      addNote(d.id, `Route "${bucket}" assigned to ${driver} as load ${load}`);
    }
    removeBucket(bucket);
    notify(t(`Route "${bucket}" (${stops.length} stop(s)) → ${driver}, load ${load}`, `Ruta "${bucket}" (${stops.length} parada(s)) → ${driver}, carga ${load}`));
  };
  // Delete a whole route/load: unassign every stop (back to the pool) and, if
  // it was a bucket, retire it.
  const clearLane = async (laneKey: string) => {
    const stops = deliveries.filter((d) => (d.assigned_driver || "") === laneKey);
    // Confirm first — this sends every stop back to Unassigned (and removes the
    // route if it's a temp route).
    const ok = await confirmAction(
      t(`Clear ${laneLabel(laneKey)}? Its ${stops.length} order(s) go back to Unassigned.`,
        `¿Vaciar ${laneLabel(laneKey)}? Sus ${stops.length} orden(es) vuelven a Sin asignar.`),
      { danger: true, confirmLabel: t("Clear route", "Vaciar ruta") },
    );
    if (!ok) return;
    // Clear EVERY order on this lane across ALL dates, not just the day in view,
    // so a stop left on another date can't rebuild the route on reload. Await all
    // writes (and the bucket removal) so the cleared state is fully persisted.
    await Promise.all(stops.map((d) => updateDelivery(d.id, { assigned_driver: null, route_seq: null, load_no: null })));
    stops.forEach((d) => addNote(d.id, `Unassigned (was ${laneKey})`));
    if (isBucket(laneKey)) await removeBucket(laneKey);
    await Promise.all(stops.map((d) => updateDelivery(d.id, { assigned_driver: null, route_seq: null, load_no: null })));
    stops.forEach((d) => addNote(d.id, `Unassigned (was ${laneKey})`));
    if (isBucket(laneKey)) await removeBucket(laneKey);
    clearRouteFor(laneKey);
    notify(t(`Cleared ${stops.length} stop(s) from ${laneLabel(laneKey)}`, `${stops.length} parada(s) quitadas de ${laneLabel(laneKey)}`));
  };
  // Drivers on vacation/sick/maintenance for the selected day — excluded from auto-assign.
  const unavailableToday = useMemo(
    () => unavailableDriverNames(availability, new Map(users.map((u) => [u.id, u.full_name])), date),
    [availability, users, date],
  );
  const colorFor = (driver: string | null) => (driver ? settings.driver_colors?.[driver] || fallbackDriverColor(driver) : UNASSIGNED_COLOR);
  // A driver's own capacity, else the fleet-wide default, else the built-in.
  const capacityFor = (driver: string) => settings.driver_capacity?.[driver] ?? settings.default_truck_capacity ?? DEFAULT_CAPACITY;
  const setCapacity = (driver: string, capacity: number) => {
    clearRouteFor(driver);
    saveSettings({ driver_capacity: { ...(settings.driver_capacity ?? {}), [driver]: capacity } });
  };

  // A driver's route is a loop from the PICKUP point (where they load the
  // truck), out to the deliveries, and back to the pickup to reload for the
  // next truckload. The pickup is taken from the orders themselves (their
  // pickup_address / sold-from store), falling back to the driver's own
  // home store — whichever we can resolve.
  const pickupAddressFor = (laneKey: string): string | null => {
    const driver = driverOf(laneKey);
    const stops = byDriver.get(laneKey) ?? [];
    const counts = new Map<string, number>();
    for (const d of stops) {
      const a = (d.pickup_address || "").trim();
      if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [a, n] of counts) if (n > bestN) { best = a; bestN = n; }
    if (best) return best;
    // No pickup address on the orders — fall back to a sold-from store's
    // address, then the driver's assigned home store.
    for (const d of stops) {
      const addr = settings.stores.find((s) => s.name === d.store)?.address;
      if (addr) return addr;
    }
    const profile = users.find((u) => u.full_name === driver);
    return profile?.store ? (settings.stores.find((s) => s.name === profile.store)?.address ?? null) : null;
  };

  // Geocode (and cache, keyed by the address string) a pickup/depot address.
  const getDepotCoords = async (address: string | null): Promise<[number, number] | null> => {
    const key = (address ?? "").trim();
    if (!key) return null;
    if (depotCoords[key]) return depotCoords[key];
    try {
      const res = await fetch("/api/geocode-point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: key }),
      });
      if (!res.ok) return null;
      const point = await res.json();
      const coords: [number, number] = [point.lat, point.lng];
      setDepotCoords((p) => ({ ...p, [key]: coords }));
      return coords;
    } catch {
      return null;
    }
  };

  const unassigned = useMemo(
    () => dayOrders.filter((d) => !d.assigned_driver).sort((a, b) => a.order_no - b.order_no),
    [dayOrders],
  );
  // Every assigned order for the day, grouped view for the "Scheduled" list —
  // sorted by driver, then load, then optimized sequence.
  const scheduled = useMemo(
    () => dayOrders.filter((d) => !!d.assigned_driver).sort((a, b) =>
      (a.assigned_driver ?? "").localeCompare(b.assigned_driver ?? "") ||
      loadNoOf(a) - loadNoOf(b) ||
      (a.route_seq ?? 9999) - (b.route_seq ?? 9999) ||
      a.order_no - b.order_no),
    [dayOrders],
  );

  // Draw each selected unassigned load's pickup→dropoff route on the map
  // (throttled, cached), so pressing loads shows where they go.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const chosen = dayOrders.filter((d) => selectedOrders.has(d.id) && d.delivery_lat != null && d.delivery_lng != null);
      for (const d of chosen) {
        if (cancelled) return;
        const addr = (d.pickup_address || settings.stores.find((s) => s.name === d.store)?.address || d.store || "").trim();
        const pk = await getDepotCoords(addr);
        if (cancelled) return;
        if (!pk) continue;
        // Record the pickup point right away so the "P" pin + straight PU→DEL
        // line appear on selection, even while the road geometry is still loading.
        setSelPickup((p) => (p[d.id] && p[d.id][0] === pk[0] && p[d.id][1] === pk[1] ? p : { ...p, [d.id]: pk }));
        if (selRouteCache[d.id]) continue;
        try {
          const res = await fetch("/api/optimize-route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stops: [{ id: "p", lat: pk[0], lng: pk[1] }, { id: "d", lat: d.delivery_lat, lng: d.delivery_lng }], roundtrip: false }),
          });
          const b = await res.json();
          if (!cancelled && res.ok && Array.isArray(b.geometry) && b.geometry.length) {
            const positions = (b.geometry as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
            setSelRouteCache((p) => ({ ...p, [d.id]: positions }));
          }
        } catch { /* skip */ }
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrders, dayOrders]);

  // A distinct color per selected load (shared by its pickup pin + route),
  // whether the load is assigned or still in the pool.
  const selColorById = useMemo(() => {
    const m = new Map<string, string>();
    dayOrders.filter((d) => selectedOrders.has(d.id)).forEach((d, i) => m.set(d.id, SEL_PALETTE[i % SEL_PALETTE.length]));
    return m;
  }, [dayOrders, selectedOrders]);

  // How many of the selected loads are still in the pool — the bulk-assign
  // controls act on these only (a selected assigned load is just a map view).
  const poolSelectedCount = useMemo(
    () => unassigned.reduce((n, d) => n + (selectedOrders.has(d.id) ? 1 : 0), 0),
    [unassigned, selectedOrders],
  );

  // Search + saved filter over the unassigned pool.
  const unassignedShown = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return unassigned.filter((d) => {
      if (poolFilter === "overdue" && !isOverdue(d)) return false;
      if (poolFilter === "noloc" && d.delivery_lat != null) return false;
      if (poolFilter === "windowed" && !d.delivery_windows) return false;
      if (!q) return true;
      return (
        String(d.order_no).includes(q) ||
        (d.account || "").toLowerCase().includes(q) ||
        (d.delivery_address || "").toLowerCase().includes(q) ||
        (d.delivery_phone || "").toLowerCase().includes(q) ||
        (d.contact || "").toLowerCase().includes(q) ||
        (d.store || "").toLowerCase().includes(q)
      );
    });
  }, [unassigned, orderSearch, poolFilter]);

  // Each driver's stops for the day, in their current sequence (optimized
  // order first, unsequenced ones after — same rule as the Driver page).
  // Keyed by LANE (driver+load, or bucket), so each of a driver's loads is its
  // own optimizable route.
  const byDriver = useMemo(() => {
    const map = new Map<string, Delivery[]>();
    for (const d of dayOrders) {
      const key = orderLaneKey(d);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.route_seq != null && b.route_seq != null) return a.route_seq - b.route_seq;
        if (a.route_seq != null) return -1;
        if (b.route_seq != null) return 1;
        return a.order_no - b.order_no;
      });
    }
    return map;
  }, [dayOrders]);

  // Columns for the drag-and-drop board: the unassigned pool, then one per driver.
  const boardColumns: BoardColumn[] = useMemo(() => {
    const cols: BoardColumn[] = [
      { key: "__unassigned__", title: t("Unassigned", "Sin asignar"), color: UNASSIGNED_COLOR, orders: unassigned },
    ];
    for (const u of lanes) {
      const orders = byDriver.get(u.key) ?? [];
      const pallets = Math.round(orders.reduce((s, d) => s + Number(d.actual_pallets ?? d.est_pallets ?? 0), 0));
      cols.push({ key: u.key, title: u.label, color: colorFor(u.driver), orders, sub: `${pallets}/${capacityFor(u.driver)}` });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unassigned, lanes, byDriver, settings.driver_colors, settings.driver_capacity, lang]);

  // Print a driver's route for the selected day, in optimized stop sequence
  // (route_seq when planned, else by order number).
  const printManifestFor = (laneKey: string) => {
    const stops = [...(byDriver.get(laneKey) ?? [])].sort(
      (a, b) => (a.route_seq ?? 9999) - (b.route_seq ?? 9999) || a.order_no - b.order_no,
    );
    const label = lanes.find((l) => l.key === laneKey)?.label ?? driverOf(laneKey);
    printRouteManifest(label, stops, settings, lang, fmtDate(date));
  };

  // Timeline rows: drivers that have stops, each drawn over the day axis.
  const ganttRows: GanttRow[] = useMemo(
    () => boardColumns
      .filter((c) => c.key !== "__unassigned__" && c.orders.length > 0)
      .map((c) => ({ key: c.key, title: c.title, color: c.color, orders: c.orders })),
    [boardColumns],
  );

  // A driver's stops changed, so any earlier optimize summary/trace (and any
  // in-flight simulation) is stale — drop it rather than show a route that
  // no longer matches.
  const clearRouteFor = (driver: string) => {
    setRouteInfo((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    // Regrouping the loads renumbers them, so per-truckload figures would be
    // attached to the wrong load — drop them with the rest.
    setRouteTrips((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    setRouteLines((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    setRouteEtas((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    setPreview(null);
  };
  const assignTo = (id: string, driver: string) => {
    clearRouteFor(driver);
    // A plain (dropdown / drag) assignment always lands on the driver's first
    // load; multi-load assignment goes through assignRouteToDriver.
    return updateDelivery(id, { assigned_driver: driver || null, route_seq: null, load_no: null });
  };
  const unassign = (id: string) => {
    const d = dayOrders.find((x) => x.id === id);
    if (d) { const k = orderLaneKey(d); if (k) clearRouteFor(k); }
    return updateDelivery(id, { assigned_driver: null, route_seq: null, load_no: null });
  };

  // Assign an order onto a lane (a driver or temp driver) — used by the board's
  // drag-and-drop onto a column. Lands on the lane's first truckload.
  const assignToLane = async (id: string, laneKey: string) => {
    const d = dayOrders.find((x) => x.id === id);
    clearRouteFor(laneKey);
    await updateDelivery(id, { assigned_driver: laneKey, route_seq: null, load_no: null });
    addNote(id, `Moved to ${laneKey}${d?.assigned_driver ? ` (from ${d.assigned_driver})` : ""}`);
  };

  // A single manual (re)assignment — assign + write an audit note.
  const manualAssign = (id: string, driver: string) => {
    const d = dayOrders.find((x) => x.id === id);
    assignTo(id, driver);
    addNote(id, `Assigned to ${driver}${d?.assigned_driver && d.assigned_driver !== driver ? ` (from ${d.assigned_driver})` : ""}`);
  };
  const manualUnassign = (id: string) => {
    const d = dayOrders.find((x) => x.id === id);
    unassign(id);
    if (d?.assigned_driver) addNote(id, `Unassigned (was ${d.assigned_driver})`);
  };

  // Drag-and-drop on the board: move an order to a driver column, or back to
  // the unassigned pool.
  const boardMove = (orderId: string, columnKey: string) => {
    const d = dayOrders.find((x) => x.id === orderId);
    if (!d) return;
    if (columnKey === "__unassigned__") { if (d.assigned_driver) manualUnassign(orderId); }
    else if (orderLaneKey(d) !== columnKey) assignToLane(orderId, columnKey);
  };

  /** Solve a driver's full day for the given stop list — capacity-split
   * round trips out from the pickup point and back — WITHOUT saving
   * anything. Both the real "Optimize route" and the add-order simulation
   * run through this. `extraStops` lets the simulation include an order
   * that isn't assigned to the driver yet, so its pickup counts too. */
  const computeRoute = async (laneKey: string, stopList: Delivery[]): Promise<RoutePlan> => {
    const driver = driverOf(laneKey);
    // Earliest delivery window first (OSRM only supports a fixed start for
    // the trip solver — see /api/optimize-route); everything after that is
    // freely reordered within its trip for the shortest drive.
    const sorted = stopList
      .filter((d) => d.delivery_lat != null && d.delivery_lng != null)
      .sort((a, b) => (parseWindow(a.delivery_windows)?.[0] ?? Infinity) - (parseWindow(b.delivery_windows)?.[0] ?? Infinity));

    // The loop's anchor: pickup on the orders, else the driver's home store.
    const pickupAddr = (() => {
      const counts = new Map<string, number>();
      for (const d of sorted) { const a = (d.pickup_address || "").trim(); if (a) counts.set(a, (counts.get(a) ?? 0) + 1); }
      let best: string | null = null, bestN = 0;
      for (const [a, n] of counts) if (n > bestN) { best = a; bestN = n; }
      if (best) return best;
      for (const d of sorted) { const addr = settings.stores.find((s) => s.name === d.store)?.address; if (addr) return addr; }
      const profile = users.find((u) => u.full_name === driver);
      return profile?.store ? (settings.stores.find((s) => s.name === profile.store)?.address ?? null) : null;
    })();
    const depot = await getDepotCoords(pickupAddr);
    const byId = new Map(sorted.map((d) => [d.id, d]));

    // WHICH STOPS SHARE A TRUCK.
    //
    // The old splitter cut a new load every time the running pallet count hit
    // capacity, walking the list in whatever order it arrived — so two stops on
    // the same street could land on different trucks just because the boundary
    // fell between them. Optimizing afterwards can't undo that: the router only
    // reorders stops within a load it was handed.
    //
    // A grouping a PERSON made is left alone. Only loads the optimizer assigned
    // (or stops never grouped at all) get regrouped, so a deliberate split
    // survives pressing Optimize again.
    const capacity = capacityFor(driver);
    const manual = hasManualLoads(sorted) && sorted.some((d) => (d.load_no ?? 1) > 1 && !d.load_auto);
    let batches: Delivery[][];
    let loadGroups: string[][] | null = null;
    let regroupSavedMi = 0;
    if (!depot) {
      // Nothing to measure distances from — one open (one-way) route.
      batches = [sorted];
    } else if (manual) {
      batches = buildTrips(sorted, capacity);
    } else {
      const asStops = sorted.map((d) => ({ id: d.id, lat: d.delivery_lat, lng: d.delivery_lng, pallets: d.actual_pallets ?? d.est_pallets ?? 0 }));
      const geo = buildGeoLoads(asStops, { lat: depot[0], lng: depot[1] }, capacity);
      batches = geo.map((load) => load.map((s) => byId.get(s.id)!).filter(Boolean));
      loadGroups = batches.map((b) => b.map((d) => d.id));
      // What the regrouping bought, straight-line. Reported only when it's
      // real, so "optimized" never claims a win it didn't earn.
      const before = planCostMi({ lat: depot[0], lng: depot[1] }, fillByCapacity(asStops, capacity));
      const after = planCostMi({ lat: depot[0], lng: depot[1] }, geo);
      regroupSavedMi = Math.max(0, before - after);
    }

    let miles = 0;
    let seconds = 0;
    const orderedIds: string[] = [];
    const traces: TripTrace[] = [];
    const tripStats: TripStat[] = [];
    const etas: Record<string, string> = {};
    let clock = DAY_START_MIN; // arrival clock, continuous across truckloads

    for (const batch of batches) {
      if (!batch.length) continue;
      const tripStart = clock;
      if (batch.length < 2 && !depot) {
        // A single leftover stop with no depot to round-trip from — nothing
        // to optimize between, it just goes next.
        orderedIds.push(batch[0].id);
        continue;
      }
      const stopsForCall = depot
        ? [{ id: "__depot__", lat: depot[0], lng: depot[1] }, ...batch.map((d) => ({ id: d.id, lat: d.delivery_lat!, lng: d.delivery_lng! }))]
        : batch.map((d) => ({ id: d.id, lat: d.delivery_lat!, lng: d.delivery_lng! }));
      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The run's own date drives PREDICTIVE traffic: a route planned tonight
        // for tomorrow gets tomorrow-morning conditions, not tonight's empty roads.
        body: JSON.stringify({ stops: stopsForCall, roundtrip: !!depot, date: sorted[0]?.delivery_date ?? date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Route optimization failed");
      if (data.provider) lastProviderRef.current = { provider: data.provider, traffic: !!data.traffic };
      const stopIds = (data.order as string[]).filter((id) => id !== "__depot__");
      const legs = (data.legs ?? []) as number[];
      orderedIds.push(...stopIds);
      miles += data.miles;
      seconds += data.duration_seconds;

      // Split the loop geometry into the delivery run and the empty drive back
      // to the pickup. The return leg starts at the last stop, so find where
      // the path is closest to it (searching from the end) and cut there.
      const geom = (data.geometry as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
      const lastStop = depot && stopIds.length ? byId.get(stopIds[stopIds.length - 1]) : undefined;
      if (lastStop?.delivery_lat != null && lastStop.delivery_lng != null && geom.length > 2) {
        let cut = geom.length - 1, best = Infinity;
        for (let k = geom.length - 1; k >= 1; k--) {
          const dLat = geom[k][0] - lastStop.delivery_lat, dLng = geom[k][1] - lastStop.delivery_lng;
          const d2 = dLat * dLat + dLng * dLng;
          if (d2 < best) { best = d2; cut = k; }
        }
        traces.push({ delivery: geom.slice(0, cut + 1), ret: geom.slice(cut) });
      } else {
        traces.push({ delivery: geom, ret: [] });
      }

      // Walk the legs into per-stop arrival clocks. With a depot the trip is
      // [depot, s1, …, sN] so leg k drives INTO stop k; without one the first
      // stop is the start (no lead-in drive).
      for (let j = 0; j < stopIds.length; j++) {
        if (depot || j > 0) clock += (legs[depot ? j : j - 1] ?? 0) / 60;
        etas[stopIds[j]] = fmtClock(clock);
        const stop = byId.get(stopIds[j]);
        if (stop) clock += serviceMin(stop.delivery_duration);
      }
      if (depot) clock += (legs[stopIds.length] ?? 0) / 60;  // empty drive back to pickup

      const timing = tripTiming(data.duration_seconds / 60, stopIds.map((id) => byId.get(id)?.delivery_duration));
      tripStats.push({
        miles: Math.round(data.miles * 10) / 10,
        ...timing,
        stops: stopIds.length,
        start: fmtClock(tripStart),
        end: fmtClock(clock),
      });

      if (depot) clock += RELOAD_MIN;   // reload for the next load
    }

    return {
      orderedIds,
      miles: Math.round(miles * 10) / 10,
      seconds,
      traces,
      trips: batches.length,
      tripStats,
      loadGroups,
      regroupSavedMi,
      // The reload between loads is real time too, but it isn't part of any
      // single truckload — so it only shows up in the day total.
      dayMinutes: depot ? dayMinutes(tripStats) : tripStats.reduce((n, t) => n + t.totalMin, 0),
      etas,
    };
  };

  /** Save a solved plan as the driver's actual route. */
  const applyPlan = async (driver: string, plan: RoutePlan) => {
    if (plan.loadGroups) {
      // The grouping has to be written down, not just drawn: the board rebuilds
      // truckloads from load_no, so without this the stops would snap back to a
      // capacity split the moment anything re-rendered. Stamped as `load_auto`
      // so a later optimize is still free to regroup them.
      const loadNoById: Record<string, number | null> = {};
      plan.loadGroups.forEach((ids, li) => ids.forEach((id) => { loadNoById[id] = li + 1 > 1 ? li + 1 : null; }));
      await reorderStops(plan.orderedIds, loadNoById, true);
    } else {
      await Promise.all(plan.orderedIds.map((id, i) => updateDelivery(id, { route_seq: i })));
    }
    setRouteInfo((p) => ({ ...p, [driver]: { miles: plan.miles, duration_text: fmtMinutes(plan.seconds / 60), trips: plan.trips, minutes: plan.seconds / 60, dayMinutes: plan.dayMinutes, dayText: fmtMinutes(plan.dayMinutes) } }));
    setRouteTrips((p) => ({ ...p, [driver]: plan.tripStats }));
    setRouteLines((p) => ({ ...p, [driver]: plan.traces }));
    setRouteEtas((p) => ({ ...p, [driver]: plan.etas }));
  };

  const optimize = async (driver: string) => {
    const stops = byDriver.get(driver) ?? [];
    if (stops.length < 1) return;
    setBusyDriver(driver);
    setPreview(null);
    setErr(null);
    try {
      const before = routeInfo[driver]?.miles ?? null;
      const plan = await computeRoute(driver, stops);
      await applyPlan(driver, plan);
      // Two different wins, reported separately because they come from
      // different places: regrouping decides which stops share a truck,
      // re-optimizing decides the order within one.
      const saved = before != null ? Math.round((before - plan.miles) * 10) / 10 : 0;
      if (plan.regroupSavedMi >= 1 && plan.trips > 1) {
        const mi = Math.round(plan.regroupSavedMi);
        notify(t(
          `Regrouped into ${plan.trips} truckloads by area — about ${mi} mi shorter`,
          `Reagrupado en ${plan.trips} viajes por zona — unas ${mi} mi menos`,
        ));
      } else if (before != null && saved >= 0.1) {
        notify(t(`Optimized — saved ${saved} mi`, `Optimizada — ahorro ${saved} mi`));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyDriver(null);
      setRouterInfo(lastProviderRef.current);
    }
  };

  // Solve every driver's route in one go so the whole board lights up at
  // once. Sequential + gently throttled — the free OSRM server asks for no
  // more than ~1 request/second.
  const optimizeAll = async () => {
    const withStops = lanes.filter((u) => (byDriver.get(u.key) ?? []).length > 0);
    if (!withStops.length) return;
    setOptimizingAll(true);
    setPreview(null);
    setErr(null);
    for (const u of withStops) {
      setBusyDriver(u.key);
      try {
        await applyPlan(u.key, await computeRoute(u.key, byDriver.get(u.key) ?? []));
      } catch (e) {
        setErr((e as Error).message);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    setBusyDriver(null);
    setOptimizingAll(false);
    setRouterInfo(lastProviderRef.current);
  };

  // Auto-assign every unassigned order across the drivers (capacity + window +
  // proximity aware), then leave the "Optimize all routes" button to sequence
  // each driver's day into real OSRM routes.
  const runAutoAssign = async () => {
    if (autoAssigning || optimizingAll || busyDriver != null) return;
    const driverNames = drivers.map((u) => u.full_name);
    if (!driverNames.length) { notify(t("Add drivers first (give someone the Driver role).", "Agregue choferes primero (asigne el rol de Chofer).")); return; }
    const res = autoAssign(unassigned, driverNames, capacityFor, { maxTripsPerDay: 2, unavailable: unavailableToday });
    if (!res.assignments.length) {
      notify(t("Nothing could be auto-assigned (no coordinates or no capacity).", "No se pudo auto-asignar nada (sin coordenadas o sin capacidad)."));
      return;
    }
    setAutoAssigning(true);
    try {
      for (const a of res.assignments) await assignTo(a.orderId, a.driver);
    } finally {
      setAutoAssigning(false);
    }
    const nDrivers = new Set(res.assignments.map((a) => a.driver)).size;
    notify(t(
      `Auto-assigned ${res.assignments.length} order(s) to ${nDrivers} driver(s)${res.unassigned.length ? ` · ${res.unassigned.length} left (no location/capacity)` : ""}. Now tap “Optimize all routes”.`,
      `Auto-asignadas ${res.assignments.length} orden(es) a ${nDrivers} chofer(es)${res.unassigned.length ? ` · ${res.unassigned.length} sin colocar (sin ubicación/capacidad)` : ""}. Ahora toque “Optimizar todas las rutas”.`,
    ));
  };

  const toggleOrder = (id: string) =>
    setSelectedOrders((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clearSelection = () => setSelectedOrders(new Set());

  // Assign every checked order to one driver.
  const bulkAssign = async (driver: string) => {
    const ids = unassigned.filter((d) => selectedOrders.has(d.id)).map((d) => d.id);
    if (!ids.length || !driver) return;
    setAutoAssigning(true);
    try { for (const id of ids) await assignTo(id, driver); } finally { setAutoAssigning(false); }
    clearSelection();
    notify(t(`Assigned ${ids.length} order(s) to ${driver}`, `Asignadas ${ids.length} orden(es) a ${driver}`));
  };

  // Auto-assign only the checked orders across the drivers.
  const bulkAutoAssign = async () => {
    const chosen = unassigned.filter((d) => selectedOrders.has(d.id));
    if (!chosen.length) return;
    const res = autoAssign(chosen, drivers.map((u) => u.full_name), capacityFor, { maxTripsPerDay: 2, unavailable: unavailableToday });
    if (!res.assignments.length) { notify(t("Couldn't place the selected orders.", "No se pudieron colocar las órdenes seleccionadas.")); return; }
    setAutoAssigning(true);
    try { for (const a of res.assignments) await assignTo(a.orderId, a.driver); } finally { setAutoAssigning(false); }
    clearSelection();
    const nDrivers = new Set(res.assignments.map((a) => a.driver)).size;
    notify(t(
      `Auto-assigned ${res.assignments.length} order(s) to ${nDrivers} driver(s)${res.unassigned.length ? ` · ${res.unassigned.length} left` : ""}.`,
      `Auto-asignadas ${res.assignments.length} orden(es) a ${nDrivers} chofer(es)${res.unassigned.length ? ` · ${res.unassigned.length} sin colocar` : ""}.`,
    ));
  };

  // Suggest the best driver for one order: prefer a driver whose home store
  // matches the order's sold-from store and still has free truck capacity;
  // otherwise the same-store driver, otherwise any driver with room.
  const suggestDriverFor = (d: Delivery): string | null => {
    const pallets = Number(d.actual_pallets ?? d.est_pallets ?? 0);
    const hasRoom = (name: string) => {
      const load = (byDriver.get(name) ?? []).reduce((n, x) => n + Number(x.actual_pallets ?? x.est_pallets ?? 0), 0);
      return load + pallets <= capacityFor(name);
    };
    const sameStore = drivers.filter((u) => u.store && u.store === d.store).map((u) => u.full_name);
    const pick = sameStore.find(hasRoom) ?? sameStore[0]
      ?? drivers.map((u) => u.full_name).find(hasRoom) ?? null;
    return pick ?? null;
  };

  /** Simulate adding an unassigned order to the selected driver's day —
   * shows the would-be route (dashed) and totals without saving anything. */
  const previewAdd = async (d: Delivery, driver: string) => {
    if (d.delivery_lat == null || d.delivery_lng == null) {
      setErr(t("That order has no address pin yet, so its route can't be simulated.", "Esa orden aún no tiene pin de dirección, así que su ruta no se puede simular."));
      return;
    }
    setPreviewBusy(d.id);
    setErr(null);
    try {
      const plan = await computeRoute(driver, [...(byDriver.get(driver) ?? []), d]);
      setPreview({ orderId: d.id, code: orderLabel(d), driver, plan });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPreviewBusy(null);
    }
  };

  const confirmPreview = async () => {
    if (!preview) return;
    const { orderId, driver, plan } = preview; // `driver` is a lane key (driver / temp driver)
    setPreview(null);
    await updateDelivery(orderId, { assigned_driver: driver, load_no: null });
    await applyPlan(driver, plan);
  };

  // Manual nudge — hand-arrange a load's stops with the ↑/↓ arrows, whether or
  // not the route's been optimized yet. `index` is the position in the DISPLAYED
  // order (the flattened truckloads), so we rebuild that exact order here rather
  // than byDriver's sequence — otherwise, with manual truckloads, the two orders
  // differ and the arrow would move the wrong row.
  const move = async (laneKey: string, index: number, dir: -1 | 1) => {
    const stops = byDriver.get(laneKey) ?? [];
    const trips = buildTrips(stops, capacityFor(driverOf(laneKey)));
    const list = trips.flat();
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    // Reorder the whole list and renumber it 0..n-1.
    const [item] = list.splice(index, 1);
    list.splice(j, 0, item);
    // The traced path/distance were computed for the old order — a manual
    // nudge no longer matches them, so drop them rather than mislead.
    clearRouteFor(laneKey);

    // Once a lane carries MANUAL truckload numbers (which moving a whole
    // truckload stamps), the display regroups stops by load_no — so writing a
    // new sequence alone puts a stop straight back in the load it came from,
    // and the arrow looks broken. Re-stamp the loads by position, keeping each
    // truckload's size: a stop nudged past a boundary genuinely moves into the
    // next load, which is what the dispatcher just asked for. Lanes still split
    // automatically by capacity are left alone — there, sequence is enough.
    let loadNoById: Record<string, number | null> | undefined;
    if (hasManualLoads(stops)) {
      loadNoById = {};
      let at = 0;
      trips.forEach((batch, ti) => {
        for (let k = 0; k < batch.length; k++) {
          const d = list[at++];
          if (d) loadNoById![d.id] = ti + 1 > 1 ? ti + 1 : null;
        }
      });
    }

    // One guarded operation for the whole new sequence: the list updates
    // locally right away and is held there until every write lands, so a
    // realtime refetch can't snap the stop back to where it was.
    await reorderStops(list.map((d) => d.id), loadNoById);
  };

  // Move a WHOLE truckload up/down within a driver's day, so the dispatcher
  // can say which load goes out first. The new order is stamped as explicit
  // load numbers (not just a sequence), otherwise a lane that was auto-split by
  // capacity would just re-derive the original grouping on the next render.
  const moveTrip = async (laneKey: string, index: number, dir: -1 | 1) => {
    const stops = byDriver.get(laneKey) ?? [];
    const trips = buildTrips(stops, capacityFor(driverOf(laneKey)));
    const j = index + dir;
    if (j < 0 || j >= trips.length) return;
    const next = [...trips];
    const [moved] = next.splice(index, 1);
    next.splice(j, 0, moved);
    clearRouteFor(laneKey);
    const loadNoById: Record<string, number | null> = {};
    next.forEach((batch, ti) => batch.forEach((d) => { loadNoById[d.id] = ti + 1 > 1 ? ti + 1 : null; }));
    await reorderStops(next.flat().map((d) => d.id), loadNoById);
    notify(t(`Truckload moved to position ${j + 1}`, `Viaje movido a la posición ${j + 1}`));
  };

  const focused = selected.size > 0;
  const isDim = (driver: string | null) => focused && !!driver && !selected.has(driver);

  // Resolve every driver's pickup point up front, so the map can show each
  // as its loop's start/end pin even before a route's been optimized.
  useEffect(() => {
    for (const u of lanes) {
      if ((byDriver.get(u.key) ?? []).length) getDepotCoords(pickupAddressFor(u.key));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDriver, settings.stores]);

  // Selecting a driver auto-draws their route: if they have stops but no
  // computed route yet, optimize it so the traced line + times appear right
  // away. One at a time (re-runs as each finishes), gentle on the router.
  useEffect(() => {
    if (busyDriver != null || optimizingAll) return;
    for (const name of selected) {
      if ((byDriver.get(name)?.length ?? 0) >= 1 && !routeInfo[name]) { optimize(name); return; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, routeInfo, busyDriver, optimizingAll]);

  // The whole day is always on the map — a driver focus dims the rest rather
  // than hiding it, so the full picture stays visible.
  const points: MapPoint[] = useMemo(() => {
    // Color each assigned stop by its TRUCKLOAD (matching the route line),
    // so the map groups stops into the same colors as their loop.
    const stopColor = new Map<string, string>();
    for (const u of lanes) {
      const stops = byDriver.get(u.key) ?? [];
      buildTrips(stops, capacityFor(u.driver)).forEach((batch, ti) => {
        const c = tripColor(colorFor(u.driver), ti);
        for (const d of batch) stopColor.set(d.id, c);
      });
    }

    const pts: MapPoint[] = [];
    // Pickup / base pins first, so a stop that sits right on the pickup still
    // draws on top of the "P" instead of being hidden behind it.
    for (const u of lanes) {
      if (!(byDriver.get(u.key) ?? []).length) continue;
      const addr = (pickupAddressFor(u.key) ?? "").trim();
      const coords = addr ? depotCoords[addr] : undefined;
      if (!coords) continue;
      pts.push({
        id: `__depot__${u.id}`,
        lat: coords[0],
        lng: coords[1],
        color: colorFor(u.driver),
        badge: "P",
        label: `${t("Pickup / base", "Recolección / base")} (${u.label}) — ${addr}`,
        dimmed: isDim(u.key) || selectedOrders.size > 0,
      });
    }
    const selActive = selectedOrders.size > 0;
    for (const d of dayOrders) {
      if (d.delivery_lat == null || d.delivery_lng == null) continue;
      if (!d.assigned_driver) {
        const sel = selectedOrders.has(d.id);
        pts.push({
          id: d.id,
          lat: d.delivery_lat,
          lng: d.delivery_lng,
          color: sel ? (selColorById.get(d.id) ?? "#2456c9") : UNASSIGNED_COLOR,
          badge: sel ? "D" : undefined,
          label: `#${orderLabel(d)} — ${sel ? t("Delivery", "Entrega") : t("Unassigned", "Sin asignar")}`,
          dimmed: sel ? false : (focused || selActive),
        });
        continue;
      }
      const sel = selectedOrders.has(d.id);
      const laneKey = orderLaneKey(d)!;
      const list = byDriver.get(laneKey) ?? [];
      const idx = list.findIndex((x) => x.id === d.id);
      const badge = d.route_seq != null ? String(idx + 1) : undefined;
      const loadTag = !isBucket(d.assigned_driver) && loadNoOf(d) > 1 ? ` · ${t("Load", "Carga")} ${loadNoOf(d)}` : "";
      pts.push({
        id: d.id,
        lat: d.delivery_lat,
        lng: d.delivery_lng,
        // A selected assigned stop pops in its own selection color, un-dimmed,
        // marked "D" so it pairs with its "P" pickup pin.
        color: sel ? (selColorById.get(d.id) ?? "#2456c9") : (stopColor.get(d.id) ?? colorFor(d.assigned_driver)),
        badge: sel ? "D" : badge,
        label: `#${orderLabel(d)} — ${d.assigned_driver}${loadTag}${badge ? ` (${t("Stop", "Parada")} ${badge})` : ""}`,
        dimmed: sel ? false : (isDim(laneKey) || selActive),
      });
    }
    // Pickup ("P") pin for each selected load (assigned or pool), in its own
    // color, so the PU→DEL pairing is visible even before the road route loads.
    for (const d of dayOrders) {
      if (!selectedOrders.has(d.id)) continue;
      const pk = selPickup[d.id];
      if (!pk) continue;
      pts.push({
        id: `__selpk__${d.id}`,
        lat: pk[0],
        lng: pk[1],
        color: selColorById.get(d.id) ?? "#2456c9",
        badge: "P",
        label: `#${orderLabel(d)} — ${t("Pickup", "Recolección")}`,
        dimmed: false,
      });
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOrders, byDriver, settings.driver_colors, settings.driver_capacity, selected, selectedOrders, selColorById, selPickup, depotCoords, lanes]);

  // Every optimized driver's routes are always drawn; a focus just dims the
  // others. Clicking a route focuses its driver (see onLineClick below).
  const lines: MapLine[] = useMemo(() => {
    const entries = Object.entries(routeLines);
    // Fan the routes out with a small perpendicular offset each, so where two
    // run along the same road they sit side by side rather than on top of
    // each other. Centered so the spread stays close to the actual road.
    const total = entries.reduce((n, [, trips]) => n + trips.length, 0);
    const spacing = 5;
    const center = (total - 1) / 2;
    const out: MapLine[] = [];
    let idx = 0;
    for (const [driver, trips] of entries) {
      trips.forEach((trace, i) => {
        const color = tripColor(colorFor(driverOf(driver)), i);
        const dimmed = isDim(driver);
        const offset = (idx - center) * spacing;
        // Delivery run: solid. Empty drive back to the pickup: dashed, and
        // pushed to its own parallel offset so that when it retraces the
        // outbound road the dashes sit BESIDE the solid line (and stay
        // visible) instead of landing on top of the same-color run.
        out.push({ id: `line:${driver}#${i}`, color, positions: trace.delivery, dimmed, offset });
        if (trace.ret.length > 1) out.push({ id: `ret:${driver}#${i}`, color, positions: trace.ret, dimmed, dashed: true, offset: offset + 7 });
        idx++;
      });
    }
    if (preview) {
      const color = colorFor(driverOf(preview.driver));
      preview.plan.traces.forEach((trace, i) => {
        out.push({ id: `preview:${i}`, color, positions: trace.delivery, dashed: true });
        if (trace.ret.length > 1) out.push({ id: `pret:${i}`, color, positions: trace.ret, dashed: true, offset: 7 });
      });
    }
    // Selected loads (assigned or pool): each in its own color — the "go" leg
    // solid (pickup→dropoff) and the "return" leg dashed (dropoff→pickup),
    // offset so it sits beside the outbound line. When the road geometry isn't
    // ready (or fails to load), fall back to a straight pickup→dropoff line so
    // the PU→DEL pairing is ALWAYS shown, never just the dot.
    for (const d of dayOrders) {
      if (!selectedOrders.has(d.id)) continue;
      const color = selColorById.get(d.id) ?? "#2456c9";
      const pos = selRouteCache[d.id];
      if (pos && pos.length) {
        out.push({ id: `sel:${d.id}`, color, positions: pos });
        out.push({ id: `selret:${d.id}`, color, positions: [...pos].reverse(), dashed: true, offset: 6 });
      } else {
        const pk = selPickup[d.id];
        if (pk && d.delivery_lat != null && d.delivery_lng != null) {
          out.push({ id: `selstraight:${d.id}`, color, positions: [pk, [d.delivery_lat, d.delivery_lng]], dashed: true });
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLines, selected, preview, settings.driver_colors, selectedOrders, selRouteCache, selPickup, selColorById, dayOrders]);

  const onLineClick = (id: string) => {
    const m = id.match(/^(?:line|ret):(.+)#\d+$/);
    if (m) focusOnly(m[1]);
  };

  // What the map frames: the selected drivers' stops + pickups when any are
  // focused, otherwise the whole day.
  const fitTo: [number, number][] = useMemo(() => {
    // "Where is this driver right now" beats everything else: the dispatcher
    // asked a direct question and wants the answer centred, not averaged in
    // with a day's worth of stops. A small box around the point, so the map
    // zooms IN on the truck instead of framing a single coordinate.
    if (locateDriver) {
      const loc = driverLocations.find((l) => {
        const u = users.find((x) => x.id === l.driver_id);
        return u?.full_name === locateDriver;
      });
      if (loc) {
        const pad = 0.004; // ≈ 400 m, so the truck sits in a readable frame
        return [
          [loc.lat - pad, loc.lng - pad],
          [loc.lat + pad, loc.lng + pad],
        ];
      }
    }
    // Selected unassigned loads take priority — frame them + their routes.
    if (selectedOrders.size > 0) {
      const pts: [number, number][] = [];
      for (const d of dayOrders) {
        if (!selectedOrders.has(d.id)) continue;
        if (d.delivery_lat != null && d.delivery_lng != null) pts.push([d.delivery_lat, d.delivery_lng]);
        const pk = selPickup[d.id];
        if (pk) pts.push(pk); // keep the pickup end in frame too
        const pos = selRouteCache[d.id];
        if (pos) pts.push(...pos);
      }
      if (pts.length) return pts;
    }
    if (!focused) return points.map((p) => [p.lat, p.lng] as [number, number]);
    const ids = new Set<string>();
    for (const key of selected) {
      for (const d of byDriver.get(key) ?? []) ids.add(d.id);
      const lane = lanes.find((l) => l.key === key);
      if (lane) ids.add(`__depot__${lane.id}`);
    }
    return points.filter((p) => ids.has(p.id)).map((p) => [p.lat, p.lng] as [number, number]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, selected, selectedOrders, selRouteCache, selPickup, dayOrders, locateDriver, driverLocations, users]);

  if (!me) return null;
  if (!canPlanRoutes(me)) {
    return <div className="empty">{t("You don’t have access to route planning.", "No tienes acceso a la planificación de rutas.")}</div>;
  }

  const withStops = lanes.filter((u) => (byDriver.get(u.key) ?? []).length > 0);
  // Route cards always show every route that has stops, PLUS any lane you've
  // checked (even an empty one you're filling). Checking loads to merge, or
  // focusing a driver on the map, never makes the other routes disappear.
  const shownDrivers = lanes.filter((u) => (byDriver.get(u.key) ?? []).length > 0 || selected.has(u.key));
  // Simulating an add targets a driver, so it needs exactly one selected.
  const singleSel = selected.size === 1 ? [...selected][0] : null;
  const scheduledCount = dayOrders.length - unassigned.length;

  return (
    <>
      <div className="page-head">
        <h2>{t("Routes Manager", "Gestor de Rutas")} <span className="count-tag">{dayOrders.length}</span></h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="viewtoggle">
            <button className="vt" disabled={allDates} onClick={() => setDate((d) => shiftDateISO(d, -1))} title={t("Previous day", "Día anterior")}>◀</button>
            <input type="date" value={date} disabled={allDates} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
            <button className="vt" disabled={allDates} onClick={() => setDate((d) => shiftDateISO(d, 1))} title={t("Next day", "Día siguiente")}>▶</button>
          </div>
          {date !== todayISO() && !allDates && (
            <button className="btn btn-ghost btn-sm" onClick={() => setDate(todayISO())}>{t("Today", "Hoy")}</button>
          )}
          <button
            className={"btn btn-sm " + (allDates ? "btn-primary" : "btn-ghost")}
            onClick={() => setAllDates((v) => !v)}
            title={t("Show routable orders from every date, not just the selected day", "Mostrar órdenes de todas las fechas, no solo el día elegido")}
          >
            🗓 {allDates ? t("All dates ✓", "Todas ✓") : t("All dates", "Todas")}
          </button>
          <button
            className="btn btn-amber btn-sm"
            disabled={autoAssigning || optimizingAll || busyDriver != null || unassigned.length === 0 || drivers.length === 0}
            onClick={runAutoAssign}
            title={t("Distribute all unassigned orders across drivers", "Repartir todas las órdenes sin asignar entre los choferes")}
          >
            {autoAssigning ? `… ${t("Assigning", "Asignando")}` : `✨ ${t("Auto-assign", "Auto-asignar")} (${unassigned.length})`}
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={optimizingAll || autoAssigning || busyDriver != null || lanes.every((u) => (byDriver.get(u.key) ?? []).length === 0)}
            onClick={optimizeAll}
          >
            {optimizingAll ? `… ${t("Optimizing", "Optimizando")} ${busyDriver ?? ""}` : `🧭 ${t("Optimize all routes", "Optimizar todas las rutas")}`}
          </button>
          {geocoding > 0 && <span className="hint">{t("Locating addresses…", "Ubicando direcciones…")}</span>}
          {/* Says plainly whether the distances/ETAs just computed account for
              traffic, so nobody trusts free-flow numbers thinking otherwise. */}
          {routerInfo && (
            routerInfo.traffic ? (
              <span className="sema" style={{ background: "var(--green)", color: "#fff" }}
                title={t("Distances and ETAs come from Google Maps with traffic for the run's departure time", "Distancias y tiempos vienen de Google Maps con tráfico para la hora de salida")}>
                🚦 {t("Google · with traffic", "Google · con tráfico")}
              </span>
            ) : (
              <span className="sema" style={{ background: "var(--amber)", color: "#fff" }}
                title={t("Google Routes is unavailable, so these are free-flow estimates from the free router", "Google Routes no está disponible, así que son estimados sin tráfico del router gratuito")}>
                ⚠ {t("No traffic data", "Sin datos de tráfico")}
              </span>
            )
          )}
        </div>
      </div>

      {/* ---------- Drivers who stopped reporting ----------
           No amount of Android hardening is bulletproof: a battery manager, a
           flat battery or no signal will still cut the feed. Surfacing it here
           means a truck goes "not reporting" instead of quietly vanishing. */}
      {trackingIssues.length > 0 && (
        <div className="card" style={{ marginBottom: 14, background: "#fff7ec", borderColor: "var(--amber)" }}>
          <b style={{ color: "#b9791a" }}>
            📡 {t(`${trackingIssues.length} driver(s) on shift aren't reporting their location`,
                  `${trackingIssues.length} chofer(es) en turno no están reportando su ubicación`)}
          </b>
          <div className="hint" style={{ marginTop: 4 }}>
            {trackingIssues.map((g) => `${g.driver} (${g.quietForMin == null ? t("no fix yet", "sin señal aún") : t(`${g.quietForMin} min`, `${g.quietForMin} min`)})`).join(" · ")}
            {" — "}
            {t("their phone may have paused the app to save battery, or lost signal.",
               "su teléfono pudo pausar la app para ahorrar batería, o perdió señal.")}
          </div>
        </div>
      )}

      {/* ---------- Why-is-it-empty helper ---------- */}
      {dayOrders.length === 0 && (() => {
        const otherDates = deliveries.filter((d) => ROUTE_STAGES.includes(d.stage) && d.delivery_date !== date).length;
        return (
          <div className="card" style={{ marginBottom: 14, background: "#fff7ec", borderColor: "var(--amber)" }}>
            <b style={{ color: "#b9791a" }}>⚠ {allDates ? t("No schedulable orders at all.", "No hay órdenes para programar.") : t("No schedulable orders for this date.", "No hay órdenes para programar en esta fecha.")}</b>
            <div className="hint" style={{ marginTop: 4 }}>
              {allDates
                ? t("Any order that isn't delivered or canceled can be scheduled here — even before it's approved or prepared.", "Cualquier orden que no esté entregada o cancelada se puede programar aquí — incluso antes de aprobarse o prepararse.")
                : t(`Any order with delivery date ${fmtDate(date)} shows here (except delivered/canceled ones) — you can plan it even before it's approved.`,
                    `Cualquier orden con fecha de entrega ${fmtDate(date)} aparece aquí (menos entregadas/canceladas) — puedes planearla incluso antes de aprobarse.`)}
              {!allDates && otherDates > 0 && " " + t(`${otherDates} schedulable order(s) sit on other dates — tap "All dates" or use the ◀ ▶ arrows.`,
                                                      `${otherDates} orden(es) programables están en otras fechas — toque "Todas" o use las flechas ◀ ▶.`)}
            </div>
          </div>
        );
      })()}

      {/* ---------- Stats strip (each tile jumps to the matching view) ---------- */}
      <div className="card" style={{ display: "flex", padding: 0, overflow: "hidden", marginBottom: 14 }}>
        {([
          { n: scheduledCount, label: t("Scheduled", "Programadas"), target: "scheduled" as const },
          { n: unassigned.length, label: t("Unscheduled", "Sin programar"), accent: true, target: "orders" as const },
          { n: dayOrders.length, label: t("Total", "Total"), target: "board" as const },
          { n: withStops.length, label: t("Routes", "Rutas"), target: "routes" as const },
        ]).map((s, i) => (
          <button
            key={i}
            onClick={() => setTab(s.target)}
            title={t("Show", "Mostrar") + " " + s.label}
            style={{
              flex: 1, textAlign: "center", padding: "12px 8px", cursor: "pointer",
              border: "none", borderLeft: i ? "1px solid var(--line)" : undefined,
              background: tab === s.target ? "var(--accent-soft)" : "transparent",
              borderBottom: tab === s.target ? "3px solid var(--accent)" : "3px solid transparent",
            }}
          >
            <div style={{ fontFamily: "Archivo, sans-serif", fontSize: 22, fontWeight: 800, color: s.accent && s.n > 0 ? "var(--amber)" : "var(--text)" }}>{s.n}</div>
            <div className="hint" style={{ marginTop: 0 }}>{s.label}</div>
          </button>
        ))}
      </div>

      {viewingToday && (
        <div className="hint" style={{ marginBottom: 8 }}>
          {t(
            "Today's list also carries forward any earlier order that's still not delivered — reschedule it (or leave its date as-is) and dispatch it today.",
            "La lista de hoy también arrastra cualquier orden anterior que aún no se ha entregado — reprograme su fecha (o déjela igual) y despáchela hoy.",
          )}
        </div>
      )}

      {err && <div className="hint" style={{ color: "var(--red)", marginBottom: 8 }}>⚠ {err}</div>}

      {/* ---------- Layout toolbar ---------- */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <button className={"btn btn-sm " + (showTop ? "btn-ghost" : "btn-primary")} onClick={() => setShowTop((v) => !v)}
          title={t("Show or hide the map + driver panel to free up space", "Mostrar u ocultar el mapa y el panel para ganar espacio")}>
          🗺 {showTop ? t("Hide map & drivers", "Ocultar mapa y choferes") : t("Show map & drivers", "Mostrar mapa y choferes")}
        </button>
        {tab === "routes" && (
          <button className="btn btn-ghost btn-sm" onClick={() => setWideRoutes((v) => !v)}
            title={t("Toggle full-width route cards vs a compact grid", "Alternar tarjetas de ruta a ancho completo o cuadrícula compacta")}>
            {wideRoutes ? "▦ " + t("Grid", "Cuadrícula") : "▭ " + t("Wide", "Ancho")}
          </button>
        )}
      </div>

      {/* ---------- Driver panel + map ---------- */}
      {showTop && (<>
      {/* Sticky so the driver pool (and map) stay visible while you scroll the
          route cards below and build routes. Capped height + own scroll so it
          never takes over the screen. */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 8, position: "sticky", top: 6, zIndex: 5, background: "var(--paper)", paddingBottom: 6 }}>
        <div className="card" style={{ flex: "1 1 250px", maxWidth: 340, margin: 0, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "min(60vh, 520px)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
            <b style={{ flex: 1 }}>🚚 {t("Drivers & routes", "Choferes y rutas")}</b>
            {selected.size >= 2 && (
              <button className="btn btn-primary btn-sm" onClick={mergeSelectedLanes}
                title={t("Combine the checked routes into one (merges into the top-most checked one)", "Combinar las rutas marcadas en una (se unen en la primera marcada)")}>
                🔀 {t("Merge", "Unir")} ({selected.size})
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => addBucket()} title={t("Add a numbered route (Route 1, Route 2…) to build on, then hand it to a driver later", "Agrega una ruta numerada (Ruta 1, Ruta 2…) para armar, y entrégala a un chofer después")}>＋ {t("Route", "Ruta")}</button>
            {focused && <button className="notif-clear" onClick={() => setSelected(new Set())}>{t("Show all", "Mostrar todos")}</button>}
          </div>
          {lanes.length === 0 ? (
            <div className="empty">{t("No drivers yet — tap “＋ Route” to build a route without one.", "Aún sin choferes — toca “＋ Ruta” para armar una ruta sin uno.")}</div>
          ) : (
            <div style={{ maxHeight: 470, overflowY: "auto" }}>
              {lanes.map((u) => {
                const stops = byDriver.get(u.key) ?? [];
                const info = routeInfo[u.key];
                const on = selected.has(u.key);
                const bucket = u.isBucket;
                const needsDriver = !isRealDriver(u.driver);
                // Load vs truck capacity — a filled bar the dispatcher can read
                // at a glance; over capacity turns red (the day needs a reload trip).
                const pallets = stops.reduce((s, o) => s + Number(o.actual_pallets ?? o.est_pallets ?? 0), 0);
                const cap = capacityFor(u.driver);
                const pct = cap > 0 ? Math.min(100, (pallets / cap) * 100) : 0;
                const over = pallets > cap;
                return (
                  <div
                    key={u.id}
                    onClick={() => focusOnly(u.key)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: "1px solid var(--line)", cursor: "pointer", background: on ? "var(--accent-soft)" : undefined }}
                  >
                    <input type="checkbox" checked={on} onClick={(e) => e.stopPropagation()} onChange={() => toggleDriver(u.key)} style={{ width: 15, height: 15, flex: "0 0 auto" }} />
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: colorFor(u.driver), flex: "0 0 auto", border: "2px solid #fff", boxShadow: "0 0 0 1px var(--line)" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                        {u.label}
                        {/* Clocked in AND reporting right now. Driven by the
                            realtime location feed, so it appears and clears on
                            its own — no refresh. */}
                        {liveNames.has(u.driver) && (
                          <button
                            className="sema live-tag"
                            // Tapping the NAME shows their route; tapping this
                            // answers the other question — where are they now.
                            onClick={(e) => { e.stopPropagation(); setLocateDriver(u.driver); }}
                            title={t("Show where this driver is right now", "Ver dónde está este chofer ahora")}
                          >
                            {t("LIVE", "EN VIVO")}
                          </button>
                        )}
                        {needsDriver && <span className="sema" style={{ background: "var(--accent)", color: "#fff", fontSize: 10 }}>🧭 {t("route", "ruta")}</span>}
                        {bucket && (
                          <button className="notif-clear" title={t("Rename temp driver", "Renombrar chofer temp")}
                            onClick={(e) => { e.stopPropagation(); renameBucket(u.key); }}>✏</button>
                        )}
                        {bucket && (
                          <button className="notif-clear" title={t("Remove this route", "Quitar esta ruta")}
                            onClick={(e) => { e.stopPropagation(); clearLane(u.key); }}>✕</button>
                        )}
                      </div>
                      <div className="hint" style={{ marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span>📦 {stops.length}</span>
                        {/* Travel time & miles only appear once a route has been calculated. */}
                        {info && <span>⏱ {info.duration_text}</span>}
                        {info && <span>⇥ {info.miles} mi</span>}
                      </div>
                      {/* Capacity meter: pallets loaded vs the truck's capacity. */}
                      <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: over ? "var(--red)" : "var(--green)" }} />
                        </div>
                        <span className="hint" style={{ fontSize: 11, fontWeight: 700, color: over ? "var(--red)" : undefined }}>
                          {pallets}/{cap}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="card" style={{ flex: "3 1 460px", margin: 0, padding: 0, overflow: "hidden" }}>
          <MapView points={points} lines={lines} stores={storeMarkers} liveDrivers={liveDrivers} onLineClick={onLineClick} fitTo={fitTo} height={430} onPointClick={(id) => {
            // Click any order pin (assigned or pool) to toggle its PU→DEL view.
            const d = dayOrders.find((x) => x.id === id);
            if (d) toggleOrder(d.id);
          }} />
        </div>
      </div>
      <div className="hint" style={{ marginTop: 4, marginBottom: 14 }}>
        {t(
          "Every route is on the map at once. Click a route or a driver to highlight it (the rest dim and the map zooms in); check drivers to compare several. Each route loops from the pickup point (P) out and back. A dashed line is an unsaved simulation.",
          "Todas las rutas están en el mapa a la vez. Haz clic en una ruta o un chofer para resaltarla (el resto se atenúa y el mapa hace zoom); marca varios choferes para comparar. Cada ruta hace un ciclo desde el punto de recolección (P) y regresa. Una línea punteada es una simulación sin guardar.",
        )}
      </div>
      </>)}

      {/* ---------- Simulation banner ---------- */}
      {preview && (
        <div className="card" style={{ borderColor: colorFor(driverOf(preview.driver)) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <b>
              🔮 {t(
                `Adding #${preview.code} to ${laneLabel(preview.driver)}:`,
                `Agregando #${preview.code} a ${laneLabel(preview.driver)}:`,
              )}
            </b>
            <span>
              <b>{preview.plan.miles} mi</b> · {fmtMinutes(preview.plan.seconds / 60)}
              {preview.plan.trips > 1 && ` · ${preview.plan.trips} ${t("truckloads", "viajes")}`}
            </span>
            {routeInfo[preview.driver] && (
              <span className="hint" style={{ marginTop: 0 }}>
                ({t("currently", "actualmente")} {routeInfo[preview.driver].miles} mi · {routeInfo[preview.driver].duration_text})
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button className="btn btn-green btn-sm" onClick={confirmPreview}>✓ {t("Add to route", "Agregar a la ruta")}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>✕ {t("Cancel", "Cancelar")}</button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {t(
              "The dashed line on the map is this simulated route — nothing is saved until you add it.",
              "La línea punteada en el mapa es esta ruta simulada — nada se guarda hasta que la agregue.",
            )}
          </div>
        </div>
      )}

      {/* ---------- Tabs ---------- */}
      <div className="viewtoggle" style={{ marginBottom: 12 }}>
        <button className={"vt " + (tab === "routes" ? "on" : "")} onClick={() => setTab("routes")}>🧭 {t("Routes", "Rutas")} ({withStops.length})</button>
        <button className={"vt " + (tab === "orders" ? "on" : "")} onClick={() => setTab("orders")}>📦 {t("Unassigned", "Sin asignar")} ({unassigned.length})</button>
        <button className={"vt " + (tab === "scheduled" ? "on" : "")} onClick={() => setTab("scheduled")}>✅ {t("Scheduled", "Programadas")} ({scheduled.length})</button>
        <button className={"vt " + (tab === "board" ? "on" : "")} onClick={() => setTab("board")}>🗂 {t("Board", "Tablero")}</button>
        <button className={"vt " + (tab === "timeline" ? "on" : "")} onClick={() => setTab("timeline")}>📅 {t("Timeline", "Horario")}</button>
        <button className={"vt " + (tab === "incidents" ? "on" : "")} onClick={() => setTab("incidents")}>⚠ {t("Incidents", "Incidencias")} ({incidents.length})</button>
      </div>

      {tab === "incidents" && <DriverIncidents me={me} drivers={drivers} deliveries={deliveries} incidents={incidents} addIncident={addIncident} removeIncident={removeIncident} confirmAction={confirmAction} notify={notify} t={t} />}

      {/* ---------- Scheduled (assigned) orders list ---------- */}
      {tab === "scheduled" && (
        <div className="card" style={{ margin: 0 }}>
          <div className="page-head" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>✅ {t("Scheduled orders", "Órdenes programadas")} <span className="count-tag">{scheduled.length}</span></h2>
            <button className="btn btn-ghost btn-sm" onClick={schedCols.reset} title={t("Reset column widths", "Restablecer anchos")}>↔ {t("Reset columns", "Restablecer columnas")}</button>
          </div>
          {scheduled.length === 0 ? (
            <div className="empty">{t("No orders are assigned to a driver or route yet for this date.", "Aún no hay órdenes asignadas a un chofer o ruta en esta fecha.")}</div>
          ) : (
            <div className="tbl-scroll">
              <table className="orders tbl-resize">
                <colgroup>{schedCols.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                <thead>
                  <tr>
                    <th>{t("ID", "ID")}<span className="col-resizer" onMouseDown={schedCols.startResize(0)} /></th>
                    <th>{t("Account", "Cuenta")}<span className="col-resizer" onMouseDown={schedCols.startResize(1)} /></th>
                    <th>{t("Driver / Route", "Chofer / Ruta")}<span className="col-resizer" onMouseDown={schedCols.startResize(2)} /></th>
                    <th>{t("Load", "Carga")}<span className="col-resizer" onMouseDown={schedCols.startResize(3)} /></th>
                    <th>{t("Stop", "Parada")}<span className="col-resizer" onMouseDown={schedCols.startResize(4)} /></th>
                    <th>{t("Windows", "Ventanas")}<span className="col-resizer" onMouseDown={schedCols.startResize(5)} /></th>
                    <th>{t("Pallets", "Pallets")}<span className="col-resizer" onMouseDown={schedCols.startResize(6)} /></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {scheduled.map((d) => {
                    const laneKey = orderLaneKey(d)!;
                    const seqList = byDriver.get(laneKey) ?? [];
                    const idx = seqList.findIndex((x) => x.id === d.id);
                    const bucket = isBucket(d.assigned_driver || "");
                    return (
                      <tr key={d.id}>
                        <td className="ordno">#{orderLabel(d)}</td>
                        <td>{d.account || "—"}</td>
                        <td>
                          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: colorFor(d.assigned_driver), marginRight: 6, verticalAlign: "-1px", boxShadow: "0 0 0 1px var(--line)" }} />
                          {d.assigned_driver}{bucket ? ` 🧭` : ""}
                        </td>
                        <td>{!bucket && loadNoOf(d) > 1 ? loadNoOf(d) : (bucket ? "—" : 1)}</td>
                        <td>{d.route_seq != null ? idx + 1 : "—"}</td>
                        <td>{fmtWindows(d.delivery_windows)}</td>
                        <td>{d.actual_pallets ?? d.est_pallets ?? "—"}</td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn btn-ghost btn-sm" title={t("Unassign", "Quitar asignación")} onClick={() => manualUnassign(d.id)}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---------- Day timeline (Gantt) ---------- */}
      {tab === "timeline" && (
        <div className="card" style={{ margin: 0 }}>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("Each driver's day by delivery window (07:00–19:00).", "El día de cada chofer por ventana de entrega (07:00–19:00).")}
          </p>
          {ganttRows.length === 0
            ? <div className="empty">{t("No assigned orders to show yet.", "Aún no hay órdenes asignadas.")}</div>
            : <GanttTimeline rows={ganttRows} t={t} />}
        </div>
      )}

      {/* ---------- Drag-and-drop board ---------- */}
      {tab === "board" && (
        <div className="card" style={{ margin: 0 }}>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("Drag an order card onto a driver to assign it, or back to Unassigned to remove it.", "Arrastre una tarjeta a un chofer para asignarla, o de vuelta a Sin asignar para quitarla.")}
          </p>
          <DispatchBoard columns={boardColumns} onMove={boardMove} t={t} lang={lang} onPrint={printManifestFor} />
        </div>
      )}

      {/* ---------- Unassigned pool ---------- */}
      {tab === "orders" && (
      <div className="card" style={{ margin: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => toggleCollapse("__unassigned__")}>
          <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} title={t("Collapse", "Contraer")}>{isCollapsed("__unassigned__") ? "▸" : "▾"}</button>
          <h2 style={{ margin: 0 }}>📦 {t("Unassigned orders", "Órdenes sin asignar")}</h2>
          <span className="count-tag">{unassigned.length}</span>
        </div>
        {!isCollapsed("__unassigned__") && <>
        {singleSel && unassigned.length > 0 && (
          <p className="hint" style={{ marginTop: 8, marginBottom: 10 }}>
            {t(
              `Simulate adds a stop to ${laneLabel(singleSel)}'s day and shows the resulting route before anything is saved.`,
              `Simular agrega una parada al día de ${laneLabel(singleSel)} y muestra la ruta resultante antes de guardar nada.`,
            )}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "10px 0" }}>
          <input
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            placeholder={t("Search # / customer / address / phone…", "Buscar # / cliente / dirección / teléfono…")}
            style={{ maxWidth: 300 }}
          />
          {(["all", "overdue", "windowed", "noloc"] as const).map((f) => (
            <button
              key={f}
              className={"btn btn-sm " + (poolFilter === f ? "btn-primary" : "btn-ghost")}
              onClick={() => setPoolFilter(f)}
            >
              {f === "all" ? t("All", "Todas")
                : f === "overdue" ? t("Overdue", "Atrasadas")
                : f === "windowed" ? t("Windowed", "Con ventana")
                : t("No location", "Sin ubicación")}
            </button>
          ))}
          {selectedOrders.size > 0 && (
            <>
              <span className="count-tag">{selectedOrders.size} {t("selected", "seleccionadas")}</span>
              {poolSelectedCount > 0 && (
                <>
                  <select defaultValue="" disabled={autoAssigning} style={{ width: "auto" }}
                    onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v === "__newroute__") { bulkAssign(addBucket()); } else if (v) bulkAssign(v); }}>
                    <option value="">{t("Assign selected to…", "Asignar selección a…")}</option>
                    {drivers.length > 0 && (
                      <optgroup label={t("Drivers", "Choferes")}>
                        {drivers.map((u) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
                      </optgroup>
                    )}
                    <optgroup label={t("Temp drivers / routes", "Choferes temp / rutas")}>
                      {bucketNames.map((n) => <option key={n} value={n}>🧭 {n}</option>)}
                      <option value="__newroute__">＋ {t("New route…", "Nueva ruta…")}</option>
                    </optgroup>
                  </select>
                  <button className="btn btn-amber btn-sm" onClick={bulkAutoAssign} disabled={autoAssigning}>✨ {t("Auto-assign selected", "Auto-asignar selección")}</button>
                </>
              )}
              <button className="btn btn-ghost btn-sm" onClick={clearSelection}>{t("Clear", "Limpiar")}</button>
            </>
          )}
        </div>
        {unassigned.length === 0 ? (
          <div className="empty">{t("Everything on this date has a driver.", "Todo en esta fecha ya tiene chofer.")}</div>
        ) : unassignedShown.length === 0 ? (
          <div className="empty">{t("No unassigned orders match your search.", "Ninguna orden sin asignar coincide con la búsqueda.")}</div>
        ) : (
          <div className="tbl-scroll" style={{ border: "none" }}>
            <table className="orders tbl-resize">
              <colgroup>{poolCols.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label={t("Select all", "Seleccionar todo")}
                      checked={unassignedShown.length > 0 && unassignedShown.every((d) => selectedOrders.has(d.id))}
                      onChange={(e) => setSelectedOrders((s) => {
                        const n = new Set(s);
                        if (e.target.checked) unassignedShown.forEach((d) => n.add(d.id));
                        else unassignedShown.forEach((d) => n.delete(d.id));
                        return n;
                      })}
                    />
                  </th>
                  <th>{t("ID", "ID")}<span className="col-resizer" onMouseDown={poolCols.startResize(1)} /></th>
                  <th>{t("Account", "Cuenta")}<span className="col-resizer" onMouseDown={poolCols.startResize(2)} /></th>
                  <th>{t("Store", "Tienda")}<span className="col-resizer" onMouseDown={poolCols.startResize(3)} /></th>
                  <th>{t("Pallets", "Pallets")}<span className="col-resizer" onMouseDown={poolCols.startResize(4)} /></th>
                  <th>{t("Delivery Date", "Fecha de Entrega")}<span className="col-resizer" onMouseDown={poolCols.startResize(5)} /></th>
                  <th>{t("Windows", "Ventanas")}<span className="col-resizer" onMouseDown={poolCols.startResize(6)} /></th>
                  <th>{t("Status", "Estado")}<span className="col-resizer" onMouseDown={poolCols.startResize(7)} /></th>
                  <th>{singleSel ? t("Add to", "Agregar a") : t("Assign to", "Asignar a")}</th>
                </tr>
              </thead>
              <tbody>
                {unassignedShown.map((d) => {
                  const s = stageInfo(d.stage);
                  return (
                    <tr key={d.id} className={selectedOrders.has(d.id) ? "row-selected" : ""} onClick={() => toggleOrder(d.id)} style={{ cursor: "pointer" }}>
                      <td>
                        <input type="checkbox" checked={selectedOrders.has(d.id)} readOnly aria-label={`#${orderLabel(d)}`} />
                        {selectedOrders.has(d.id) && <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: selColorById.get(d.id), marginLeft: 5, verticalAlign: "middle", boxShadow: "0 0 0 1px var(--line)" }} />}
                      </td>
                      <td className="ordno">#{orderLabel(d)}</td>
                      <td>{d.account || "—"}</td>
                      <td>{d.store || "—"}</td>
                      <td>{d.actual_pallets ?? d.est_pallets ?? "—"}</td>
                      <td onClick={(e) => e.stopPropagation()}><DateCell d={d} date={date} onChange={reschedule} t={t} /></td>
                      <td>{fmtWindows(d.delivery_windows)}</td>
                      <td><span className="sema" style={{ background: s.color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                          {/* Assign is ALWAYS available; Simulate is an extra when one lane is focused. */}
                          <select defaultValue="" onChange={(e) => {
                            const v = e.target.value; e.currentTarget.value = "";
                            if (!v) return;
                            const target = v === "__newroute__" ? addBucket() : v;
                            // If this row is part of a multi-selection, assign the WHOLE selection.
                            if (selectedOrders.has(d.id) && selectedOrders.size > 1) bulkAssign(target);
                            else manualAssign(d.id, target);
                          }} style={{ width: "auto" }}>
                            <option value="">{t("Assign to…", "Asignar a…")}</option>
                            {drivers.length > 0 && (
                              <optgroup label={t("Drivers", "Choferes")}>
                                {drivers.map((u) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
                              </optgroup>
                            )}
                            <optgroup label={t("Temp drivers / routes", "Choferes temp / rutas")}>
                              {bucketNames.map((n) => <option key={n} value={n}>🧭 {n}</option>)}
                              <option value="__newroute__">＋ {t("New route…", "Nueva ruta…")}</option>
                            </optgroup>
                          </select>
                          {/* One-tap assign to the suggested driver (same store + free capacity). */}
                          {(() => {
                            const sug = suggestDriverFor(d);
                            return sug ? (
                              <button className="btn btn-ghost btn-sm" style={{ color: "var(--green)" }}
                                title={t(`Assign to ${sug} (same store, has room)`, `Asignar a ${sug} (misma tienda, con espacio)`)}
                                onClick={() => manualAssign(d.id, sug)}>💡 {sug}</button>
                            ) : null;
                          })()}
                          {singleSel && (
                            <button
                              className="btn btn-ghost btn-sm"
                              disabled={previewBusy === d.id || busyDriver != null}
                              title={t(`Preview adding this stop to ${laneLabel(singleSel)}`, `Previsualizar agregar esta parada a ${laneLabel(singleSel)}`)}
                              onClick={() => previewAdd(d, singleSel)}
                            >
                              {previewBusy === d.id ? "…" : "🔮"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </>}
      </div>
      )}

      {/* ---------- Per-driver routes ---------- */}
      {tab === "routes" && (
      <div style={{ display: "grid", gridTemplateColumns: wideRoutes ? "minmax(0, 1fr)" : "repeat(auto-fit, minmax(440px, 1fr))", gap: 14, alignItems: "start" }}>
      {shownDrivers.length === 0 && (
        <div className="card" style={{ margin: 0 }}>
          <div className="empty">{t("No routes yet — assign orders to drivers in the Unassigned tab, or select drivers on the left.", "Aún sin rutas — asigna órdenes a los choferes en la pestaña Sin asignar, o selecciona choferes a la izquierda.")}</div>
        </div>
      )}
      {shownDrivers.map((u) => {
        const stops = byDriver.get(u.key) ?? [];
        const sequenced = stops.length > 0 && stops.every((d) => d.route_seq != null);
        const missingPins = stops.filter((d) => d.delivery_lat == null).length;
        const info = routeInfo[u.key];
        const capacity = capacityFor(u.driver);
        const trips = buildTrips(stops, capacity);
        // A load a person pinned; the optimizer won't regroup those.
        const pinnedLoads = stops.some((d) => (d.load_no ?? 1) > 1 && !d.load_auto);
        const isC = isCollapsed(u.key);
        const bucket = u.isBucket;
        // A route that isn't on a real driver (a bucket, or one recovered under
        // a stale name) can be handed to a driver.
        const needsDriver = !isRealDriver(u.driver);
        // Stops whose optimized ETA lands after the delivery window closes —
        // surfaced as a banner so the dispatcher acts before dispatch, not just
        // as a red cell buried in the table.
        const lateStops = stops.filter((d) => {
          const eta = routeEtas[u.key]?.[d.id];
          const win = parseWindow(d.delivery_windows);
          const etaMin = eta ? parseInt(eta.slice(0, 2), 10) * 60 + parseInt(eta.slice(3, 5), 10) : null;
          return etaMin != null && win != null && etaMin > win[1];
        });
        // Tapping anywhere on the card that isn't a stop row drops the
        // single-stop focus, so the map goes back to this driver's whole day.
        // That's the "tap outside" way back out.
        return (
          <div className="card" key={u.id} style={{ margin: 0 }} onClick={() => setSelectedOrders((prev) => (prev.size ? new Set() : prev))}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} onClick={() => toggleCollapse(u.key)} title={t("Collapse", "Contraer")}>{isC ? "▸" : "▾"}</button>
              <span
                onClick={() => focusOnly(u.key)}
                title={t("Show this route on the map", "Mostrar esta ruta en el mapa")}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}
              >
                <span style={{ width: 14, height: 14, borderRadius: "50%", background: colorFor(u.driver), border: "2px solid #fff", boxShadow: "0 0 0 1px var(--line)", flex: "0 0 auto" }} />
                <h2 style={{ margin: 0 }}>{u.label}</h2>
                <span className="hint" style={{ fontSize: 12 }}>🗺</span>
              </span>
              {needsDriver && <span className="sema" style={{ background: "var(--accent)", color: "#fff" }}>🧭 {t("route (no driver)", "ruta (sin chofer)")}</span>}
              {bucket && <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} title={t("Rename temp driver", "Renombrar chofer temp")} onClick={() => renameBucket(u.key)}>✏</button>}
              <span className="count-tag">{stops.length} {t("stops", "paradas")}</span>
              {stops.length > 0 && trips.length > 1 && (
                <span className="sema" style={{ background: "var(--amber)", color: "#fff" }}>{trips.length} {t("truckloads", "viajes")}</span>
              )}
              {/* Says who decided the grouping, because it decides what
                  Optimize is allowed to change. Without this the button looks
                  broken when it deliberately leaves a hand-made split alone. */}
              {stops.length > 0 && trips.length > 1 && (
                pinnedLoads ? (
                  <span className="sema" style={{ background: "var(--card-hover)", color: "var(--ink-soft)" }}
                    title={t("You grouped these truckloads, so optimizing only reorders the stops inside them. Use “Combine loads” to let it regroup by area.", "Usted agrupó estos viajes, así que optimizar solo reordena las paradas dentro de ellos. Use “Unir viajes” para que los reagrupe por zona.")}>
                    📌 {t("loads pinned by you", "viajes fijados por usted")}
                  </span>
                ) : (
                  <span className="sema" style={{ background: "var(--card-hover)", color: "var(--ink-soft)" }}
                    title={t("Stops were grouped onto trucks by area, so nearby deliveries ride together.", "Las paradas se agruparon en camiones por zona, para que las entregas cercanas viajen juntas.")}>
                    🧩 {t("grouped by area", "agrupado por zona")}
                  </span>
                )
              )}
              {info && (
                <span
                  className="hint"
                  style={{ marginTop: 0 }}
                  title={t(
                    `${info.duration_text} driving; the rest is unloading and reloading between truckloads`,
                    `${info.duration_text} manejando; el resto es descarga y recarga entre viajes`,
                  )}
                >
                  · {info.miles} mi · {info.dayText} {t("day", "jornada")} ({info.duration_text} {t("drive", "manejo")})
                </span>
              )}
              {/* Measured against the WHOLE day. Judging an 8-hour shift on
                  wheel time alone hid every route that only busts the day
                  once you count unloading. */}
              {info && info.dayMinutes > 8 * 60 && (
                <span className="sema" style={{ background: "var(--red)", color: "#fff" }} title={t("Driving, unloading and reloading run past an 8-hour day", "Manejo, descarga y recarga pasan de una jornada de 8 horas")}>
                  ⚠ {t("over 8 h day", "más de 8 h")}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--gray)" }}>
                🚚 {t("Truck capacity", "Capacidad del camión")}
                <input
                  type="number" min={1} value={capacity}
                  onChange={(e) => { const v = Number(e.target.value); if (v > 0) setCapacity(u.driver, v); }}
                  style={{ width: 60 }}
                />
                {t("plt", "trm")}
              </label>
              <button className="btn btn-primary btn-sm" disabled={stops.length < 2 || busyDriver === u.key} onClick={() => optimize(u.key)}>
                {busyDriver === u.key ? "…" : `🧭 ${t("Optimize route", "Optimizar ruta")}`}
              </button>
              {needsDriver && (
                <select
                  defaultValue=""
                  disabled={stops.length === 0 || drivers.length === 0}
                  title={t("Hand this whole route to a driver", "Entregar toda esta ruta a un chofer")}
                  onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v) assignRouteToDriver(u.key, v); }}
                  style={{ width: "auto" }}
                >
                  <option value="">👤 {t("Assign route to…", "Asignar ruta a…")}</option>
                  {drivers.map((dv) => <option key={dv.id} value={dv.full_name}>{dv.full_name}</option>)}
                </select>
              )}
              {hasManualLoads(stops) ? (
                <>
                  {pinnedLoads && stops.length >= 2 && (
                    <button className="btn btn-ghost btn-sm" disabled={busyDriver === u.key}
                      title={t("Drop your truckloads and let the optimizer regroup the stops by area", "Descartar sus viajes y dejar que el optimizador reagrupe las paradas por zona")}
                      onClick={() => regroupByArea(u.key)}>🧩 {t("Regroup by area", "Reagrupar por zona")}</button>
                  )}
                  <button className="btn btn-ghost btn-sm" title={t("Merge all truckloads back into one", "Unir todos los viajes en uno")}
                    onClick={() => combineLoads(u.key)}>🔗 {t("Combine loads", "Unir viajes")}</button>
                </>
              ) : trips.length === 1 && stops.length >= 2 && (
                <button className="btn btn-ghost btn-sm" title={t("Split this truckload into two", "Dividir este viaje en dos")}
                  onClick={() => splitLoads(u.key)}>✂ {t("Split into 2", "Dividir en 2")}</button>
              )}
              {stops.length > 0 && (
                <button className="btn btn-danger btn-sm" title={t("Clear this route — send every stop back to Unassigned", "Vaciar esta ruta — devolver todas las paradas a Sin asignar")}
                  onClick={() => clearLane(u.key)}>🗑 {t("Clear", "Vaciar")}</button>
              )}
            </div>
            {!isC && <>
            {lateStops.length > 0 && (
              <div className="card" style={{ marginBottom: 8, background: "#fef6f6", borderColor: "var(--red)" }}>
                <b style={{ color: "var(--red)" }}>⚠️ {t(`${lateStops.length} stop(s) will miss their delivery window`, `${lateStops.length} parada(s) no llegarán a tiempo a su ventana`)}</b>
                <div className="hint" style={{ marginTop: 2 }}>
                  {lateStops.slice(0, 6).map((d) => `#${orderLabel(d)}${d.account ? ` (${d.account})` : ""}`).join(", ")}{lateStops.length > 6 ? "…" : ""}
                  {" — "}{t("reorder the stops or move some to another driver.", "reordene las paradas o mueva algunas a otro chofer.")}
                </div>
              </div>
            )}
            {info && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t("Total (loop from pickup and back)", "Total (ciclo desde recolección y regreso)")}: <b>{info.miles} mi</b> · <b>{info.dayText}</b> {t("on the clock", "de jornada")} ({info.duration_text} {t("driving", "manejando")})
                {info.trips > 1 && ` · ${info.trips} ${t("round trips back to pickup to reload", "viajes de ida y vuelta a recolección para recargar")}`}
              </div>
            )}
            {trips.length > 1 && (() => {
              const load = stops.reduce((s, d) => s + Number(d.actual_pallets ?? d.est_pallets ?? 0), 0);
              return (
                <div className="hint" style={{ marginBottom: 8, color: "var(--accent)" }}>
                  💡 {t(
                    `This is over the ${capacity}-pallet truck capacity (${load} on board), so it reloads at the pickup between loads. Raise the truck capacity to ${load} or more to carry it all in one trip (drop → drop).`,
                    `Supera la capacidad de ${capacity} pallets del camión (${load} a bordo), por eso recarga en la recolección entre cargas. Sube la capacidad a ${load} o más para llevar todo en un solo viaje (parada → parada).`,
                  )}
                </div>
              );
            })()}
            {stops.length === 0 && (
              <div className="empty">
                {t("No stops yet — pick this driver and use “Simulate add” on an unassigned order above.", "Aún sin paradas — con este chofer seleccionado use “Simular” en una orden sin asignar arriba.")}
              </div>
            )}
            {!u.store && stops.length > 0 && trips.length > 1 && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t(
                  "This driver has no home store assigned (Users), so trips can't be anchored to a depot — optimizing will run one open route instead of round trips.",
                  "Este chofer no tiene tienda asignada (Usuarios), así que los viajes no pueden anclarse a un depósito — al optimizar se hará una sola ruta abierta en vez de viajes de ida y vuelta.",
                )}
              </div>
            )}
            {stops.length > 0 && !sequenced && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t("Not optimized yet — run “Optimize route” to get a sequence.", "Aún no optimizada — ejecute “Optimizar ruta” para obtener una secuencia.")}
              </div>
            )}
            {missingPins > 0 && (() => {
              const noPin = stops.filter((d) => d.delivery_lat == null);
              return (
                <div className="card" style={{ marginBottom: 8, background: "#fff7ec", borderColor: "var(--amber)" }}>
                  <b style={{ color: "#b9791a" }}>📍 {t(`${missingPins} stop(s) aren't on the map yet, so the route skips them.`, `${missingPins} parada(s) aún no están en el mapa, así que la ruta las omite.`)}</b>
                  <div className="hint" style={{ marginTop: 2 }}>
                    {noPin.map((d) => `#${orderLabel(d)}${d.account ? ` (${d.account})` : ""}${d.delivery_address ? "" : " — " + t("no delivery address", "sin dirección de entrega")}`).join(", ")}
                    {" — "}{t("give each a valid delivery address (or drop a map pin) on the Orders page so it geocodes, then re-optimize.", "dé a cada una una dirección de entrega válida (o coloque un pin) en Órdenes para que se ubique, y vuelva a optimizar.")}
                  </div>
                </div>
              );
            })()}
            {stops.length > 0 && (
              <div className="tbl-scroll" style={{ border: "none" }}>
                {/* Address stays on one line (narrow by default) with an
                    expand/contract toggle, so Windows + the action arrows never
                    get pushed off the right edge. Width pinned to the column
                    sum; columns still draggable. */}
                <table className="orders tbl-resize" style={{ width: stopCols.widths.reduce((sum, w, i) => sum + (i === 4 ? (addrWide ? w : 112) : w), 0) }}>
                  <colgroup>{stopCols.widths.map((w, i) => <col key={i} style={{ width: i === 4 ? (addrWide ? w : 112) : w }} />)}</colgroup>
                  <thead>
                    <tr>
                      <th>#<span className="col-resizer" onMouseDown={stopCols.startResize(0)} /></th>
                      <th>{t("ID", "ID")}<span className="col-resizer" onMouseDown={stopCols.startResize(1)} /></th>
                      <th>{t("Type", "Tipo")}<span className="col-resizer" onMouseDown={stopCols.startResize(2)} /></th>
                      <th title={t("Pallets on this stop", "Pallets de esta parada")}>{t("Pallets", "Pallets")}<span className="col-resizer" onMouseDown={stopCols.startResize(3)} /></th>
                      <th>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ padding: "0 5px", minHeight: 0, marginRight: 4 }}
                          title={addrWide ? t("Contract address", "Contraer dirección") : t("Expand address", "Expandir dirección")}
                          onClick={() => setAddrWide((v) => !v)}
                        >{addrWide ? "⤡" : "⤢"}</button>
                        {t("Address", "Dirección")}
                        {addrWide && <span className="col-resizer" onMouseDown={stopCols.startResize(4)} />}
                      </th>
                      <th>{t("ETA", "Llegada")}<span className="col-resizer" onMouseDown={stopCols.startResize(5)} /></th>
                      <th>{t("Windows", "Ventanas")}<span className="col-resizer" onMouseDown={stopCols.startResize(6)} /></th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.map((batch, ti) => {
                      const startIdx = trips.slice(0, ti).reduce((n, b) => n + b.length, 0);
                      const load = batch.reduce((n, d) => n + (d.actual_pallets ?? d.est_pallets ?? 0), 0);
                      const free = Math.max(0, capacity - load);
                      const tColor = tripColor(colorFor(u.driver), ti);
                      const ts = routeTrips[u.key]?.[ti];
                      const doneN = batch.filter((d) => d.stage === "delivered").length;
                      // A stop with no pallet figure adds 0 to the total, so
                      // the load looks lighter than it is — say so rather than
                      // let a truck get planned on an undercount.
                      const noCount = batch.filter((d) => d.actual_pallets == null && d.est_pallets == null).length;
                      const estimated = batch.some((d) => d.actual_pallets == null && d.est_pallets != null);
                      return (
                        <Fragment key={ti}>
                          <tr>
                            <td colSpan={8} style={{ background: "var(--card-hover)", fontWeight: 700, fontSize: 12 }}>
                              <span style={{ display: "inline-block", width: 11, height: 11, borderRadius: 3, background: tColor, marginRight: 7, verticalAlign: "-1px", boxShadow: "0 0 0 1px var(--line)" }} />
                              🚚 {t("Truckload", "Viaje")} {ti + 1} — {estimated ? "~" : ""}{load}/{capacity} {t("pallets", "pallets")}
                              {noCount > 0 && (
                                <span style={{ color: "var(--amber)", marginLeft: 6, fontWeight: 600 }}
                                  title={t("These stops have no pallet count, so the load total is lower than reality.", "Estas paradas no tienen conteo de pallets, así que el total del viaje es menor que la realidad.")}>
                                  ⚠ {noCount} {t("without a count", "sin conteo")}
                                </span>
                              )}
                              {/* Capacity bar: fills with the load, turns red when over. */}
                              <span title={`${load}/${capacity}`} style={{ display: "inline-block", width: 84, height: 7, borderRadius: 999, background: "var(--line)", verticalAlign: "middle", margin: "0 8px", overflow: "hidden" }}>
                                <span style={{ display: "block", height: "100%", width: `${Math.min(100, capacity > 0 ? (load / capacity) * 100 : 0)}%`, background: load > capacity ? "var(--red)" : tColor }} />
                              </span>
                              · {t("loads at pickup ↺", "carga en recolección ↺")}
                              {free > 0 && <span style={{ color: "var(--green)", marginLeft: 6 }}>({free} {t("free", "libres")})</span>}
                              {load > capacity && <span style={{ color: "var(--red)", marginLeft: 6 }}>⚠ {t("over capacity", "sobre capacidad")}</span>}
                              {/* What THIS load costs: the drive plus the time
                                  the truck stands still being unloaded, which
                                  each order already carries as its duration. */}
                              {ts && (
                                <span
                                  style={{ marginLeft: 8, fontWeight: 600, color: "var(--ink-soft)" }}
                                  title={t(
                                    `${ts.miles} mi · ${fmtMinutes(ts.driveMin)} driving + ${fmtMinutes(ts.serviceMin)} unloading at ${ts.stops} stops`,
                                    `${ts.miles} mi · ${fmtMinutes(ts.driveMin)} manejando + ${fmtMinutes(ts.serviceMin)} descargando en ${ts.stops} paradas`,
                                  )}
                                >
                                  ⇥ {ts.miles} mi · ⏱ {fmtMinutes(ts.totalMin)}
                                  <span style={{ fontWeight: 400, color: "var(--gray)" }}>
                                    {" "}({fmtMinutes(ts.driveMin)} {t("drive", "manejo")} + {fmtMinutes(ts.serviceMin)} {t("unload", "descarga")}) · {ts.start}–{ts.end}
                                  </span>
                                </span>
                              )}
                              {/* Progress fills in as stops get delivered. */}
                              {doneN > 0 && (
                                <span className="sema" style={{ marginLeft: 8, background: doneN === batch.length ? "var(--green)" : "#e9f7f0", color: doneN === batch.length ? "#fff" : "var(--green)" }}>
                                  {doneN === batch.length ? `✓ ${t("load delivered", "viaje entregado")}` : `${doneN}/${batch.length} ${t("delivered", "entregadas")}`}
                                </span>
                              )}
                              {/* Reorder whole truckloads — which load goes out first. */}
                              {trips.length > 1 && (
                                <span style={{ float: "right", display: "inline-flex", gap: 3 }}>
                                  <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }}
                                    disabled={ti === 0} onClick={() => moveTrip(u.key, ti, -1)}
                                    title={t("Move this truckload earlier", "Adelantar este viaje")}>↑</button>
                                  <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }}
                                    disabled={ti === trips.length - 1} onClick={() => moveTrip(u.key, ti, 1)}
                                    title={t("Move this truckload later", "Retrasar este viaje")}>↓</button>
                                </span>
                              )}
                            </td>
                          </tr>
                          {batch.map((d, bi) => {
                            const i = startIdx + bi;
                            // Flag a stop whose optimized ETA lands after its window closes.
                            const eta = routeEtas[u.key]?.[d.id];
                            const win = parseWindow(d.delivery_windows);
                            const etaMin = eta ? parseInt(eta.slice(0, 2), 10) * 60 + parseInt(eta.slice(3, 5), 10) : null;
                            const late = etaMin != null && win != null && etaMin > win[1];
                            // Stops are reordered with the ↑/↓ arrows only —
                            // row dragging was removed on request.
                            //
                            // Three levels of detail, by where you tap:
                            //   the ID   → open the order itself
                            //   the row  → isolate this stop on the map, with its route
                            //   outside  → back to the driver's whole day
                            const isolated = selectedOrders.has(d.id) && selectedOrders.size === 1;
                            return (
                              <tr
                                key={d.id}
                                // Delivered stops tint green, so the route
                                // visibly fills in over the day. Isolating a
                                // stop still wins — that's a deliberate pick.
                                className={`clickable${d.stage === "delivered" && !isolated ? " row-done" : ""}`}
                                style={isolated ? { background: "var(--accent-soft)" } : undefined}
                                // Stop here: without this the click also reaches
                                // the card's "tap outside" handler, which sees a
                                // selection already set and clears it — so moving
                                // from one stop to the next took two clicks.
                                onClick={(e) => { e.stopPropagation(); setSelectedOrders(isolated ? new Set() : new Set([d.id])); }}
                                title={t("Show this stop on the map", "Ver esta parada en el mapa")}
                              >
                                <td style={{ borderLeft: `4px solid ${tColor}` }}>{d.route_seq != null ? i + 1 : "—"}</td>
                                <td
                                  className="ordno"
                                  onClick={(e) => { e.stopPropagation(); setOpenOrder(d); }}
                                  style={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}
                                  title={t("Open this order", "Abrir esta orden")}
                                >#{orderLabel(d)}</td>
                                <td title={d.order_type || undefined}>{d.order_type || "—"}</td>
                                {/* Where the truckload's pallet total comes
                                    from. An estimate is marked so nobody plans
                                    capacity on a guess thinking it's counted. */}
                                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                  {d.actual_pallets != null ? (
                                    <b title={t("Counted", "Contado")}>{d.actual_pallets}</b>
                                  ) : d.est_pallets != null ? (
                                    <span style={{ color: "var(--gray)" }} title={t("Estimate — not counted yet", "Estimado — aún sin contar")}>~{d.est_pallets}</span>
                                  ) : (
                                    <span style={{ color: "var(--amber)" }} title={t("No pallet count — this stop adds nothing to the load total", "Sin conteo de pallets — esta parada no suma al total del viaje")}>—</span>
                                  )}
                                </td>
                                <td title={d.delivery_address || undefined}>{d.delivery_address || "—"}</td>
                                <td style={{ fontWeight: 600, color: late ? "var(--red)" : undefined }} title={late ? t("ETA is after the delivery window", "La llegada es después de la ventana") : undefined}>
                                  {eta ?? "—"}{late ? " ⚠️" : ""}
                                </td>
                                <td>{fmtWindows(d.delivery_windows)}</td>
                                {/* Reordering and moving loads are edits, not
                                    "show me this" — they must not also hijack
                                    the map to this one stop. */}
                                <td onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 3, justifyContent: "flex-end", alignItems: "center", overflow: "visible" }}>
                                  {/* Hand-arrange the stops — works even before the route is optimized. */}
                                  <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} disabled={i === 0} onClick={() => move(u.key, i, -1)} title={t("Move up", "Subir")}>↑</button>
                                  <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} disabled={i === stops.length - 1} onClick={() => move(u.key, i, 1)} title={t("Move down", "Bajar")}>↓</button>
                                  {/* Move this stop to another truckload/pickup of the same driver. */}
                                  <select
                                    // Show the truckload this stop is ACTUALLY in (ti+1 = the
                                    // section it's rendered under), not its raw load_no — which
                                    // stays 1 for all when the split is auto (by capacity).
                                    value={ti + 1}
                                    title={t("Move to another truckload", "Mover a otro viaje")}
                                    onChange={(e) => { const v = e.target.value; moveStopToLoad(d, v === "__new__" ? trips.length + 1 : Number(v)); }}
                                    style={{ width: "auto", padding: "2px 4px", fontSize: 12 }}
                                  >
                                    {Array.from({ length: Math.max(trips.length, maxLoadForDriver(u.driver)) }, (_, k) => k + 1).map((n) => (
                                      <option key={n} value={n}>{t("Truckload", "Viaje")} {n}</option>
                                    ))}
                                    <option value="__new__">＋ {t("New truckload", "Nuevo viaje")}</option>
                                  </select>
                                  <button className="btn btn-danger btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} onClick={() => unassign(d.id)} title={t("Unassign", "Quitar asignación")}>✕</button>
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </>}
          </div>
        );
      })}
      </div>
      )}

      {!ready && <div className="empty">{t("Loading…", "Cargando…")}</div>}

      {openOrder && <OrderModal me={me} existing={openOrder} startEditing={false} onClose={() => setOpenOrder(null)} />}
    </>
  );
}

/** Delivery date cell: plain text for an order due on the day being viewed;
 * an editable date input (with a "Late" flag) for one carried forward from
 * a past date that was never delivered — the one field logistics can change
 * here, and only here. Leaving it alone still dispatches it today. */
function DateCell({
  d, date, onChange, t,
}: {
  d: Delivery;
  date: string;
  onChange: (id: string, delivery_date: string) => void;
  t: (en: string, es: string) => string;
}) {
  if (d.delivery_date === date) return <>{fmtDate(d.delivery_date)}</>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="sema" style={{ background: "var(--red)", color: "#fff" }}>{t("Late", "Atrasada")}</span>
      <input
        type="date"
        value={d.delivery_date ?? ""}
        onChange={(e) => e.target.value && onChange(d.id, e.target.value)}
        style={{ width: "auto" }}
      />
    </div>
  );
}

// ============================================================
// Driver incident log — the logistics manager records something a driver did
// that cost the company money (a wasted round trip, damage, inefficiency from a
// bad attitude). Each entry has a driver, date, description, and estimated cost,
// and can optionally be tied to a specific order. Only reachable from the Routes
// Manager (logistics/admin), so it's gated by the page's own role access.
// ============================================================
function DriverIncidents({
  me, drivers, deliveries, incidents, addIncident, removeIncident, confirmAction, notify, t,
}: {
  me: Profile;
  drivers: Profile[];
  deliveries: Delivery[];
  incidents: DriverIncident[];
  addIncident: (inc: Omit<DriverIncident, "id" | "created_at" | "created_by">) => Promise<boolean>;
  removeIncident: (id: string) => Promise<void>;
  confirmAction: (message: string, opts?: { danger?: boolean; confirmLabel?: string }) => Promise<boolean>;
  notify: (m: string) => void;
  t: (en: string, es: string) => string;
}) {
  const [driver, setDriver] = useState("");
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);

  // Orders you can attach an incident to: the chosen driver's, most recent first.
  const attachable = useMemo(
    () => deliveries
      .filter((d) => !driver || d.assigned_driver === driver)
      .sort((a, b) => (b.delivery_date ?? "").localeCompare(a.delivery_date ?? ""))
      .slice(0, 60),
    [deliveries, driver],
  );

  const submit = async () => {
    if (!driver) { notify(t("Choose a driver.", "Elija un chofer.")); return; }
    if (!description.trim()) { notify(t("Describe what happened.", "Describa lo que pasó.")); return; }
    setBusy(true);
    const ok = await addIncident({
      driver_name: driver,
      delivery_id: orderId || null,
      incident_date: date || todayISO(),
      description: description.trim(),
      cost: Math.max(0, Number(cost) || 0),
    });
    setBusy(false);
    if (ok) {
      notify(t("Incident recorded", "Incidencia registrada"));
      setDescription(""); setCost(""); setOrderId("");
    }
  };

  const del = async (inc: DriverIncident) => {
    const ok = await confirmAction(
      t(`Delete this incident for ${inc.driver_name}?`, `¿Eliminar esta incidencia de ${inc.driver_name}?`),
      { danger: true, confirmLabel: t("Delete", "Eliminar") },
    );
    if (ok) await removeIncident(inc.id);
  };

  // Total logged cost per driver, for a quick at-a-glance tally.
  const totals = useMemo(() => {
    const m = new Map<string, { count: number; cost: number }>();
    for (const inc of incidents) {
      const cur = m.get(inc.driver_name) ?? { count: 0, cost: 0 };
      cur.count += 1; cur.cost += Number(inc.cost) || 0;
      m.set(inc.driver_name, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost);
  }, [incidents]);

  const grandTotal = incidents.reduce((s, i) => s + (Number(i.cost) || 0), 0);
  const codeFor = (id: string | null) => {
    if (!id) return null;
    const d = deliveries.find((x) => x.id === id);
    return d ? orderLabel(d) : null;
  };

  return (
    <div className="card" style={{ margin: 0 }}>
      <h3 style={{ marginTop: 0 }}>⚠ {t("Driver incidents", "Incidencias de choferes")}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {t(
          "Log anything a driver did that cost the company money — a wasted round trip, damage, or lost time. Used to review performance; only the logistics manager and admins see this.",
          "Registre cualquier cosa que un chofer haya hecho que le costó dinero a la empresa — un viaje repetido, daños o tiempo perdido. Se usa para evaluar el desempeño; solo lo ven el gerente de logística y administradores.",
        )}
      </p>

      {/* ---- New incident ---- */}
      <div className="grid g2" style={{ gap: 10 }}>
        <div className="field">
          <label>{t("Driver", "Chofer")}</label>
          <select value={driver} onChange={(e) => { setDriver(e.target.value); setOrderId(""); }}>
            <option value="">{t("Choose…", "Elegir…")}</option>
            {drivers.map((d) => <option key={d.id} value={d.full_name}>{d.full_name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{t("Date", "Fecha")}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>{t("What happened", "Qué pasó")}</label>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("e.g. Left to a delivery before planning the day and had to drive back to the same area for the next stop.", "ej. Salió a una entrega sin planear el día y tuvo que regresar a la misma zona para la siguiente parada.")}
        />
      </div>
      <div className="grid g2" style={{ gap: 10 }}>
        <div className="field">
          <label>{t("Estimated cost ($)", "Costo estimado ($)")}</label>
          <input type="number" min={0} step="1" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
        </div>
        <div className="field">
          <label>{t("Related order (optional)", "Orden relacionada (opcional)")}</label>
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">{t("None", "Ninguna")}</option>
            {attachable.map((d) => (
              <option key={d.id} value={d.id}>#{orderLabel(d)} · {d.account || "—"}{d.delivery_date ? ` · ${fmtDate(d.delivery_date)}` : ""}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "…" : t("Record incident", "Registrar incidencia")}</button>
      </div>

      {/* ---- Per-driver tally ---- */}
      {totals.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="section-label" style={{ marginTop: 0 }}>{t("Cost by driver", "Costo por chofer")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {totals.map(([name, v]) => (
              <span key={name} className="sema" style={{ background: "#fff1f0", color: "#a10e0e", border: "1px solid #f0c0bd" }}>
                {name}: {fmtMoney(v.cost)} · {v.count}
              </span>
            ))}
            <span className="sema" style={{ background: "#3a2a00", color: "#ffd98a" }}>{t("Total", "Total")}: {fmtMoney(grandTotal)}</span>
          </div>
        </div>
      )}

      {/* ---- Log ---- */}
      <div style={{ marginTop: 18 }}>
        <div className="section-label" style={{ marginTop: 0 }}>{t("Log", "Registro")} ({incidents.length})</div>
        {incidents.length === 0 ? (
          <div className="hint">{t("No incidents recorded.", "Sin incidencias registradas.")}</div>
        ) : (
          <div className="tbl-scroll">
            <table className="orders">
              <thead>
                <tr>
                  <th>{t("Date", "Fecha")}</th>
                  <th>{t("Driver", "Chofer")}</th>
                  <th>{t("What happened", "Qué pasó")}</th>
                  <th>{t("Order", "Orden")}</th>
                  <th style={{ textAlign: "right" }}>{t("Cost", "Costo")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc) => (
                  <tr key={inc.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(inc.incident_date)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{inc.driver_name}</td>
                    <td>{inc.description}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{codeFor(inc.delivery_id) ? `#${codeFor(inc.delivery_id)}` : "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{fmtMoney(Number(inc.cost) || 0)}</td>
                    <td style={{ textAlign: "right" }}>
                      {(me.role === "admin" || inc.created_by === me.id) && (
                        <button className="btn btn-sm btn-ghost" onClick={() => del(inc)} title={t("Delete", "Eliminar")}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
