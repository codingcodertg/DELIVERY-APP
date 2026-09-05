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
import { createClient } from "@/lib/timetracker/supabase/client";
import { rowToCamel, toSnakeRow } from "@/lib/timetracker/supabase/rowcase";
import { isDesktop } from "@/lib/timetracker/desktop";
import { APP_SETTINGS, type AppSettings, syncAppSettings } from "@/lib/timetracker/helpers";
import { initOfflineQueue } from "@/lib/timetracker/offlineQueue";
import type { AuditEntry, Assignment, Employee, Payroll, Project, RequestType, Screenshot, Session, TimeRequest } from "@/lib/timetracker/types";
import { checkSession, SESSION_EXPIRED, isAuthDenied } from "@/lib/session-guard";
import { SessionExpired } from "@/components/SessionExpired";

// ============================================================
// Etapa 2, pass 1 (D-066): foundation + the Track Time screen only. This
// DataState is deliberately narrower than the ~18-screen surface the full
// port eventually needs (projects/assignments/requests/payrolls/reports/
// live-monitor CRUD aren't here yet) — grown incrementally as each screen
// lands, same as recruiting-data-provider.tsx grew across D-050 through
// D-057 rather than arriving complete on day one.
//
// Row<->camel convention: every write/read here goes through
// toSnakeRow/rowToCamel (lib/timetracker/supabase/rowcase.ts), NOT the
// snake_case-everywhere shape recruiting-data-provider.tsx uses — see the
// comment on that module for why.
// ============================================================

interface DataState {
  ready: boolean;
  me: Employee;
  settings: AppSettings;
  projects: Project[];
  /** My own assignments, each with its `project` attached and archived
   * projects filtered out — mirrors the original's EmployeeDashboard
   * `myAssignments` computation exactly. */
  myAssignments: Assignment[];
  /** My own sessions, every one ever tracked (bounded by "one employee",
   * not company-wide — see the module comment on why this can be a plain
   * reloadAll() unlike the manager-facing screens still to come). */
  mySessions: Session[];
  /** My own payroll batches (one per paid/unpaid week). */
  myPayrolls: Payroll[];
  /** My own add/adjust/delete requests, pending or resolved. */
  myRequests: TimeRequest[];
  addRequest: (type: RequestType, payload: Record<string, unknown>) => Promise<void>;
  toast: string;
  notify: (msg: string) => void;

  // ---- sessions (Track Time) ----
  /** This employee's own currently-live (is_live=true) sessions — used to
   * detect and resolve the "already running elsewhere" conflict before a
   * new one starts, and to close out abandoned ones on load. */
  listLiveSessions: () => Promise<Session[]>;
  /** One of MY sessions by id, live or closed, or null. For the reopen-after-cron check
   * (D-NEXT): the screen needs to read a row that `listLiveSessions` no longer returns. */
  getSession: (id: string) => Promise<Session | null>;
  startSession: (payload: Partial<Session>) => Promise<Session>;
  updateSession: (id: string, patch: Partial<Session>) => Promise<void>;
  /** Same as updateSession but ONLY touches the row while it is still live (D-NEXT). For the
   * tracker's ten-second tick: after a laptop wakes, or after the cron closed the row, a
   * blind tick write must not retouch end_ms/duration_seconds of a closed session. Stop, the
   * explicit reopen, manual edits and approvals keep using updateSession, which writes
   * closed rows on purpose. A closed row makes this a silent no-op (zero rows), not an error. */
  updateLiveSession: (id: string, patch: Partial<Session>) => Promise<void>;

  // ---- screenshots (desktop-captured) ----
  myScreenshots: Screenshot[];
  latestScreenshot: Screenshot | null;
  screenshotSignedUrl: (path: string, expiresIn?: number) => Promise<string>;
  /** Own-delete only (RLS: employee_uid = auth.uid()) — mirrors the
   * original's deleteWithFile(): best-effort storage removal, then the
   * metadata row (which is what actually matters to the diary/manager). */
  deleteScreenshot: (id: string, path: string | null) => Promise<void>;
  /** Uploads the captured image, then inserts its metadata row (D-074, the
   * desktop bridge port) — mirrors the original's screenshots.upload(). */
  uploadScreenshot: (rec: { employeeUid: string; sessionId: string | null; blob: Blob; date: string | null; activityPercent: number }) => Promise<Screenshot>;
  /** Marker row for a segment with zero input — no image, so the diary shows
   * an empty tile instead of nothing. */
  insertBlankScreenshot: (rec: { employeeUid: string; sessionId: string | null; date: string | null }) => Promise<Screenshot>;

