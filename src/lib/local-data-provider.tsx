"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ctx, type DataState } from "@/lib/data-provider";
import type { Delivery, DriverAvailability, DriverIncident, DriverLocation, DriverShift, OrderEvent, Profile, Settings, Stage } from "@/lib/types";
import { type AppNotification, notificationsForStage } from "@/lib/notifications";
import { canTransition } from "@/lib/constants";
import { orderOwner, todayISO } from "@/lib/utils";
import { nextOrderCode } from "@/lib/order-code";
import { deviceId } from "@/lib/device-id";
import { DEMO_USERS, demoDeliveries, demoNotifications, demoSettings, uid } from "@/lib/demo-data";

// ============================================================
// LOCAL DEMO MODE — no backend. Everything is kept in the browser
// (localStorage) so the app is fully usable offline. Same UI, same
// useData() contract as the Supabase-backed DataProvider.
// ============================================================

// Bump this suffix whenever the seed shape changes so existing browsers
// auto-reseed with the richer sample data on next load.
const LS_KEY = "rtg_deliveries_local_v13";

interface Store {
  settings: Settings;
  users: Profile[];
  deliveries: Delivery[];
  events: OrderEvent[];
  notifications: AppNotification[];
  availability: DriverAvailability[];
  shifts: DriverShift[];
  incidents: DriverIncident[];
}

function seed(): Store {
  const settings = demoSettings();
  const deliveries = demoDeliveries(settings);
  return { settings, users: DEMO_USERS, deliveries, events: [], notifications: demoNotifications(deliveries), availability: [], shifts: [], incidents: [] };
}

function load(): Store {
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* corrupt — reseed */
  }
  const s = seed();
  window.localStorage.setItem(LS_KEY, JSON.stringify(s));
  return s;
}

export function resetLocalData() {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LS_KEY, JSON.stringify(seed()));
    window.location.reload();
  }
}

