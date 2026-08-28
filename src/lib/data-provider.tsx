"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { usePrefs } from "@/lib/prefs";
import type { Delivery, DriverAvailability, DriverIncident, DriverLocation, DriverShift, OrderEvent, Profile, Settings, Stage, UserRole } from "@/lib/types";
import { type AppNotification, assignmentNotification, notificationsForStage } from "@/lib/notifications";
import { canTransition } from "@/lib/constants";
import { orderOwner, changedFieldsNote } from "@/lib/utils";
import { deviceId } from "@/lib/device-id";
import { change, type SecurityKind } from "@/lib/security-log";
import { nextOrderCode, codeBand } from "@/lib/order-code";
import { applyOutbox, isOfflineError, loadOutbox, pendingIds, saveOutbox, type OutboxItem } from "@/lib/outbox";
import { blankDelivery } from "@/lib/blank-delivery";

const DEFAULT_SETTINGS: Settings = {
  id: 1,
  app_name: "RDZ·DELIVERIES",
  stores: [
    { name: "Brownsville", address: "" },
    { name: "Weslaco", address: "" },
    { name: "Pharr", address: "" },
    { name: "McAllen", address: "" },
    { name: "Mission", address: "" },
    { name: "Edinburg", address: "" },
  ],
  order_types: ["Customer", "Intertienda", "Transfer"],
  order_type_rules: {
    Customer:    { storeToStore: false, docRef: "invoice" },
    Intertienda: { storeToStore: true,  docRef: "any", homeIsDestination: true },
    Transfer:    { storeToStore: true,  docRef: "estimate" },
  },
  pickup_min_per_pallet: 4,
  delivery_min_per_pallet: 5,
  rc_calls_enabled: false,
  rc_auto_sms_enabled: false,
  manager_pending_cutoff: "16:00",
  sales_pending_cutoff: "16:15",
};

export interface DataState {
  ready: boolean;
  /** The EFFECTIVE user — role is overridden while an admin is "viewing as"
   * another role (the sandbox preview). Everything role-gated follows this. */
  me: Profile | null;
  /** The signed-in user's real role, never overridden — use this to decide
   * whether to show the admin-only "view as" control itself. */
  realRole: UserRole | null;
  /** Which role an admin is previewing as, or null when viewing as themselves. */
  viewAs: UserRole | null;
  setViewAs: (r: UserRole | null) => void;
  /** Teaching (training) mode: a purely LOCAL sandbox layered over the live
   * data. Creates/edits/deletes go to an in-memory overlay and never touch the
   * DB; the real rows keep updating underneath, so others' live changes still
   * appear. Turning it off discards the overlay. */
  teaching: boolean;
  setTeaching: (v: boolean) => void;
  /** Discard the local practice overlay and reset the sandbox to the current
   * real data. Nothing in the DB is touched. */
  clearTrainingData: () => Promise<void>;
  settings: Settings;
  users: Profile[];
  deliveries: Delivery[];
  events: OrderEvent[];
  notifications: AppNotification[];
  toast: string;
  notify: (msg: string) => void;

  // in-app notifications (role-targeted workflow alerts)
  markNotifRead: (id: string) => Promise<void>;
  markAllNotifsRead: () => Promise<void>;
  /** Insert arbitrary notifications directly (e.g. the pending-approval
   * deadline escalation) — bypasses the stage-transition fan-out. */
  pushNotifs: (seeds: import("@/lib/notifications").NotifSeed[]) => Promise<void>;

  // delivery CRUD
  addDelivery: (d: Partial<Delivery>) => Promise<Delivery | null>;
  /** `quiet` suppresses the error toast, for background patches the user
   * never asked for and can do nothing about — a failure there must not look
   * like a failure of whatever they just did. */
  updateDelivery: (id: string, patch: Partial<Delivery>, opts?: { quiet?: boolean }) => Promise<boolean>;
  /** Renumber a route's stops: `orderedIds` in their new visiting order gets
   * route_seq 0..n-1. Applied to local state FIRST and held there until every
   * write lands, so a realtime refetch can't interleave and snap stops back to
   * the old order. Returns false (and restores the previous order) on failure.
   * `loadNoById` optionally stamps each stop's truckload in the SAME guarded
   * write — needed when reordering whole truckloads, so the new grouping sticks
   * instead of being re-derived from truck capacity. */
  /** `loadAuto` records WHO grouped these loads: true = the optimizer (free to
   * regroup later), false = a person (leave it alone). Omitted leaves it as it
   * was, for moves that change order without changing the grouping. */
  reorderStops: (orderedIds: string[], loadNoById?: Record<string, number | null>, loadAuto?: boolean) => Promise<boolean>;
  deleteDelivery: (id: string) => Promise<void>;
  /** Move an order to a new workflow stage and log the event. `extra` merges
   * additional column updates into the SAME write (e.g. proof-of-delivery),
   * so they persist atomically instead of being clobbered by a follow-up save. */
  setStage: (id: string, stage: Stage, note?: string, extra?: Partial<Delivery>) => Promise<boolean>;
  eventsFor: (deliveryId: string) => OrderEvent[];
  /** Append a free-text note to an order's activity thread. */
  addNote: (deliveryId: string, text: string) => Promise<void>;

  // settings
  saveSettings: (patch: Partial<Settings>) => Promise<void>;

  // user management
  /** Either `email` or `username` — a person with no company address signs in
   * with a username instead (see lib/username). */
  addUser: (input: { email?: string; username?: string; full_name: string; role: UserRole; password?: string; store?: string | null; quiet?: boolean }) => Promise<{ ok: boolean; email?: string; username?: string | null; signInWith?: string; password?: string; can_reset_own_password?: boolean; error?: string }>;
  /** Change how someone signs in. Admin only; never touches passwords. */
  setUserIdentity: (id: string, patch: { username?: string | null; email?: string | null }) => Promise<{ ok: boolean; error?: string }>;
  /** Give someone a new password, generated server-side and returned once.
   * For the account with no email that can't reset its own. */
  resetUserPassword: (id: string) => Promise<{ ok: boolean; password?: string; error?: string }>;
  updateUserRole: (userId: string, role: Profile["role"]) => Promise<void>;
  updateUserName: (userId: string, name: string) => Promise<void>;
  /** Assign the store a warehouse worker / driver is scoped to (null = none). */
  updateUserStore: (userId: string, store: string | null) => Promise<void>;
  /** Grant a specific person extra capabilities on top of their role. */
  updateUserPermissions: (userId: string, permissions: string[]) => Promise<void>;
  /** Grant or revoke access to another module (today: recruiting) and its
   * permission tier there. Deliberately separate from updateUserRole — this
   * writes recruiting_role/module_access, never the deliveries `role` column
   * on the same shared profiles row (D-053; see D-050/D-052 for the bug this
   * confusion caused before). `recruiting_role` is ignored when
   * `granted` is false. */
  updateUserRecruitingAccess: (userId: string, patch: { granted: boolean; recruiting_role: string | null }) => Promise<void>;
  /** Same shape as updateUserRecruitingAccess, for the timetracker module
   * (D-064). Writes timetracker_role/module_access, never `role`. */
  updateUserClockinAccess: (userId: string, patch: { granted: boolean; clockin_role?: string | null }) => Promise<void>;
  /** ERP access is a flag only — no role tier of its own (D-090). */
  updateUserErpAccess: (userId: string, patch: { granted: boolean }) => Promise<void>;
  /** Deliveries is granted like any other module since D-100 — `role` stays put. */
  updateUserDeliveriesAccess: (userId: string, patch: { granted: boolean }) => Promise<void>;
  updateUserTimetrackerAccess: (userId: string, patch: { granted: boolean; timetracker_role: string | null }) => Promise<void>;
  deleteUser: (userId: string) => Promise<boolean>;