  // ---- account ----
  updateMyAccount: (patch: { fullName: string; city: string; payMethod: string; payDetails: string }) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  signOutEverywhere: () => Promise<void>;

  // ---- manager-only (D-070) ----
  // Empty arrays for a non-admin — never fetched for them, RLS would return
  // nothing anyway (is_timetracker_admin() gates every one of these), so
  // there's no wasted round trip. Reference data (who exists, what projects/
  // assignments/requests exist) via reloadAll()+realtime, same as everything
  // above. Sessions are NOT here: company-wide time entries are a genuinely
  // unbounded, ever-growing dataset — bulk-loading and realtime-subscribing
  // to ALL of them (the way `mySessions` safely does for ONE employee) would
  // not scale. Manager screens that need a time window call `sessionsSince`
  // on demand instead.
  allEmployees: Employee[];
  allProjects: Project[];
  allAssignments: Assignment[];
  allRequests: TimeRequest[];
  /** Latest 300, kept live — bounded the same way `myScreenshots`/audit
   * are, so a continuous subscription is fine here unlike raw sessions. */
  auditLog: AuditEntry[];
  logAudit: (action: string, detail: string) => Promise<void>;
  /** Currently-live (is_live=true) sessions, company-wide — kept live via
   * its own realtime channel. Bounded in practice (a handful of people
   * clocked in at once, not the full history), unlike `sessionsSince`. */
  liveSessions: Session[];
  /** On-demand, not part of reloadAll()/realtime — see the block comment
   * above. Every session (any employee) with date >= startISO, optionally
   * capped at endISO too (inclusive both ends). */
  sessionsSince: (startISO: string, endISO?: string) => Promise<Session[]>;
  sessionsByProject: (projectId: string) => Promise<Session[]>;
  insertSession: (payload: Partial<Session>) => Promise<Session>;
  removeSession: (id: string) => Promise<void>;
  payrollsForWeek: (weekOf: string) => Promise<Payroll[]>;
  insertPayroll: (payload: Partial<Payroll>) => Promise<Payroll>;
  updatePayroll: (id: string, patch: Partial<Payroll>) => Promise<void>;
  removePayroll: (id: string) => Promise<void>;
  insertProject: (payload: Partial<Project>) => Promise<void>;
  updateProject: (id: string, patch: Partial<Project>) => Promise<void>;
  insertAssignment: (payload: Partial<Assignment>) => Promise<void>;
  updateAssignment: (id: string, patch: Partial<Assignment>) => Promise<void>;
  removeAssignment: (id: string) => Promise<void>;
  /** Approve (updateIfPending) — atomically claims a still-pending request so
   * a double-click or two managers racing can only ever have one winner.
   * Returns the claimed row, or null if someone else already resolved it. */
  claimRequest: (id: string, patch: { status: "approved" | "rejected"; resolvedBy: string }) => Promise<TimeRequest | null>;
  resetRequestToPending: (id: string) => Promise<void>;
  /** Someone ELSE's module-specific settings — worker type/track mode/
   * breaks/active. Admin-only (RLS); mirrors updateMyAccount's upsert
   * shape but never touches full_name/pay info, which stay self-service.
   * No soft-delete/restore/purge here on purpose (D-071) — "remove from
   * timetracker" is already what unchecking the module in the hub's Users
   * dialog does (D-065); a second delete concept scoped to this module
   * would just be a confusing duplicate of that lifecycle. */
  updateEmployeeSettings: (employeeId: string, patch: { workerType?: string | null; trackMode?: string | null; breaksEnabled?: boolean | null; active?: boolean }) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const Ctx = createContext<DataState | null>(null);

export function useData(): DataState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

/** True if an error looks like a Postgres RLS rejection — almost always a
 * stale/absent JWT (auth.uid() came back null), fixable by a token refresh.
 * Ported from the original's isRlsError(); same reasoning. */
function isRlsError(e: unknown): boolean {
  // Vive en session-guard porque le faltaba un caso entero: sin sesión la petición sale como
  // `anon`, y desde 081 anon no tiene ni USAGE sobre el esquema, así que Postgres corta antes
  // de mirar ninguna política — "permission denied for schema timetracker". Eso no dice "row-
  // level security" por ningún lado, así que aquí no se reconocía y no se reintentaba con un
  // token nuevo: se le enseñaba el error crudo a la persona, en un alert.
  return isAuthDenied(e);
}

export function DataProvider({ children, me }: { children: React.ReactNode; me: Employee }) {
  const supabase = useMemo(() => createClient(), []);
  const [ready, setReady] = useState(false);
  const [authGone, setAuthGone] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(APP_SETTINGS);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [requests, setRequests] = useState<TimeRequest[]>([]);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);
  const [allRequests, setAllRequests] = useState<TimeRequest[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [liveSessions, setLiveSessions] = useState<Session[]>([]);
  const isAdmin = me.role === "admin";
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // In-app toast (always) plus a best-effort real OS notification (D-074,
  // matching timetracker-clean's notify.js) — so a weekly-limit warning or
  // "tracking started" still reaches someone who's alt-tabbed away. Skipped
  // on desktop: the Electron shell draws its own floating toast for these
  // same events (main.js's showInfoToast), and firing an HTML5 Notification
  // there too would just duplicate it as a second, uglier Windows toast.
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
    try {
      if (!isDesktop() && typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(msg);
      }
    } catch { /* ignore */ }
  }, []);

  // Ask for OS notification permission once, web-only (desktop draws its own
  // toasts and never needs this; see the comment on notify() above).
  useEffect(() => {
    try {
      if (isDesktop()) return;
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "default") Notification.requestPermission().catch(() => {});
    } catch { /* ignore */ }
  }, []);

  // Make sure we hold a live access token before an authenticated write.
  // Without this, a write can fire while the token is missing/expired —
  // Postgres sees auth.uid() = null and RLS rejects the row. Ported from
  // the original's auth.ensureSession()/forceRefresh().
  // Marcado cuando una carga se cae. El efecto de abajo lo mira para reintentar; sin él,
  // "no tener que refrescar" dependería de que el primer intento gane la carrera contra
  // la navegación que lo canceló.
  const loadFailedRef = useRef(false);
  // La sesión se murió del todo. En un ref además de en el estado porque el efecto de
  // recuperación se monta una sola vez y no vuelve a leer las props.
  const authGoneRef = useRef(false);
  // Intentos de la racha actual. Vuelve a cero al primer acierto.
  const retriesRef = useRef(0);
  const ensureSession = useCallback(async () => {
    // Devuelve si HAY sesión — ver el comentario largo en data-provider.tsx. Sin ella,
    // supabase-js manda la clave anónima y desde 081 eso es un 401, no unos datos.
    // Tres estados, no dos (ver session-guard.ts). El que faltaba es "gone": la sesión
    // caducó de verdad y reintentar no la va a resucitar. Antes ese caso se confundía con
    // un fallo pasajero, se reintentaba en vano y la pantalla se quedaba vacía y muda.
    const estado = await checkSession(supabase);
    if (estado === "gone") { authGoneRef.current = true; setAuthGone(true); }
    return estado === "ok";
  }, [supabase]);
  // Para ESCRIBIR no vale con intentarlo. Las lecturas pueden quedarse vacías y reintentar;
  // una escritura sin sesión sale como anónima, Postgres la rechaza por permisos y el mensaje
  // que llegaba a la pantalla era literalmente "permission denied for schema timetracker" —
  // un error de base de datos, en un alert, delante de alguien que solo quería fichar.
  const requireSession = useCallback(async () => {
    if (!(await ensureSession())) throw new Error(SESSION_EXPIRED);
  }, [ensureSession]);

  const forceRefresh = useCallback(async () => {
    await supabase.auth.refreshSession().catch(() => {});
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
      // Same reasoning as the write-side ensureSession above, extended to
      // reads (D-081): a stale token doesn't error a select, it just makes
      // RLS treat the request as anonymous and return an empty result —
      // which silently overwrites real state with nothing on the next
      // reload, no error anywhere. Hit this module for real the same day
      // (D-077/D-078/D-079's investigations all started from exactly this
      // symptom, though the timetracker cases turned out to have their own,
      // separate root causes too).
      // Sin sesión no se pregunta: desde 081 una consulta anónima ya no devuelve datos,
      // devuelve 401. Se marca como fallida y el efecto de recuperación reintenta en
      // cuanto la sesión aparezca — que es lo que pasa un instante después al hidratar.
      if (!(await ensureSession())) {
        loadFailedRef.current = true;
        return;
      }
      const [pr, asn, ss, py, rq, set] = await Promise.all([
        supabase.from("projects").select("*").eq("archived", false).order("created_at"),
        supabase.from("assignments").select("*").eq("employee_uid", me.id),
        supabase.from("sessions").select("*").eq("employee_uid", me.id),
        supabase.from("payrolls").select("*").eq("employee_uid", me.id),
        supabase.from("requests").select("*").eq("employee_uid", me.id),
        supabase.from("settings").select("*").eq("id", "app").maybeSingle(),
      ]);
      const projectRows = ((pr.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Project>(r)!);
      setProjects(projectRows);
      const byId = new Map(projectRows.map((p) => [p.id, p]));
      const asnRows = ((asn.data as Record<string, unknown>[] | null) ?? [])
        .map((r) => rowToCamel<Omit<Assignment, "project">>(r)!)
        .map((a) => ({ ...a, project: byId.get(a.projectId) }))
        .filter((a): a is Assignment => !!a.project);
      setAssignments(asnRows);
      setSessions(((ss.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Session>(r)!));
      setPayrolls(((py.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Payroll>(r)!));
      setRequests(((rq.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<TimeRequest>(r)!));
      if (set.data) {
        const merged: AppSettings = { ...APP_SETTINGS, ...((set.data as { data: Partial<AppSettings> }).data) };
        syncAppSettings(merged);
        setSettings({ ...APP_SETTINGS });
      }
      setReady(true);

      // Un error DEVUELTO no es una excepción: supabase-js contesta { data: null, error }
      // sin lanzar nada, así que Promise.all resolvía tan tranquilo, los setters se
      // saltaban por `if (x.data)` y la pantalla quedaba vacía y "lista". Ese es el
      // camino exacto del 401 anónimo: ni un error visible, ni un reintento.
      const fallo = [pr, asn, ss, py, rq, set].some((r) => r && "error" in r && r.error);
      loadFailedRef.current = fallo;
      if (!fallo) retriesRef.current = 0;
    } catch {
      loadFailedRef.current = true;
    } finally {
      setReady(true);
    }
  }, [supabase, me.id, ensureSession]);

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
      // Sin sesión no se reintenta: cada intento sale como anónimo y desde 081 eso es un
      // 401. Lo que desbloquea esto es volver a entrar, y para eso está el aviso.
      if (authGoneRef.current) return;
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
  }, []);


  // Manager-only reference data (D-070) — gated to isAdmin so a non-admin
  // never even issues these queries (RLS would empty them anyway, but no
  // sense paying for round trips nobody can use).
  const reloadAdmin = useCallback(async () => {
    if (!isAdmin) return;
    await ensureSession();
    const [pf, es, pr, asn, rq, au] = await Promise.all([
      supabase.schema("public").from("profiles")
        .select("id, full_name, timetracker_role")
        .not("timetracker_role", "is", null)
        .order("full_name"),
      supabase.from("employee_settings").select("*"),
      supabase.from("projects").select("*").order("created_at"),
      supabase.from("assignments").select("*"),
      supabase.from("requests").select("*").order("created_at", { ascending: false }),
      supabase.from("audit").select("*").order("at", { ascending: false }).limit(300),
    ]);
    const esById = new Map(
      ((es.data as Record<string, unknown>[] | null) ?? []).map((r) => [r.id as string, rowToCamel<Omit<Employee, "id" | "fullName" | "role" | "email">>(r)!]),
    );
    const employees = ((pf.data as { id: string; full_name: string | null; timetracker_role: string }[] | null) ?? []).map((p) => {
      const s = esById.get(p.id);
      const emp: Employee = {
        id: p.id, fullName: p.full_name ?? "—", email: null, role: p.timetracker_role as Employee["role"],
        city: s?.city ?? null, payMethod: s?.payMethod ?? null, payDetails: s?.payDetails ?? null,
        workerType: s?.workerType ?? null, trackMode: s?.trackMode ?? null, breaksEnabled: s?.breaksEnabled ?? null,
        active: s?.active ?? false, deletedAt: s?.deletedAt ?? null,
      };
      return emp;
    });
    // Live employees only — soft-deleted (deleted_at set) are filtered out
    // everywhere the app lists people, same as the original's subscribeAll().
    setAllEmployees(employees.filter((e) => !e.deletedAt));
    const projectRows = ((pr.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Project>(r)!);
    setAllProjects(projectRows);
    const byId = new Map(projectRows.map((p) => [p.id, p]));
    setAllAssignments(
      ((asn.data as Record<string, unknown>[] | null) ?? [])
        .map((r) => rowToCamel<Omit<Assignment, "project">>(r)!)
        .map((a) => ({ ...a, project: byId.get(a.projectId) }))
        .filter((a): a is Assignment => !!a.project),
    );
    setAllRequests(((rq.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<TimeRequest>(r)!));
    setAuditLog(((au.data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<AuditEntry>(r)!));
  }, [supabase, isAdmin, ensureSession]);

  useEffect(() => {
    reloadAll();
    // Narrow, filtered realtime — NOT a blunt "reload on any change to this
    // table" like recruiting-data-provider.tsx uses. sessions/screenshots
    // tick every ~10s while ANYONE is tracking; an unfiltered subscription
    // here would reload every employee's whole session history on every
    // other employee's tick. Filtered to `employee_uid=eq.<me>` so only
    // MY OWN writes (this tab, another tab, or the desktop app) trigger it.
    const channel = supabase
      .channel(`timetracker:${me.id}`)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "projects" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "assignments", filter: `employee_uid=eq.${me.id}` }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "sessions", filter: `employee_uid=eq.${me.id}` }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "payrolls", filter: `employee_uid=eq.${me.id}` }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "requests", filter: `employee_uid=eq.${me.id}` }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "settings" }, reloadAll)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, me.id, reloadAll]);

  // Manager-only reference data — its own effect/channel so a non-admin
  // never opens it at all (isAdmin is stable per session; role changes
  // require a re-login, same as every other role check in this app).
  useEffect(() => {
    if (!isAdmin) return;
    reloadAdmin();
    const channel = supabase
      .channel(`timetracker-admin:${me.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, reloadAdmin)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "employee_settings" }, reloadAdmin)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "projects" }, reloadAdmin)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "assignments" }, reloadAdmin)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "requests" }, reloadAdmin)
      .on("postgres_changes", { event: "INSERT", schema: "timetracker", table: "audit" }, reloadAdmin)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, me.id, isAdmin, reloadAdmin]);

  // Company-wide "who's clocked in right now" — bounded in practice (a
  // handful of live rows at once), unlike the full session history, so a
  // continuous realtime subscription is fine here.
  useEffect(() => {
    if (!isAdmin) return;
    const load = async () => {
      const { data } = await supabase.from("sessions").select("*").eq("is_live", true);
      setLiveSessions(((data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Session>(r)!));
    };
    load();
    const channel = supabase
      .channel(`timetracker-live:${me.id}`)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "sessions", filter: "is_live=eq.true" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, me.id, isAdmin]);

  const sessionsSince = useCallback<DataState["sessionsSince"]>(async (startISO, endISO) => {
    if (!isAdmin) return [];
    let q = supabase.from("sessions").select("*").gte("date", startISO);
    if (endISO) q = q.lte("date", endISO);
    const { data, error } = await q;
    if (error) throw error;
    return ((data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Session>(r)!);
  }, [supabase, isAdmin]);

  const sessionsByProject = useCallback<DataState["sessionsByProject"]>(async (projectId) => {
    const { data, error } = await supabase.from("sessions").select("*").eq("project_id", projectId);
    if (error) throw error;
    return ((data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Session>(r)!);
  }, [supabase]);

  // My own screenshots — desktop-captured, so this stays empty for anyone
  // tracking only from the web (there's no browser screenshot capture; see
  // ARCHITECTURE.md on why). Filtered realtime, same reasoning as sessions.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("screenshots").select("*").eq("employee_uid", me.id)
        .order("taken_at", { ascending: false });
      if (!cancelled) setScreenshots(((data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Screenshot>(r)!));
    };
    load();
    const channel = supabase
      .channel(`timetracker-shots:${me.id}`)
      .on("postgres_changes", { event: "*", schema: "timetracker", table: "screenshots", filter: `employee_uid=eq.${me.id}` }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, me.id]);

  const listLiveSessions = useCallback<DataState["listLiveSessions"]>(async () => {
    const { data, error } = await supabase
      .from("sessions").select("*").eq("employee_uid", me.id).eq("is_live", true);
    if (error) throw error;
    return ((data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Session>(r)!);
  }, [supabase, me.id]);

  const getSession = useCallback<DataState["getSession"]>(async (id) => {
    const { data, error } = await supabase
      .from("sessions").select("*").eq("id", id).eq("employee_uid", me.id).maybeSingle();
    if (error) throw error;
    return data ? rowToCamel<Session>(data as Record<string, unknown>)! : null;
  }, [supabase, me.id]);

  const startSession = useCallback<DataState["startSession"]>(async (payload) => {
    await requireSession();
    const row = toSnakeRow(payload as Record<string, unknown>);
    try {
      const { data, error } = await supabase.from("sessions").insert(row).select().single();
      if (error) throw error;
      return rowToCamel<Session>(data as Record<string, unknown>)!;
    } catch (e) {
      if (!isRlsError(e)) throw e;
      // RLS rejection almost always means a stale JWT — force a fresh token
      // and retry once before giving up (ported from the original).
      await forceRefresh();
      const { data, error } = await supabase.from("sessions").insert(row).select().single();
      if (error) throw error;
      return rowToCamel<Session>(data as Record<string, unknown>)!;
    }
  }, [supabase, requireSession, forceRefresh]);

  const updateSession = useCallback<DataState["updateSession"]>(async (id, patch) => {
    const row = toSnakeRow(patch as Record<string, unknown>);
    const { error } = await supabase.from("sessions").update(row).eq("id", id);
    if (error) throw error;
  }, [supabase]);

  const updateLiveSession = useCallback<DataState["updateLiveSession"]>(async (id, patch) => {
    const row = toSnakeRow(patch as Record<string, unknown>);
    const { error } = await supabase.from("sessions").update(row).eq("id", id).eq("is_live", true);
    if (error) throw error;
  }, [supabase]);

  // Same insert-with-retry shape as startSession — a manager adding a
  // manual entry (or approving an "add time" request) for ANY employee is
  // just an insert; is_timetracker_admin() covers writing someone else's
  // employee_uid, same as every other admin write in this module.
  const insertSession = useCallback<DataState["insertSession"]>(async (payload) => {
    await requireSession();
    const row = toSnakeRow(payload as Record<string, unknown>);
    try {
      const { data, error } = await supabase.from("sessions").insert(row).select().single();
      if (error) throw error;
      return rowToCamel<Session>(data as Record<string, unknown>)!;
    } catch (e) {
      if (!isRlsError(e)) throw e;
      await forceRefresh();
      const { data, error } = await supabase.from("sessions").insert(row).select().single();
      if (error) throw error;
      return rowToCamel<Session>(data as Record<string, unknown>)!;
    }
  }, [supabase, requireSession, forceRefresh]);

  const removeSession = useCallback<DataState["removeSession"]>(async (id) => {
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) throw error;
  }, [supabase]);

  const payrollsForWeek = useCallback<DataState["payrollsForWeek"]>(async (weekOf) => {
    const { data, error } = await supabase.from("payrolls").select("*").eq("week_of", weekOf);
    if (error) throw error;
    return ((data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Payroll>(r)!);
  }, [supabase]);

  const insertPayroll = useCallback<DataState["insertPayroll"]>(async (payload) => {
    await requireSession();
    const row = toSnakeRow(payload as Record<string, unknown>);
    const { data, error } = await supabase.from("payrolls").insert(row).select().single();
    if (error) throw error;
    return rowToCamel<Payroll>(data as Record<string, unknown>)!;
  }, [supabase, requireSession]);

  const updatePayroll = useCallback<DataState["updatePayroll"]>(async (id, patch) => {
    await requireSession();
    const row = toSnakeRow(patch as Record<string, unknown>);
    const { error } = await supabase.from("payrolls").update(row).eq("id", id);
    if (error) throw error;
  }, [supabase, requireSession]);

  const removePayroll = useCallback<DataState["removePayroll"]>(async (id) => {
    const { error } = await supabase.from("payrolls").delete().eq("id", id);
    if (error) throw error;
  }, [supabase]);

  const insertProject = useCallback<DataState["insertProject"]>(async (payload) => {
    const row = toSnakeRow(payload as Record<string, unknown>);
    const { error } = await supabase.from("projects").insert(row);
    if (error) throw error;
  }, [supabase]);

  const updateProject = useCallback<DataState["updateProject"]>(async (id, patch) => {
    const row = toSnakeRow(patch as Record<string, unknown>);
    const { error } = await supabase.from("projects").update(row).eq("id", id);
    if (error) throw error;
  }, [supabase]);

  const insertAssignment = useCallback<DataState["insertAssignment"]>(async (payload) => {
    const row = toSnakeRow(payload as Record<string, unknown>);
    const { error } = await supabase.from("assignments").insert(row);
    if (error) throw error;
  }, [supabase]);

  const updateAssignment = useCallback<DataState["updateAssignment"]>(async (id, patch) => {
    const row = toSnakeRow(patch as Record<string, unknown>);
    const { error } = await supabase.from("assignments").update(row).eq("id", id);
    if (error) throw error;
  }, [supabase]);

  const removeAssignment = useCallback<DataState["removeAssignment"]>(async (id) => {
    const { error } = await supabase.from("assignments").delete().eq("id", id);
    if (error) throw error;
  }, [supabase]);

  const claimRequest = useCallback<DataState["claimRequest"]>(async (id, patch) => {
    const row = toSnakeRow({ ...patch, resolvedAt: new Date().toISOString() });
    const { data, error } = await supabase.from("requests").update(row).eq("id", id).eq("status", "pending").select().maybeSingle();
    if (error) throw error;
    return data ? rowToCamel<TimeRequest>(data as Record<string, unknown>) : null;
  }, [supabase]);

  const resetRequestToPending = useCallback<DataState["resetRequestToPending"]>(async (id) => {
    const { error } = await supabase.from("requests").update({ status: "pending", resolved_at: null, resolved_by: null }).eq("id", id);
    if (error) throw error;
  }, [supabase]);

  const updateEmployeeSettings = useCallback<DataState["updateEmployeeSettings"]>(async (employeeId, patch) => {
    const row = toSnakeRow({ id: employeeId, ...patch });
    const { error } = await supabase.from("employee_settings").upsert(row);
    if (error) throw error;
  }, [supabase]);

  const updateSettings = useCallback<DataState["updateSettings"]>(async (patch) => {
    const merged: AppSettings = { ...APP_SETTINGS, ...patch };
    await requireSession();
    const { error } = await supabase.from("settings").update({ data: merged }).eq("id", "app");
    if (error) throw error;
  }, [supabase, requireSession]);

  const logAudit = useCallback<DataState["logAudit"]>(async (action, detail) => {
    try { await supabase.from("audit").insert({ who: me.id, action, detail: detail || "" }); }
    catch { /* best-effort, matches the original's .catch(()=>{}) */ }
  }, [supabase, me.id]);

  const screenshotSignedUrl = useCallback<DataState["screenshotSignedUrl"]>(async (path, expiresIn = 3600) => {
    const { data, error } = await supabase.storage.from("timetracker-screenshots").createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  }, [supabase]);

  const addRequest = useCallback<DataState["addRequest"]>(async (type, payload) => {
    const row = toSnakeRow({ employeeUid: me.id, type, status: "pending", payload });
    const { error } = await supabase.from("requests").insert(row);
    if (error) throw error;
  }, [supabase, me.id]);

  const deleteScreenshot = useCallback<DataState["deleteScreenshot"]>(async (id, path) => {
    if (path) { try { await supabase.storage.from("timetracker-screenshots").remove([path]); } catch { /* best-effort */ } }
    const { error } = await supabase.from("screenshots").delete().eq("id", id);
    if (error) throw error;
  }, [supabase]);

  const uploadScreenshot = useCallback<DataState["uploadScreenshot"]>(async ({ employeeUid, sessionId, blob, date, activityPercent }) => {
    const path = `${employeeUid}/${sessionId || "misc"}/${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from("timetracker-screenshots")
      .upload(path, blob, { contentType: "image/jpeg" });
    if (upErr) throw upErr;
    const row = toSnakeRow({ employeeUid, sessionId: sessionId || null, path, date: date || null, activityPercent: activityPercent || 0 });
    const { data, error } = await supabase.from("screenshots").insert(row).select().single();
    if (error) throw error;
    return rowToCamel<Screenshot>(data as Record<string, unknown>)!;
  }, [supabase]);

  const insertBlankScreenshot = useCallback<DataState["insertBlankScreenshot"]>(async ({ employeeUid, sessionId, date }) => {
    const row = toSnakeRow({ employeeUid, sessionId: sessionId || null, path: null, date: date || null, activityPercent: 0, noActivity: true });
    const { data, error } = await supabase.from("screenshots").insert(row).select().single();
    if (error) throw error;
    return rowToCamel<Screenshot>(data as Record<string, unknown>)!;
  }, [supabase]);

  // profiles.full_name lives in `public` (shared identity); employee_settings
  // (city/pay info) lives in `timetracker` — two writes, same split D-066
  // already established for reads. employee_settings may not have a row yet
  // (nobody creates one on grant — see layout.tsx), so this upserts.
  const updateMyAccount = useCallback<DataState["updateMyAccount"]>(async (patch) => {
    const [p, es] = await Promise.all([
      supabase.schema("public").from("profiles").update({ full_name: patch.fullName.trim() }).eq("id", me.id),
      supabase.from("employee_settings").upsert({
        id: me.id, city: patch.city.trim(), pay_method: patch.payMethod || null, pay_details: patch.payDetails.trim(),
      }),
    ]);
    if (p.error) throw p.error;
    if (es.error) throw es.error;
  }, [supabase, me.id]);

  const updatePassword = useCallback<DataState["updatePassword"]>(async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }, [supabase]);

  const signOutEverywhere = useCallback<DataState["signOutEverywhere"]>(async () => {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) throw error;
  }, [supabase]);

  // Flush any session patches / screenshots buffered locally from a prior
  // dropped connection, and keep retrying on an interval + on reconnect
  // (D-074). Works on web too; most valuable on the desktop app, where a
  // field site's flaky wifi shouldn't lose tracked time.
  useEffect(() => { initOfflineQueue({ updateSession, uploadScreenshot }); }, [updateSession, uploadScreenshot]);

  const value: DataState = {
    ready, me, settings, projects, myAssignments: assignments, mySessions: sessions, myPayrolls: payrolls,
    myRequests: requests, addRequest,
    toast, notify,
    listLiveSessions, getSession, startSession, updateSession, updateLiveSession,
    myScreenshots: screenshots, latestScreenshot: screenshots[0] ?? null, screenshotSignedUrl, deleteScreenshot,
    uploadScreenshot, insertBlankScreenshot,
    updateMyAccount, updatePassword, signOutEverywhere,
    allEmployees, allProjects, allAssignments, allRequests, sessionsSince, sessionsByProject,
    auditLog, logAudit, liveSessions,
    insertSession, removeSession,
    payrollsForWeek, insertPayroll, updatePayroll, removePayroll,
    insertProject, updateProject, insertAssignment, updateAssignment, removeAssignment,
    claimRequest, resetRequestToPending, updateEmployeeSettings, updateSettings,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && <div className="toast">{toast}</div>}
      {authGone && <SessionExpired />}
    </Ctx.Provider>
  );
}