export function LocalDataProvider({ children, me }: { children: React.ReactNode; me: Profile }) {
  const [store, setStore] = useState<Store>(() => (typeof window === "undefined" ? seed() : { settings: seed().settings, users: DEMO_USERS, deliveries: [], events: [], notifications: [], availability: [], shifts: [], incidents: [] }));
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirror of `store` that is updated SYNCHRONOUSLY on every write.
  //
  // setStore() is async: React doesn't re-render until the current task yields,
  // so a caller doing several mutations in a row (a bulk action looping over
  // `await setStage(...)`) would read the same stale state every iteration and
  // each write would clobber the last — only the final order would stick.
  // Every mutation reads from this ref instead, so sequential writes compose.
  const storeRef = useRef<Store>(store);

  const commit = useCallback((next: Store) => {
    storeRef.current = next;
    setStore(next);
    if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, JSON.stringify(next));
  }, []);

  // Load from localStorage on mount (client only).
  useEffect(() => {
    const s = load();
    storeRef.current = s;
    setStore(s);
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_KEY) return;
      const fresh = load();
      storeRef.current = fresh;
      setStore(fresh);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /** Apply a change to the freshest store and persist it. */
  const persist = useCallback((next: Store) => commit(next), [commit]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  const addEvent = (s: Store, deliveryId: string, kind: string, note?: string): OrderEvent[] => [
    { id: uid(), delivery_id: deliveryId, kind, note: note ?? null, created_by: me.id, created_at: new Date().toISOString() },
    ...s.events,
  ];

  // Fan a stage change out to the people who need to act next.
  const addNotifs = (
    s: Store,
    args: { stage: Stage; order_no: number | null; order_code?: string | null; delivery_id: string; creatorId: string | null; reason?: string | null },
  ): AppNotification[] => {
    const seeds = notificationsForStage({ ...args, actorId: me.id, users: s.users });
    const now = new Date().toISOString();
    const fresh = seeds.map((seed) => ({ ...seed, id: uid(), read: false, created_at: now }));
    return [...fresh, ...s.notifications];
  };

  const addDelivery = useCallback<DataState["addDelivery"]>(async (d) => {
    const s = storeRef.current;
    const nextNo = s.deliveries.reduce((m, x) => Math.max(m, x.order_no), 1000) + 1;
    const now = new Date().toISOString();
    const row: Delivery = {
      ...seedRow(nextNo),
      ...d,
      id: uid(),
      // Split loads (#1001b) pass in the original's order_no + order_code.
      order_no: d.order_no ?? nextNo,
      order_code: d.order_code ?? nextOrderCode(s.deliveries.map((x) => x.order_code), new Date()),
      // created_by is always the actual actor — a non-sales creator assigning
      // the order to a rep (OrderModal's Sales Rep picker) sets assigned_sales_rep
      // instead, which is what orderOwner() resolves for own-orders visibility.
      created_by: me.id,
      created_at: now,
      updated_at: now,
    } as Delivery;
    let next: Store = { ...s, deliveries: [row, ...s.deliveries], events: addEvent(s, row.id, "created") };
    if (row.stage && row.stage !== "draft") {
      next = { ...next, notifications: addNotifs(next, { stage: row.stage, order_no: row.order_no, order_code: row.order_code, delivery_id: row.id, creatorId: orderOwner(row) }) };
    }
    persist(next);
    return row;
  }, [me, persist]);

  const updateDelivery = useCallback<DataState["updateDelivery"]>(async (id, patch) => {
    const s = storeRef.current;
    persist({
      ...s,
      deliveries: s.deliveries.map((c) => (c.id === id ? { ...c, ...patch, updated_at: new Date().toISOString() } : c)),
      events: addEvent(s, id, "edited"),
    });
    return true;
  }, [persist]);

  // Renumber a route's stops (see the real provider) — one local write, so the
  // whole new sequence lands at once.
  const reorderStops = useCallback<DataState["reorderStops"]>(async (orderedIds, loadNoById, loadAuto) => {
    const s = storeRef.current;
    const seqById = new Map(orderedIds.map((id, i) => [id, i]));
    persist({
      ...s,
      deliveries: s.deliveries.map((c) =>
        seqById.has(c.id)
          ? {
              ...c,
              route_seq: seqById.get(c.id)!,
              ...(loadNoById ? { load_no: loadNoById[c.id] ?? null } : {}),
              ...(loadAuto === undefined ? {} : { load_auto: loadAuto }),
              updated_at: new Date().toISOString(),
            }
          : c),
    });
    return true;
  }, [persist]);

  // Local demo mode: positions live only in this browser session, so the
  // driver view can be exercised without a backend.
  const [driverLocations, setDriverLocations] = useState<DriverLocation[]>([]);
  const pushLocation = useCallback<DataState["pushLocation"]>(async (fix) => {
    const row: DriverLocation = {
      id: `local-${Date.now()}`,
      driver_id: me.id,
      lat: fix.lat,
      lng: fix.lng,
      accuracy_m: fix.accuracy_m ?? null,
      speed_mps: fix.speed_mps ?? null,
      heading: fix.heading ?? null,
      battery_pct: fix.battery_pct ?? null,
      recorded_at: fix.recorded_at ?? new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    setDriverLocations((prev) => [row, ...prev.filter((p) => p.driver_id !== me.id)]);
    return true;
  }, [me.id]);

  const deleteDelivery = useCallback<DataState["deleteDelivery"]>(async (id) => {
    const s = storeRef.current;
    persist({ ...s, deliveries: s.deliveries.filter((c) => c.id !== id) });
  }, [persist]);

  const setStage = useCallback<DataState["setStage"]>(async (id, stage, note, extra) => {
    const s = storeRef.current;
    // Hard guard: an order can't reach the warehouse without manager approval.
    // Admins may override to any status.
    const cur = s.deliveries.find((c) => c.id === id);
    if (cur && me.role !== "admin" && !canTransition(cur.stage, stage)) {
      notify("This order must be approved by a manager first.");
      return false;
    }
    const patch: Partial<Delivery> = { stage, ...extra, updated_at: new Date().toISOString() };
    if (stage === "approved") { patch.approved_by = me.id; patch.approved_at = new Date().toISOString(); }
    if (stage === "rejected") patch.rejected_reason = note ?? null;
    const base: Store = {
      ...s,
      deliveries: s.deliveries.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      events: addEvent(s, id, stage as Stage, note),
    };
    persist({
      ...base,
      notifications: addNotifs(base, { stage, order_no: cur?.order_no ?? null, order_code: cur?.order_code ?? null, delivery_id: id, creatorId: cur ? orderOwner(cur) : null, reason: note }),
    });
    return true;
  }, [me, persist, notify]);

  const eventsFor = useCallback((deliveryId: string) => store.events.filter((e) => e.delivery_id === deliveryId), [store.events]);

  const addNote = useCallback<DataState["addNote"]>(async (deliveryId, text) => {
    const body = text.trim();
    if (!body) return;
    const s = storeRef.current;
    persist({ ...s, events: addEvent(s, deliveryId, "note", body) });
  }, [persist]);

  const markNotifRead = useCallback<DataState["markNotifRead"]>(async (id) => {
    const s = storeRef.current;
    persist({ ...s, notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) });
  }, [persist]);

  const markAllNotifsRead = useCallback<DataState["markAllNotifsRead"]>(async () => {
    const s = storeRef.current;
    persist({ ...s, notifications: s.notifications.map((n) => (n.user_id === me.id ? { ...n, read: true } : n)) });
  }, [me, persist]);

  const pushNotifs = useCallback<DataState["pushNotifs"]>(async (seeds) => {
    if (!seeds.length) return;
    const s = storeRef.current;
    const now = new Date().toISOString();
    const fresh = seeds.map((seed) => ({ ...seed, id: uid(), read: false, created_at: now }));
    persist({ ...s, notifications: [...fresh, ...s.notifications] });
  }, [persist]);

  const saveSettings = useCallback<DataState["saveSettings"]>(async (patch) => {
    const s = storeRef.current;
    persist({ ...s, settings: { ...s.settings, ...patch } });
  }, [persist]);

  // Demo mode has no auth at all, so identity is just a label on the row.
  const setUserIdentity = useCallback<DataState["setUserIdentity"]>(async (id, patch) => {
    const s = storeRef.current;
    persist({ ...s, users: s.users.map((u) => (u.id === id ? { ...u, username: patch.username ?? u.username ?? null } : u)) });
    return { ok: true };
  }, [persist]);

  // Demo mode has no auth, so there is no password to reset.
  const resetUserPassword = useCallback<DataState["resetUserPassword"]>(async () => ({ ok: false, error: "Not available in demo mode" }), []);

  const addUser = useCallback<DataState["addUser"]>(async (input) => {
    const s = storeRef.current;
    const name = input.full_name.trim() || input.username || (input.email ?? "").split("@")[0] || "User";
    if (s.users.some((u) => u.full_name.toLowerCase() === name.toLowerCase())) {
      notify("A user with that name already exists.");
      return { ok: false };
    }
    const user: Profile = { id: uid(), full_name: name, username: input.username ?? null, role: input.role, store: input.store ?? null };
    persist({ ...s, users: [...s.users, user] });
    if (!input.quiet) notify(`User "${name}" created`);
    return { ok: true };
  }, [persist, notify]);

  const updateUserRole = useCallback<DataState["updateUserRole"]>(async (userId, role) => {
    const s = storeRef.current;
    persist({ ...s, users: s.users.map((u) => (u.id === userId ? { ...u, role } : u)) });
  }, [persist]);

  const updateUserName = useCallback<DataState["updateUserName"]>(async (userId, name) => {
    const s = storeRef.current;
    persist({ ...s, users: s.users.map((u) => (u.id === userId ? { ...u, full_name: name } : u)) });
  }, [persist]);

  const updateUserStore = useCallback<DataState["updateUserStore"]>(async (userId, storeName) => {
    const s = storeRef.current;
    persist({ ...s, users: s.users.map((u) => (u.id === userId ? { ...u, store: storeName } : u)) });
  }, [persist]);

  const updateUserPermissions = useCallback<DataState["updateUserPermissions"]>(async (userId, permissions) => {
    const s = storeRef.current;
    persist({ ...s, users: s.users.map((u) => (u.id === userId ? { ...u, permissions } : u)) });
  }, [persist]);

  // Recruiting has no local provider (D-050) — the UI section that calls this
  // is gated to !LOCAL_MODE and never renders here, so this only exists to
  // satisfy the shared DataState contract.
  const updateUserRecruitingAccess = useCallback<DataState["updateUserRecruitingAccess"]>(async () => {
    notify("Not available in demo mode");
  }, [notify]);

  // Same reasoning as updateUserRecruitingAccess above — timetracker has no
  // local provider either (D-064).
  const updateUserTimetrackerAccess = useCallback<DataState["updateUserTimetrackerAccess"]>(async () => {
    notify("Not available in demo mode");
  }, [notify]);

  // Same reasoning again — demo mode has no ERP catalog to grant access to.
  const updateUserErpAccess = useCallback<DataState["updateUserErpAccess"]>(async () => {
    notify("Not available in demo mode");
  }, [notify]);

  const updateUserClockinAccess = useCallback<DataState["updateUserClockinAccess"]>(async () => {
    notify("Not available in demo mode");
  }, [notify]);

  const deleteUser = useCallback<DataState["deleteUser"]>(async (userId) => {
    const s = storeRef.current;
    persist({ ...s, users: s.users.filter((u) => u.id !== userId) });
    notify("User removed");
    return true;
  }, [persist, notify]);

  const addAvailability = useCallback<DataState["addAvailability"]>(async (seedRow) => {
    const s = storeRef.current;
    const row: DriverAvailability = { id: uid(), created_at: new Date().toISOString(), created_by: me.id, ...seedRow };
    persist({ ...s, availability: [row, ...(s.availability ?? [])] });
  }, [persist, me.id]);
  const removeAvailability = useCallback<DataState["removeAvailability"]>(async (id) => {
    const s = storeRef.current;
    persist({ ...s, availability: (s.availability ?? []).filter((r) => r.id !== id) });
  }, [persist]);

  const clockIn = useCallback<DataState["clockIn"]>(async (driverId) => {
    const s = storeRef.current;
    if ((s.shifts ?? []).some((sh) => sh.driver_id === driverId && !sh.ended_at)) return;
    const row: DriverShift = { id: uid(), driver_id: driverId, started_at: new Date().toISOString(), ended_at: null, note: null, device_id: deviceId(), created_at: new Date().toISOString() };
    persist({ ...s, shifts: [row, ...(s.shifts ?? [])] });
  }, [persist]);
  const clockOut = useCallback<DataState["clockOut"]>(async (driverId) => {
    const s = storeRef.current;
    const now = new Date().toISOString();
    persist({ ...s, shifts: (s.shifts ?? []).map((sh) => (sh.driver_id === driverId && !sh.ended_at ? { ...sh, ended_at: now } : sh)) });
  }, [persist]);

  const addIncident = useCallback<DataState["addIncident"]>(async (inc) => {
    const s = storeRef.current;
    const row: DriverIncident = { ...inc, id: uid(), created_by: me.id, created_at: new Date().toISOString() };
    persist({ ...s, incidents: [row, ...(s.incidents ?? [])] });
    return true;
  }, [persist, me.id]);
  const removeIncident = useCallback<DataState["removeIncident"]>(async (id) => {
    const s = storeRef.current;
    persist({ ...s, incidents: (s.incidents ?? []).filter((r) => r.id !== id) });
  }, [persist]);

  const value: DataState = useMemo(() => ({
    ready, me, realRole: me.role, viewAs: null, setViewAs: () => {}, teaching: false, setTeaching: () => {}, clearTrainingData: async () => {}, settings: store.settings, users: store.users, deliveries: store.deliveries, events: store.events,
    notifications: store.notifications.filter((n) => n.user_id === me.id),
    toast, notify, markNotifRead, markAllNotifsRead, pushNotifs,
    addDelivery, updateDelivery, reorderStops, deleteDelivery, setStage, eventsFor, addNote, setUserIdentity, resetUserPassword,
    saveSettings, addUser, updateUserRole, updateUserName, updateUserStore, updateUserPermissions, updateUserRecruitingAccess, updateUserTimetrackerAccess, updateUserErpAccess, updateUserClockinAccess, deleteUser,
    availability: store.availability ?? [], addAvailability, removeAvailability,
    shifts: store.shifts ?? [], clockIn, clockOut,
    incidents: store.incidents ?? [], addIncident, removeIncident,
    driverLocations, pushLocation,
    // Local demo mode writes straight to this browser, so nothing is ever
    // waiting on a connection.
    pendingSync: 0, syncing: false,
  }), [ready, me, store, toast, notify, markNotifRead, markAllNotifsRead, pushNotifs, addDelivery, updateDelivery, reorderStops, deleteDelivery, setStage, eventsFor, addNote, saveSettings, addUser, updateUserRole, updateUserName, updateUserStore, deleteUser, addAvailability, removeAvailability, clockIn, clockOut, addIncident, removeIncident, driverLocations, pushLocation]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}

// A blank delivery with all required non-null fields, used as the base for inserts.
function seedRow(n: number): Delivery {
  const now = new Date().toISOString();
  return {
    id: "", order_no: n, order_code: null, order_suffix: null, stage: "draft", rejected_reason: null,
    is_training: false, redelivery_of: null, redelivery_reason: null,
    order_type: null, store: null,
    po2: null, so_num: null, invoice_num: null, estimate_num: null, input_date: todayISO(), input_time: null,
    delivery_date: null, pickup_name: null, pickup_address: null, pickup_duration: null,
    delivery_fee: null, est_pallets: null, actual_pallets: null, assigned_driver: null, delivery_duration: null,
    delivery_name: null, delivery_address: null,
    delivery_windows: null, account: null, contact: null, delivery_phone: null, delivery_notes: null,
    route_miles: null, route_duration: null, route_provider: null, route_traffic: null,
    pod_received_by: null, pod_signature: null, pod_delivered_at: null, departed_at: null, arrived_at: null, photos: null,
    pickup_lat: null, pickup_lng: null, pickup_gps_at: null,
    pod_lat: null, pod_lng: null, pod_accuracy: null,
    delivery_lat: null, delivery_lng: null, delivery_pin_source: null,
    route_seq: null, load_no: null, load_auto: false,
    created_by: null, assigned_sales_rep: null, approved_by: null, approved_at: null, created_at: now, updated_at: now,
  };
}