  /** Milestones completed with no signal, still waiting to reach the server.
   * Drives the "saved, will send" banner so a driver can see nothing is lost. */
  pendingSync: number;
  /** True while the queue is being replayed. */
  syncing: boolean;

  // live driver GPS
  /** Each driver's most recent position (one entry per driver). */
  driverLocations: DriverLocation[];
  /** Report this device's position. Silent on failure — the next fix is
   * seconds away and a driver doesn't need an error for a dropped ping. */
  pushLocation: (fix: {
    lat: number; lng: number;
    accuracy_m?: number | null; speed_mps?: number | null; heading?: number | null;
    battery_pct?: number | null; recorded_at?: string;
  }) => Promise<boolean>;

  // driver availability (vacation / sick / vehicle maintenance)
  availability: DriverAvailability[];
  addAvailability: (seed: Omit<DriverAvailability, "id" | "created_at" | "created_by">) => Promise<void>;
  removeAvailability: (id: string) => Promise<void>;

  // driver shift clock (idle-time KPI)
  shifts: DriverShift[];
  clockIn: (driverId: string) => Promise<void>;
  clockOut: (driverId: string) => Promise<void>;

  // logistics-manager driver incident log (things that cost the company money)
  incidents: DriverIncident[];
  addIncident: (inc: Omit<DriverIncident, "id" | "created_at" | "created_by">) => Promise<boolean>;
  removeIncident: (id: string) => Promise<void>;
}

// Teaching-mode sandbox: a local diff over the live data. `created` are orders
// that exist only in the sandbox; `updated` are field patches keyed by real id;
// `deleted` are real ids hidden while practising. None of this ever hits the DB.
type Overlay = { created: Delivery[]; updated: Record<string, Partial<Delivery>>; deleted: Set<string>; events: OrderEvent[] };
const emptyOverlay = (): Overlay => ({ created: [], updated: {}, deleted: new Set(), events: [] });
// The teaching sandbox is persisted here so practice changes survive reloads
// until "Reset sandbox" is pressed (the Set is stored as an array for JSON).
const TEACHING_OVERLAY_KEY = "rtg_teaching_overlay";

export const Ctx = createContext<DataState | null>(null);

export function useData(): DataState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

/** How much order history the client keeps in memory. See reloadAll(). */
const EVENTS_WINDOW = 1000;

export function DataProvider({ children, me }: { children: React.ReactNode; me: Profile | null }) {
  const supabase = useMemo(() => createClient(), []);
  // Offline messages are read by a driver mid-route, so they follow the
  // app language like everything else they see.
  const { lang } = usePrefs();
  const [ready, setReady] = useState(false);

  // ---- Admin "view as" sandbox: preview the app as any role, admin-only. ----
  const realRole: UserRole | null = me?.role ?? null;
  const [viewAs, setViewAsState] = useState<UserRole | null>(null);
  useEffect(() => {
    if (realRole !== "admin") { setViewAsState(null); return; }
    try {
      const raw = localStorage.getItem("rtg_view_as");
      if (raw && raw !== "admin") setViewAsState(raw as UserRole);
    } catch { /* ignore */ }
  }, [realRole]);
  const setViewAs = useCallback((r: UserRole | null) => {
    setViewAsState(r);
    try {
      if (r) localStorage.setItem("rtg_view_as", r);
      else localStorage.removeItem("rtg_view_as");
    } catch { /* ignore */ }
  }, []);
  const effectiveMe: Profile | null =
    me && realRole === "admin" && viewAs ? { ...me, role: viewAs } : me;

  // ---- Teaching mode: local sandbox overlay on the live data (see Overlay). ----
  const [teaching, setTeachingState] = useState(false);
  useEffect(() => {
    try { setTeachingState(localStorage.getItem("rtg_teaching") === "1"); } catch { /* ignore */ }
  }, []);
  const setTeaching = useCallback((v: boolean) => {
    setTeachingState(v);
    try { if (v) localStorage.setItem("rtg_teaching", "1"); else localStorage.removeItem("rtg_teaching"); } catch { /* ignore */ }
  }, []);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [users, setUsers] = useState<Profile[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  // Set while a multi-row write (e.g. renumbering a route's stops) is in
  // flight. Realtime echoes arriving mid-write would otherwise refetch a
  // half-committed snapshot and visibly undo the change.
  const writingRef = useRef(false);
  // Guards against two flushes overlapping (the timer firing while the
  // "online" event is already replaying) and double-sending a milestone.
  const flushingRef = useRef(false);
  // reloadAll is defined below; the flusher reaches it through a ref so it
  // doesn't have to be declared before it.
  const reloadAllRef = useRef<(() => Promise<void>) | null>(null);
  const logEventRef = useRef<((id: string, kind: string, note?: string) => Promise<void>) | null>(null);
  // Each driver's CURRENT position (one row per driver), for the live map.
  const [driverLocations, setDriverLocations] = useState<DriverLocation[]>([]);
  // ---- Teaching-mode sandbox ----
  // Teaching mode is a purely LOCAL overlay on top of the real, live data:
  // creations, edits and deletions are recorded here and NEVER written to the
  // database, so nothing a user does in teaching mode is visible to anyone else.
  // Because the real `deliveries` keep updating from realtime, changes other
  // people make to the LIVE data still flow in underneath the sandbox while you
  // practice. The sandbox PERSISTS (localStorage) across reloads and across
  // toggling teaching off/on — practice changes stay until "Reset sandbox".
  const [overlay, setOverlay] = useState<Overlay>(emptyOverlay);
  const overlayLoaded = useRef(false);
  // Restore a saved sandbox on first load.
  useEffect(() => {
    if (overlayLoaded.current) return;
    overlayLoaded.current = true;
    try {
      const raw = localStorage.getItem(TEACHING_OVERLAY_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        setOverlay({
          created: Array.isArray(o.created) ? o.created : [],
          updated: o.updated && typeof o.updated === "object" ? o.updated : {},
          deleted: new Set(Array.isArray(o.deleted) ? o.deleted : []),
          events: Array.isArray(o.events) ? o.events : [],
        });
      }
    } catch { /* ignore */ }
  }, []);
  // Persist the sandbox whenever it changes; clear the key once it's empty.
  useEffect(() => {
    if (!overlayLoaded.current) return;
    try {
      const empty = overlay.created.length === 0 && Object.keys(overlay.updated).length === 0
        && overlay.deleted.size === 0 && overlay.events.length === 0;
      if (empty) localStorage.removeItem(TEACHING_OVERLAY_KEY);
      else localStorage.setItem(TEACHING_OVERLAY_KEY, JSON.stringify({ ...overlay, deleted: [...overlay.deleted] }));
    } catch { /* ignore */ }
  }, [overlay]);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [availability, setAvailability] = useState<DriverAvailability[]>([]);
  const [shifts, setShifts] = useState<DriverShift[]>([]);
  const [incidents, setIncidents] = useState<DriverIncident[]>([]);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  // What the app actually renders. In live mode that's just the real rows; in
  // teaching mode it's the real rows with the local sandbox diff applied on top
  // (hide deleted, patch updated, prepend sandbox-created).
  // ---- Outbox: milestones completed with no signal -------------------------
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  // Loaded after mount so the server render and the first client render agree.
  useEffect(() => { setOutbox(loadOutbox()); }, []);

  const enqueue = useCallback((item: OutboxItem) => {
    setOutbox((prev) => { const next = [...prev, item]; saveOutbox(next); return next; });
  }, []);

  /** Message shown when a milestone is stored instead of sent. */
  const t_offlineSaved = useCallback(
    () => (lang === "es"
      ? "Sin señal — guardado y se enviará solo"
      : "No signal — saved, will send by itself"),
    [lang],
  );

  /**
   * Replay everything waiting. Each item is removed only once the server has
   * taken it, so a failure mid-queue leaves the rest to try again rather than
   * dropping work.
   */
  const flushOutbox = useCallback(async () => {
    if (flushingRef.current) return;
    const items = loadOutbox();
    if (!items.length) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    flushingRef.current = true;
    setSyncing(true);
    let remaining = items;
    try {
      for (const it of items) {
        try {
          const { error } = await supabase
            .from("deliveries")
            .update({ ...it.patch, stage: it.stage })
            .eq("id", it.deliveryId);
          if (error) {
            if (isOfflineError(error)) break;      // still offline — stop, keep the rest
            // The server refused it (e.g. the order moved on without us).
            // Retrying forever would never help, so drop it and say so.
            notify(lang === "es"
              ? `No se pudo enviar un cambio: ${error.message}`
              : `A queued change was rejected: ${error.message}`);
          } else {
            void logEventRef.current?.(it.deliveryId, it.stage, it.note);
          }
          remaining = remaining.filter((r) => r.id !== it.id);
          saveOutbox(remaining);
        } catch {
          break;   // network died again — leave the rest queued
        }
      }
    } finally {
      setOutbox(remaining);
      saveOutbox(remaining);
      flushingRef.current = false;
      setSyncing(false);
      if (remaining.length !== items.length) void reloadAllRef.current?.();
    }
  }, [supabase, notify, lang]);

  // Try whenever the connection comes back, when the driver returns to the
  // app, and on a slow timer as a backstop for a flaky signal that never
  // fires a clean "online" event.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onBack = () => void flushOutbox();
    window.addEventListener("online", onBack);
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onBack);
    const id = setInterval(onBack, 60_000);
    void flushOutbox();
    return () => {
      window.removeEventListener("online", onBack);
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onBack);
      clearInterval(id);
    };
  }, [flushOutbox]);

  const effectiveDeliveries = useMemo(() => {
    if (!teaching) return applyOutbox(deliveries, outbox);
    const base = deliveries
      .filter((c) => !overlay.deleted.has(c.id))
      .map((c) => (overlay.updated[c.id] ? { ...c, ...overlay.updated[c.id] } : c));
    return [...overlay.created, ...base];
  }, [teaching, deliveries, overlay, outbox]);

  // Make sure the access token isn't stale before reading. Without this, a
  // token that expired while the tab sat in the background (browsers
  // throttle background timers, so the client's own auto-refresh can lag)
  // doesn't fail loudly — RLS just treats the request as effectively
  // anonymous, PostgREST returns 200 with an empty array, and reloadAll
  // below cheerfully overwrites real state with nothing (`if (d.data)` is
  // true for `[]` too). Looks exactly like "all the data disappeared" with
  // no error anywhere — this pattern hit the Users page, timetracker, and
  // this board itself the same day, always fixed by a manual re-login.
  // Refreshing proactively here catches the common case (ordinary expiry)
  // before a fetch ever runs, instead of discovering it after the fact.
  // Marcado cuando una carga se cae. El efecto de abajo lo mira para reintentar; sin él,
  // "no tener que refrescar" dependería de que el primer intento gane la carrera contra
  // la navegación que lo canceló.
  const loadFailedRef = useRef(false);
  // Intentos de la racha actual. Vuelve a cero al primer acierto.
  const retriesRef = useRef(0);
  const ensureSession = useCallback(async () => {
    // Devuelve si HAY sesión, y eso es lo importante ahora. Antes solo refrescaba y se
    // encogía de hombros; reloadAll seguía y disparaba las consultas igual.
    //
    // Sin sesión, supabase-js manda la clave anónima como Authorization, así que las
    // consultas salían como `anon`. Eso venía "funcionando" porque anon tenía SELECT sobre
    // todo — es decir, la app servía datos sin autenticar y no se notaba. Al retirarle esos
    // permisos (081) el error salió a la luz: 401 "permission denied for table profiles".
    //
    // Se sigue tragando cualquier excepción, por la razón de D-088: un fetch cancelado a
    // media navegación no debe tumbar la carga. Pero ahora dice que no la tiene, y quien
    // llama decide en vez de preguntar a la base sin credenciales.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const nowSec = Math.floor(Date.now() / 1000);
      if (session && session.expires_at && session.expires_at - nowSec >= 60) return true;
      const { data } = await supabase.auth.refreshSession();
      return !!data?.session;
    } catch {
      return false;
    }
  }, [supabase]);

  // Envuelto entero, y no solo ensureSession() (D-088). Aquel arreglo tapó UNA de las
  // formas de que reloadAll() muriera antes de setReady(true); las consultas de abajo
  // pueden hacer lo mismo. Un fetch cancelado a media navegación —y abrir la app o
  // cambiar de módulo ES una navegación— hace que Promise.all rechace, y la pantalla
  // se queda como estaba: vacía, sin error, hasta que alguien refresca a mano.
  //
  // Dos cosas, porque una sola no basta:
  //   · finally { setReady(true) } — nunca se queda colgada en "cargando";
  //   · un reintento marcado, que el efecto de recuperación dispara al volver el foco
  //     o la conexión. Sin eso, "no tener que refrescar" seguiría dependiendo de que
  //     el primer intento gane la carrera.
  const reloadAll = useCallback(async () => {
    try {
      // Sin sesión no se pregunta: una consulta anónima ya no devuelve datos, devuelve
      // 401. Se marca como fallida y el efecto de recuperación reintenta en cuanto la
      // sesión aparezca — que es lo que pasa un instante después al hidratar.
      if (!(await ensureSession())) {
        loadFailedRef.current = true;
        return;
      }
      const [s, p, d, e, n, av, sh, inc, loc] = await Promise.all([
        supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
        // `username` and `permissions` were missing here, and both are read by
        // the UI. The username never reached the browser, so the Users dialog
        // showed an empty box for a name that WAS saved, hid the "remove email"
        // button, and turned clearing an email into "give them a username
        // first" — a message about a value that was sitting in the database all
        // along. Select what the app actually uses.
        // recruiting_role/timetracker_role + module_access ride along here (not
        // just on `me` in the layout) so the Users page can show/edit another
        // person's module access without a second round trip (D-053, D-064).
        supabase.from("profiles").select("id, full_name, username, role, store, permissions, avatar_url, recruiting_role, module_access, timetracker_role, clockin_role").order("full_name"),
        // Teaching mode never loads from the DB — the live (non-training) rows are
        // always the base, and the sandbox lives only in the local overlay.
        supabase.from("deliveries").select("*").eq("is_training", false).order("order_no", { ascending: false }),
        // Bounded, and it was not before. 855 rows / 376 kB today, downloaded in full on EVERY
        // page load and growing forever — the single biggest thing between opening the app and
        // seeing it. The two screens that read it (the audit feed and the dashboard's approval
        // turnaround) both work on recent activity; neither pages back through the whole history.
        // The audit page says when it is showing a capped window.
        supabase.from("order_events").select("*").order("created_at", { ascending: false }).limit(EVENTS_WINDOW),
        me
          ? supabase.from("notifications").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(50)
          : Promise.resolve({ data: [] as AppNotification[] }),
        supabase.from("driver_availability").select("*").order("start_date", { ascending: false }),
        supabase.from("driver_shifts").select("*").order("started_at", { ascending: false }),
        supabase.from("driver_incidents").select("*").order("incident_date", { ascending: false }),
        // Only the recent tail: the live map needs each driver's CURRENT spot,
        // not the whole history, and a shift's worth of fixes is a lot of rows.
        supabase.from("driver_locations").select("*")
          .gte("recorded_at", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
          .order("recorded_at", { ascending: false })
          .limit(2000),
      ]);
      if (s.data) setSettings(s.data as Settings);
      if (p.data) setUsers(p.data as Profile[]);
      if (d.data) setDeliveries(d.data as Delivery[]);
      if (e.data) setEvents(e.data as OrderEvent[]);
      if (n.data) setNotifications(n.data as AppNotification[]);
      if (av.data) setAvailability(av.data as DriverAvailability[]);
      if (sh.data) setShifts(sh.data as DriverShift[]);
      if (inc.data) setIncidents(inc.data as DriverIncident[]);
      // Rows arrive newest-first, so the first one seen per driver is their
      // current position — everything older is trail we don't hold in memory.
      if (loc.data) {
        const latest = new Map<string, DriverLocation>();
        for (const row of loc.data as DriverLocation[]) if (!latest.has(row.driver_id)) latest.set(row.driver_id, row);
        setDriverLocations([...latest.values()]);
      }
      setReady(true);

      // Un error DEVUELTO no es una excepción: supabase-js contesta { data: null, error }
      // sin lanzar nada, así que Promise.all resolvía tan tranquilo, los setters se
      // saltaban por `if (x.data)` y la pantalla quedaba vacía y "lista". Ese es el
      // camino exacto del 401 anónimo: ni un error visible, ni un reintento.
      const fallo = [s, p, d, e, n, av, sh, inc, loc].some((r) => r && "error" in r && r.error);
      loadFailedRef.current = fallo;
      if (!fallo) retriesRef.current = 0;
    } catch {
      loadFailedRef.current = true;
    } finally {
      setReady(true);
    }
  }, [supabase, me, ensureSession]);

  // Recuperación de una carga fallida.
  //
  // El caso real es abrir la app o cambiar de módulo: el navegador cancela las peticiones
  // en vuelo, la carga se cae y la pantalla se queda vacía. Antes solo se salía de ahí
  // refrescando a mano.
  //
  // **Se monta UNA vez y cuenta los intentos**, y las dos cosas son el arreglo de un bucle
  // que metí yo: el efecto dependía de `reloadAll`, y cada reintento provocaba un render que
  // volvía a armar los temporizadores. Con la carga fallando, eso reintentaba cada 400 ms
  // indefinidamente y redibujaba el proveedor entero cada vez — en la app de escritorio se
  // sentía como si se quedara pegada al cambiar de pestaña.
  //
  // El tope es lo que separa "una segunda oportunidad" de "machacar al servidor": cinco
  // intentos por racha, y el contador vuelve a cero en cuanto una carga sale bien, para que
  // un fallo de dentro de una hora tenga sus cinco.
  const reloadRef = useRef(reloadAll);
  reloadRef.current = reloadAll;
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stop = false;
    const retry = () => {
      if (stop || !loadFailedRef.current || retriesRef.current >= 5) return;
      retriesRef.current += 1;
      void reloadRef.current();
    };
    const timers = [400, 1500, 4000].map((ms) => setTimeout(retry, ms));
    // Late: para un fallo posterior al arranque, cuando los tres de arriba ya pasaron.
    const tick = setInterval(retry, 15_000);
    // Volver a la ventana o recuperar la conexión da intentos NUEVOS: el tope está para que
    // la app no machaque al servidor sola, no para castigar a quien vuelve una hora después
    // y se encuentra la pantalla vacía con los cinco ya gastados.
    const fresh = () => { retriesRef.current = 0; retry(); };
    window.addEventListener("focus", fresh);
    window.addEventListener("online", fresh);
    document.addEventListener("visibilitychange", fresh);
    return () => {
      stop = true;
      timers.forEach(clearTimeout);
      clearInterval(tick);
      window.removeEventListener("focus", fresh);
      window.removeEventListener("online", fresh);
      document.removeEventListener("visibilitychange", fresh);
    };
    // Sin dependencias A PROPÓSITO: ver arriba. reloadAll se lee de un ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // In the overlay model there's nothing in the DB to clear — the sandbox is
  // purely local — so "clear" just resets the local overlay back to empty.
  const clearTrainingData = useCallback(async () => {
    setOverlay(emptyOverlay());
    notify("Practice sandbox reset");
  }, [notify]);

  // Multiple concurrent sessions per account are allowed: a user can be signed
  // in on several devices/tabs at once (phone + desktop, or different roles in
  // separate browsers) without any of them being forced to sign out. The old
  // single-device lock (stamp active_session_id, sign out on mismatch) was
  // removed on purpose.

  useEffect(() => {
    reloadAll();
    // Coalesce realtime refetches. A single action often writes many rows at
    // once (e.g. reordering a driver's stops writes route_seq on every stop),
    // and each row change echoes its own postgres_changes event. Firing a full
    // reloadAll per event caused a storm of overlapping 8-table fetches — and an
    // EARLY-triggered fetch could read a half-committed snapshot yet resolve
    // LAST, clobbering the correct state (a stop would visibly move, then snap
    // back). Debouncing means exactly one reload runs after the burst settles,
    // reading fully-committed data.
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        // A multi-row write is still going — refetching now would read a
        // half-written sequence. Try again once it's finished.
        if (writingRef.current) { scheduleReload(); return; }
        reloadAll();
      }, 250);
    };
    const channel = supabase
      .channel("deliveries-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_events" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_availability" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_shifts" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_incidents" }, scheduleReload)
      // GPS fixes arrive constantly, so they are applied straight to the one
      // driver's dot. Routing them through reloadAll would refetch every table
      // in the app several times a minute per driver on the road.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "driver_locations" }, (payload) => {
        const row = payload.new as DriverLocation;
        if (!row?.driver_id) return;
        setDriverLocations((prev) => {
          const current = prev.find((p) => p.driver_id === row.driver_id);
          // Fixes can arrive out of order (a phone flushing a queue after a
          // dead zone); never let an older one overwrite a newer one.
          if (current && current.recorded_at > row.recorded_at) return prev;
          return [row, ...prev.filter((p) => p.driver_id !== row.driver_id)];
        });
      })
      .subscribe();
    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      supabase.removeChannel(channel);
    };
  }, [supabase, reloadAll]);

  // ---------------- Event log helper ----------------
  const logEvent = useCallback(
    async (deliveryId: string, kind: string, note?: string) => {
      await supabase.from("order_events").insert({
        delivery_id: deliveryId,
        kind,
        note: note ?? null,
        created_by: me?.id ?? null,
      });
    },
    [supabase, me],
  );
  // Published for the outbox flusher, which is declared above these two and so
  // can't reference them directly.
  logEventRef.current = logEvent;
  reloadAllRef.current = reloadAll;

  // ---------------- Notification fan-out ----------------
  // Insert one row per recipient. Realtime pushes them to each user's bell.
  const emitStageNotifs = useCallback(
    async (args: { stage: Stage; order_no: number | null; order_code?: string | null; delivery_id: string; creatorId: string | null; reason?: string | null }) => {
      const seeds = notificationsForStage({ ...args, actorId: me?.id ?? null, users });
      if (!seeds.length) return;
      const { error } = await supabase.from("notifications").insert(seeds);
      if (error) console.error("notification insert failed:", error.message);
    },
    [supabase, me, users],
  );

  const pushNotifs = useCallback<DataState["pushNotifs"]>(
    async (seeds) => {
      if (!seeds.length) return;
      const { error } = await supabase.from("notifications").insert(seeds);
      if (error) console.error("notification insert failed:", error.message);
    },
    [supabase],
  );

  // ---------------- Delivery CRUD ----------------
  const addDelivery = useCallback<DataState["addDelivery"]>(
    async (d) => {
      // Teaching mode: build the order entirely client-side and keep it in the
      // local overlay. It never touches the DB, so no order number/code is
      // consumed, no events are logged, and nobody else is notified.
      if (teaching) {
        const nowIso = new Date().toISOString();
        const row = blankDelivery({
          ...d,
          id: d.id && d.id.length ? d.id : `teach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          order_code: d.order_code ?? nextOrderCode(effectiveDeliveries.map((x) => x.order_code), new Date()),
          order_no: d.order_no ?? (effectiveDeliveries.reduce((m, x) => Math.max(m, x.order_no || 0), 900000) + 1),
          is_training: true,
          created_by: me?.id ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        });
        setOverlay((o) => ({ ...o, created: [row, ...o.created] }));
        return row;
      }
      // created_by is always the actual actor — a non-sales creator assigning
      // the order to a rep (OrderModal's Sales Rep picker) sets assigned_sales_rep
      // instead, which is what orderOwner() resolves for own-orders visibility.
      const payload: Partial<Delivery> = { ...d, created_by: me?.id ?? null, is_training: false };
      // Assign the human-facing order code (split remainders pass one in). On a
      // rare race two orders can compute the same code — a unique index rejects
      // the second, so re-fetch the band's codes and retry a few times.
      let data: Delivery | null = null;
      let error: { code?: string; message: string } | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (payload.order_code == null) {
          let codes = deliveries.filter((x) => !x.is_training).map((x) => x.order_code);
          if (attempt > 0) {
            // Pull the freshest codes for this band straight from the DB.
            const band = codeBand(new Date());
            const { data: rows } = await supabase.from("deliveries")
              .select("order_code").eq("is_training", false)
              .gte("order_code", band.prefix + "100").lt("order_code", band.prefix + "999");
            if (rows) codes = (rows as { order_code: string | null }[]).map((r) => r.order_code);
          }
          payload.order_code = nextOrderCode(codes, new Date());
        }
        const res = await supabase.from("deliveries").insert(payload).select().single();
        data = res.data as Delivery | null;
        error = res.error;
        if (!error) break;
        if (error.code === "23505" && (error.message || "").includes("order_code")) {
          payload.order_code = null; // collision — recompute and retry
          continue;
        }
        break;
      }
      if (error || !data) {
        notify("Error: " + (error?.message ?? "insert failed"));
        return null;
      }
      const row = data as Delivery;
      setDeliveries((prev) => [row, ...prev]);
      await logEvent(row.id, "created");
      // An order created straight into "pending" (Submit for approval) alerts managers.
      if (row.stage && row.stage !== "draft") {
        await emitStageNotifs({ stage: row.stage, order_no: row.order_no, order_code: row.order_code, delivery_id: row.id, creatorId: orderOwner(row) });
      }
      return row;
    },
    [supabase, me, notify, logEvent, emitStageNotifs, teaching, deliveries, effectiveDeliveries],
  );

  const updateDelivery = useCallback<DataState["updateDelivery"]>(
    async (id, patchIn, opts) => {
      let patch = patchIn;
      // Teaching mode: record the edit in the local overlay only.
      if (teaching) {
        setOverlay((o) => {
          if (o.created.some((c) => c.id === id)) {
            return { ...o, created: o.created.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
          }
          return { ...o, updated: { ...o.updated, [id]: { ...o.updated[id], ...patch } } };
        });
        return true;
      }
      const before = deliveries.find((c) => c.id === id);

      // Stamp WHO took each new photo. Done here rather than at each call
      // site because every uploader — the driver's card, the delivery sheet,
      // the office view — goes through this one write, and an attribution
      // that depends on remembering to add it is an attribution that goes
      // missing.
      //
      // Keyed by URL and merged, so removing a photo drops its entry and the
      // survivors keep their authors.
      if (patch.photos && me) {
        const prevMeta = before?.photo_meta ?? {};
        const now = new Date().toISOString();
        const meta: Record<string, { by: string; at: string }> = {};
        for (const url of patch.photos) {
          meta[url] = prevMeta[url] ?? { by: me.id, at: now };
        }
        patch = { ...patch, photo_meta: meta };
      }

      const { error } = await supabase.from("deliveries").update(patch).eq("id", id);
      if (error) {
        if (!opts?.quiet) notify("Error: " + error.message);
        return false;
      }
      setDeliveries((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      // Being handed the work is its own event. Every way an order gets a
      // driver — the modal, Routes Manager, the map, bulk assign — comes
      // through here, so this is the one place that can't be bypassed.
      if ("assigned_driver" in patch && patch.assigned_driver !== before?.assigned_driver) {
        const seed = assignmentNotification({
          driverName: patch.assigned_driver,
          order_no: before?.order_no ?? null,
          order_code: before?.order_code ?? null,
          delivery_id: id,
          delivery_date: (patch.delivery_date ?? before?.delivery_date) ?? null,
          users,
          actorId: me?.id ?? null,
        });
        // Never blocks the assignment: a dispatcher's board must not fail
        // because a notification couldn't be written.
        if (seed) {
          // The bell row is the record. The push is best-effort on top: it can
          // fail (no phone registered, Firebase down) without the assignment
          // itself looking like it failed.
          const { data: made } = await supabase.from("notifications").insert([seed]).select("id").maybeSingle();
          if (made?.id) {
            void fetch("/api/push", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ notification_id: made.id }),
            }).catch(() => undefined);
          }
        }
      }
      // Record WHICH fields changed, so the activity log / audit is field-level.
      await logEvent(id, "edited", before ? (changedFieldsNote(before as unknown as Record<string, unknown>, patch as Record<string, unknown>) || undefined) : undefined);
      return true;
    },
    [supabase, notify, logEvent, teaching, deliveries, users, me],
  );

  // Renumber a route's stops in one shot. The local order is applied FIRST and
  // a write-guard blocks realtime refetches until every row has landed, so the
  // reorder can't be undone mid-flight by a refetch reading a partially
  // committed sequence. On any failure the previous order is restored, so the
  // list never silently disagrees with the database.
  const reorderStops = useCallback<DataState["reorderStops"]>(
    async (orderedIds, loadNoById, loadAuto) => {
      if (!orderedIds.length) return true;
      const seqById = new Map(orderedIds.map((id, i) => [id, i]));
      // The full patch for one stop: its new position, plus its truckload when
      // whole truckloads are being reordered.
      const patchFor = (id: string): Partial<Delivery> => ({
        route_seq: seqById.get(id)!,
        ...(loadNoById ? { load_no: loadNoById[id] ?? null } : {}),
        ...(loadAuto === undefined ? {} : { load_auto: loadAuto }),
      });
      if (teaching) {
        setOverlay((o) => ({
          ...o,
          created: o.created.map((c) => (seqById.has(c.id) ? { ...c, ...patchFor(c.id) } : c)),
          updated: orderedIds.reduce((acc, id) => ({ ...acc, [id]: { ...acc[id], ...patchFor(id) } }), { ...o.updated }),
        }));
        return true;
      }
      const prev = deliveries;
      setDeliveries((cur) => cur.map((d) => (seqById.has(d.id) ? { ...d, ...patchFor(d.id) } : d)));
      writingRef.current = true;
      try {
        for (const id of seqById.keys()) {
          const was = prev.find((d) => d.id === id);
          const patch = patchFor(id);
          // Skip rows already exactly where they should be — fewer writes, fewer echoes.
          if (was && was.route_seq === patch.route_seq && (!loadNoById || (was.load_no ?? null) === (patch.load_no ?? null))) continue;
          const { error } = await supabase.from("deliveries").update(patch).eq("id", id);
          if (error) {
            setDeliveries(prev);          // put the old order back
            notify("Error: " + error.message);
            return false;
          }
        }
        return true;
      } finally {
        writingRef.current = false;
      }
    },
    [supabase, notify, teaching, deliveries],
  );

  // Report this device's position. Called on a timer while the driver is on
  // shift (and by the Android app's background service). Deliberately quiet:
  // a dropped fix is not worth a toast on the driver's screen, and the next
  // one is seconds away.
  const pushLocation = useCallback<DataState["pushLocation"]>(
    async (fix) => {
      if (!me || teaching) return false;
      const row = {
        driver_id: me.id,
        lat: fix.lat,
        lng: fix.lng,
        accuracy_m: fix.accuracy_m ?? null,
        speed_mps: fix.speed_mps ?? null,
        heading: fix.heading ?? null,
        battery_pct: fix.battery_pct ?? null,
        recorded_at: fix.recorded_at ?? new Date().toISOString(),
      };
      const { error } = await supabase.from("driver_locations").insert(row);
      if (error) return false;
      // Reflect our own dot immediately rather than waiting for the echo.
      setDriverLocations((prev) => [
        { ...row, id: `local-${Date.now()}`, created_at: row.recorded_at } as DriverLocation,
        ...prev.filter((p) => p.driver_id !== me.id),
      ]);
      return true;
    },
    [supabase, me, teaching],
  );

  const deleteDelivery = useCallback<DataState["deleteDelivery"]>(
    async (id) => {
      // Teaching mode: hide the row locally — drop it if it was sandbox-created,
      // otherwise mark the real id deleted in the overlay. The DB is untouched.
      if (teaching) {
        setOverlay((o) => {
          if (o.created.some((c) => c.id === id)) {
            return { ...o, created: o.created.filter((c) => c.id !== id) };
          }
          const deleted = new Set(o.deleted); deleted.add(id);
          const updated = { ...o.updated }; delete updated[id];
          return { ...o, deleted, updated };
        });
        return;
      }
      setDeliveries((prev) => prev.filter((c) => c.id !== id));
      const { error } = await supabase.from("deliveries").delete().eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify, teaching],
  );

  const setStage = useCallback<DataState["setStage"]>(
    async (id, stage, note, extra) => {
      // Hard guard: reject illegal workflow moves (e.g. straight to fulfilling
      // without manager approval). Admins may override to any status.
      const current = effectiveDeliveries.find((c) => c.id === id);
      if (current && me?.role !== "admin" && !canTransition(current.stage, stage)) {
        notify("This order must be approved by a manager first.");
        return false;
      }
      const patch: Partial<Delivery> = { stage, ...extra };
      if (stage === "approved") {
        patch.approved_by = me?.id ?? null;
        patch.approved_at = new Date().toISOString();
      }
      if (stage === "rejected") patch.rejected_reason = note ?? null;
      // Teaching mode: apply the stage change to the local overlay only.
      if (teaching) {
        setOverlay((o) => {
          if (o.created.some((c) => c.id === id)) {
            return { ...o, created: o.created.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
          }
          return { ...o, updated: { ...o.updated, [id]: { ...o.updated[id], ...patch } } };
        });
        return true;
      }
      // A milestone the driver just completed must not be lost to a dead zone.
      // If the write can't reach the server, it goes to the outbox and replays
      // when there's signal; the row still reads as done in the meantime.
      const queueable = stage === "picked_up" || stage === "delivered";
      let error: { message: string } | null = null;
      try {
        const res = await supabase.from("deliveries").update(patch).eq("id", id);
        error = res.error;
      } catch (e) {
        // supabase-js normally returns errors, but a hard network failure can
        // still throw — treat it the same way.
        error = { message: e instanceof Error ? e.message : "network error" };
      }
      if (error) {
        if (queueable && isOfflineError(error)) {
          enqueue({
            id: `q${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            deliveryId: id, stage, patch, note, at: new Date().toISOString(), tries: 0,
          });
          notify(t_offlineSaved());
          return true;   // as far as the driver is concerned, it's done
        }
        notify(error.message);
        return false;
      }
      setDeliveries((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      // The stage itself is saved above — that's what the caller is waiting on.
      // The audit entry and the notification fan-out are two more round trips
      // that nobody is watching, so they run without holding the UI. A driver
      // pressing "Pick up" was waiting through all three.
      const order = deliveries.find((c) => c.id === id);
      void logEvent(id, stage, note);
      void emitStageNotifs({ stage, order_no: order?.order_no ?? null, order_code: order?.order_code ?? null, delivery_id: id, creatorId: order ? orderOwner(order) : null, reason: note });
      return true;
    },
    [supabase, me, notify, logEvent, deliveries, effectiveDeliveries, emitStageNotifs, teaching],
  );

  const eventsFor = useCallback(
    (deliveryId: string) => {
      const real = events.filter((e) => e.delivery_id === deliveryId);
      if (!teaching) return real;
      // Fold in sandbox-only notes for this order (newest first).
      const local = overlay.events.filter((e) => e.delivery_id === deliveryId);
      return [...local, ...real];
    },
    [events, teaching, overlay.events],
  );

  const addNote = useCallback<DataState["addNote"]>(
    async (deliveryId, text) => {
      const body = text.trim();
      if (!body) return;
      // Teaching mode: keep the note in the local overlay — never write to DB
      // (a sandbox order id doesn't exist in the DB, which would error anyway).
      if (teaching) {
        const ev: OrderEvent = {
          id: `teach-ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          delivery_id: deliveryId,
          kind: "note",
          note: body,
          created_by: me?.id ?? null,
          created_at: new Date().toISOString(),
        };
        setOverlay((o) => ({ ...o, events: [ev, ...o.events] }));
        return;
      }
      const { data, error } = await supabase
        .from("order_events")
        .insert({ delivery_id: deliveryId, kind: "note", note: body, created_by: me?.id ?? null })
        .select()
        .single();
      if (error) { notify("Error: " + error.message); return; }
      setEvents((prev) => [data as OrderEvent, ...prev]);
    },
    [supabase, me, notify, teaching],
  );

  // ---------------- Notifications ----------------
  const markNotifRead = useCallback<DataState["markNotifRead"]>(
    async (id) => {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      await supabase.from("notifications").update({ read: true }).eq("id", id);
    },
    [supabase],
  );

  const markAllNotifsRead = useCallback<DataState["markAllNotifsRead"]>(async () => {
    if (!me) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await supabase.from("notifications").update({ read: true }).eq("user_id", me.id).eq("read", false);
  }, [supabase, me]);

  // ---------------- Settings ----------------
  const saveSettings = useCallback<DataState["saveSettings"]>(
    async (patch) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      const { error } = await supabase.from("settings").update(patch).eq("id", 1);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );

  // ---------------- User management ----------------
  const addUser = useCallback<DataState["addUser"]>(
    async (input) => {
      const { quiet, ...payload } = input;
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { if (!quiet) notify(body.error || "Could not create user"); return { ok: false, error: body.error || "Could not create user" }; }
      if (!quiet) { notify(`User ${input.email} created`); reloadAll(); }
      return { ok: true, email: body.email, password: body.password };
    },
    [notify, reloadAll],
  );

  // Role, store, permissions and name are written straight from the browser,
  // so they are logged here rather than in an API route. Never blocks the
  // change it describes: a missing line beats a refused edit.
  const logSecurityClient = useCallback(async (
    targetId: string, kind: SecurityKind, detail: string | null,
  ) => {
    if (!me) return;
    const target = users.find((u) => u.id === targetId);
    try {
      await supabase.from("security_events").insert({
        actor_id: me.id, target_id: targetId,
        target_name: target?.full_name ?? null, kind, detail,
      });
    } catch { /* logging must never be the thing that fails */ }
  }, [supabase, me, users]);

  const setUserIdentity = useCallback<DataState["setUserIdentity"]>(async (id, patch) => {
    const res = await fetch("/api/user-identity", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { notify("Error: " + (data.error || res.statusText)); return { ok: false, error: data.error }; }
    await reloadAll();
    notify("Sign-in details updated");
    return { ok: true };
  }, [notify, reloadAll]);

  const resetUserPassword = useCallback<DataState["resetUserPassword"]>(async (id) => {
    const res = await fetch("/api/reset-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { notify("Error: " + (data.error || res.statusText)); return { ok: false, error: data.error }; }
    return { ok: true, password: data.password };
  }, [notify]);

  const updateUserRole = useCallback<DataState["updateUserRole"]>(
    async (userId, role) => {
      const before = users.find((u) => u.id === userId)?.role ?? null;
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
      const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
      if (error) { notify(error.message); reloadAll(); return; }
      void logSecurityClient(userId, "role_changed", change(before, role));
    },
    [supabase, notify, reloadAll, users, logSecurityClient],
  );

  const updateUserName = useCallback<DataState["updateUserName"]>(
    async (userId, name) => {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, full_name: name } : u)));
      const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", userId);
      if (error) notify(error.message);
    },
    [supabase, notify],
  );

  const updateUserStore = useCallback<DataState["updateUserStore"]>(
    async (userId, store) => {
      const before = users.find((u) => u.id === userId)?.store ?? null;
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, store } : u)));
      const { error } = await supabase.from("profiles").update({ store }).eq("id", userId);
      if (error) { notify(error.message); reloadAll(); return; }
      void logSecurityClient(userId, "store_changed", change(before, store));
    },
    [supabase, notify, reloadAll, users, logSecurityClient],
  );

  const updateUserPermissions = useCallback<DataState["updateUserPermissions"]>(
    async (userId, permissions) => {
      const before = users.find((u) => u.id === userId)?.permissions ?? [];
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, permissions } : u)));
      const { error } = await supabase.from("profiles").update({ permissions }).eq("id", userId);
      if (error) { notify(error.message); reloadAll(); return; }
      void logSecurityClient(userId, "permissions_changed", change(before, permissions));
    },
    [supabase, notify, reloadAll, users, logSecurityClient],
  );

  // Writes recruiting_role / module_access, never `role` — see the interface
  // comment above. A plain client-side update, not a service-role API route:
  // the guard_recruiting_access_change trigger on profiles is the actual
  // authority here, and it already requires the caller to be a DELIVERIES
  // admin (current_user_role() = 'admin') for a browser-authenticated write.
  // This page is already gated to deliveries admins (users/page.tsx), so the
  // trigger passes for exactly the people this UI lets reach the toggle — no
  // second route to keep in sync, and no service-role bypass of that check
  // (D-053; that bypass pattern was the actual authorization gap in
  // recruiting's own former Users page, see D-050/D-052).
  const updateUserRecruitingAccess = useCallback<DataState["updateUserRecruitingAccess"]>(
    async (userId, { granted, recruiting_role }) => {
      const target = users.find((u) => u.id === userId);
      const beforeRole = target?.recruiting_role ?? null;
      const nextRole = granted ? (recruiting_role ?? "recruiter") : null;
      const nextModules = granted
        ? Array.from(new Set([...(target?.module_access ?? []), "recruiting"]))
        : (target?.module_access ?? []).filter((m) => m !== "recruiting");
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, recruiting_role: nextRole, module_access: nextModules } : u)));
      const { error } = await supabase.from("profiles").update({ recruiting_role: nextRole, module_access: nextModules }).eq("id", userId);
      if (error) { notify(error.message); reloadAll(); return; }
      void logSecurityClient(userId, "recruiting_access_changed", change(beforeRole, nextRole));
    },
    [supabase, notify, reloadAll, users, logSecurityClient],
  );

  // Same shape as updateUserRecruitingAccess, one module over — writes
  // timetracker_role/module_access, authorized by guard_timetracker_access_
  // change (058), which requires a deliveries admin exactly like the
  // recruiting guard does (D-064).
  // The ERP has no role column of its own (D-090): access is the module_access
  // flag alone, and who may see cost is decided by `role` being admin/manager,
  // which updateUserRole already owns. So this writes one column, not two.
  const updateUserClockinAccess = useCallback<DataState["updateUserClockinAccess"]>(
    async (userId, { granted, clockin_role }) => {
      const target = users.find((u) => u.id === userId);
      const beforeRole = target?.clockin_role ?? null;
      const nextRole = granted ? (clockin_role ?? "employee") : null;
      const nextModules = granted
        ? Array.from(new Set([...(target?.module_access ?? []), "clockin"]))
        : (target?.module_access ?? []).filter((m) => m !== "clockin");
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, clockin_role: nextRole, module_access: nextModules } : u)));
      const { error } = await supabase.from("profiles").update({ clockin_role: nextRole, module_access: nextModules }).eq("id", userId);
      if (error) { notify(error.message); reloadAll(); return; }
      void logSecurityClient(userId, "clockin_access_changed", change(beforeRole, nextRole));
    },
    [supabase, notify, reloadAll, users, logSecurityClient],
  );

  /** Entregas dejó de ser implícita (D-100): ahora se otorga y se quita como el resto.
   *  Solo toca module_access — `role` es el rol DENTRO de entregas y no se pierde al
   *  quitarle el acceso, para que devolvérselo no obligue a recordar qué era. */
  const updateUserDeliveriesAccess = useCallback<DataState["updateUserDeliveriesAccess"]>(
    async (userId, { granted }) => {
      const target = users.find((u) => u.id === userId);
      const before = (target?.module_access ?? []).includes("deliveries");
      const nextModules = granted
        ? Array.from(new Set([...(target?.module_access ?? []), "deliveries"]))
        : (target?.module_access ?? []).filter((m) => m !== "deliveries");
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, module_access: nextModules } : u)));
      const { error } = await supabase.from("profiles").update({ module_access: nextModules }).eq("id", userId);
      if (error) { notify(error.message); reloadAll(); return; }
      void logSecurityClient(userId, "deliveries_access_changed", change(String(before), String(granted)));
    },
    [supabase, notify, reloadAll, users, logSecurityClient],
  );

  const updateUserErpAccess = useCallback<DataState["updateUserErpAccess"]>(
    async (userId, { granted }) => {
      const target = users.find((u) => u.id === userId);
      const before = (target?.module_access ?? []).includes("erp");
      const nextModules = granted
        ? Array.from(new Set([...(target?.module_access ?? []), "erp"]))
        : (target?.module_access ?? []).filter((m) => m !== "erp");
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, module_access: nextModules } : u)));
      const { error } = await supabase.from("profiles").update({ module_access: nextModules }).eq("id", userId);
      if (error) { notify(error.message); reloadAll(); return; }
      void logSecurityClient(userId, "erp_access_changed", change(String(before), String(granted)));
    },
    [supabase, notify, reloadAll, users, logSecurityClient],
  );

  const updateUserTimetrackerAccess = useCallback<DataState["updateUserTimetrackerAccess"]>(
    async (userId, { granted, timetracker_role }) => {
      const target = users.find((u) => u.id === userId);
      const beforeRole = target?.timetracker_role ?? null;
      const nextRole = granted ? (timetracker_role ?? "employee") : null;
      const nextModules = granted
        ? Array.from(new Set([...(target?.module_access ?? []), "timetracker"]))
        : (target?.module_access ?? []).filter((m) => m !== "timetracker");
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, timetracker_role: nextRole, module_access: nextModules } : u)));
      const { error } = await supabase.from("profiles").update({ timetracker_role: nextRole, module_access: nextModules }).eq("id", userId);
      if (error) { notify(error.message); reloadAll(); return; }
      void logSecurityClient(userId, "timetracker_access_changed", change(beforeRole, nextRole));
    },
    [supabase, notify, reloadAll, users, logSecurityClient],
  );

  const deleteUser = useCallback<DataState["deleteUser"]>(
    async (userId) => {
      const res = await fetch("/api/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { notify(body.error || "Delete failed"); return false; }
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      notify("User removed");
      return true;
    },
    [notify],
  );

  const addAvailability = useCallback<DataState["addAvailability"]>(async (seed) => {
    const { error } = await supabase.from("driver_availability").insert({ ...seed, created_by: me?.id ?? null });
    if (error) { notify("Error: " + error.message); return; }
    await reloadAll();
  }, [supabase, me, notify, reloadAll]);

  const removeAvailability = useCallback<DataState["removeAvailability"]>(async (id) => {
    const { error } = await supabase.from("driver_availability").delete().eq("id", id);
    if (error) { notify("Error: " + error.message); return; }
    await reloadAll();
  }, [supabase, notify, reloadAll]);

  const clockIn = useCallback<DataState["clockIn"]>(async (driverId) => {
    // Guard against a second open shift (also enforced by a partial unique index).
    if (shifts.some((sh) => sh.driver_id === driverId && !sh.ended_at)) return;
    // Which phone started the shift — only it reports position for it.
    const { error } = await supabase.from("driver_shifts").insert({ driver_id: driverId, device_id: deviceId() });
    if (error) { notify("Error: " + error.message); return; }
    await reloadAll();
  }, [supabase, shifts, notify, reloadAll]);

  const clockOut = useCallback<DataState["clockOut"]>(async (driverId) => {
    const open = shifts.find((sh) => sh.driver_id === driverId && !sh.ended_at);
    if (!open) return;
    const { error } = await supabase.from("driver_shifts").update({ ended_at: new Date().toISOString() }).eq("id", open.id);
    if (error) { notify("Error: " + error.message); return; }
    await reloadAll();
  }, [supabase, shifts, notify, reloadAll]);

  const addIncident = useCallback<DataState["addIncident"]>(async (inc) => {
    const { error } = await supabase.from("driver_incidents").insert({ ...inc, created_by: me?.id ?? null });
    if (error) { notify("Error: " + error.message); return false; }
    await reloadAll();
    return true;
  }, [supabase, me, notify, reloadAll]);

  const removeIncident = useCallback<DataState["removeIncident"]>(async (id) => {
    const { error } = await supabase.from("driver_incidents").delete().eq("id", id);
    if (error) { notify("Error: " + error.message); return; }
    await reloadAll();
  }, [supabase, notify, reloadAll]);

  const value: DataState = {
    ready, me: effectiveMe, realRole, viewAs, setViewAs, teaching, setTeaching, clearTrainingData, settings, users, deliveries: effectiveDeliveries, events, notifications, toast, notify,
    markNotifRead, markAllNotifsRead, pushNotifs,
    addDelivery, updateDelivery, reorderStops, deleteDelivery, setStage, eventsFor, addNote,
    saveSettings, addUser, setUserIdentity, resetUserPassword, updateUserRole, updateUserName, updateUserStore, updateUserPermissions, updateUserRecruitingAccess, updateUserTimetrackerAccess, updateUserErpAccess, updateUserDeliveriesAccess, updateUserClockinAccess, deleteUser,
    availability, addAvailability, removeAvailability,
    shifts, clockIn, clockOut,
    incidents, addIncident, removeIncident,
    driverLocations, pushLocation,
    pendingSync: outbox.length, syncing,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}
