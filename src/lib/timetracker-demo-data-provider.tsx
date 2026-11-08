"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ctx, type DataState } from "@/lib/timetracker-data-provider";
import { APP_SETTINGS, type AppSettings, syncAppSettings } from "@/lib/timetracker/helpers";
import type { AuditEntry, Assignment, Employee, Payroll, Project, Screenshot, Session, TimeRequest } from "@/lib/timetracker/types";
import type { TalonDePago, TarifaPorHora } from "@/lib/timetracker/talon-de-pago";
import { type AsignacionGuardada, type SemillaDemo, semillaDemo } from "@/lib/timetracker/demo-data";

// ============================================================
// MODO DEMO de Time Tracker — sin base ni sesión. Todo vive en el navegador (memoria + localStorage),
// con la MISMA interfaz `DataState` que el proveedor real y montado en el mismo `Ctx`, así `useData()`
// vale sin cambios en ninguna pantalla. Calcado de `local-data-provider.tsx` (Entregas). Para grabar los
// vídeos tutoriales (pedido del dueño, 2026-11-08). Nada de red: ni Supabase, ni Storage, ni Notification.
// ============================================================

/** Sube el sufijo cuando cambie la forma de la semilla, para que los navegadores con datos viejos resiembren. */
export const LS_KEY_TT_DEMO = "rtg_timetracker_local_v1";

type Store = SemillaDemo;

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id_" + Math.random().toString(36).slice(2) + Date.now().toString(36);

function load(): Store {
  if (typeof window === "undefined") return semillaDemo(Date.now());
  try {
    const raw = window.localStorage.getItem(LS_KEY_TT_DEMO);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* corrupto: se resiembra */
  }
  const s = semillaDemo(Date.now());
  window.localStorage.setItem(LS_KEY_TT_DEMO, JSON.stringify(s));
  return s;
}

export function resetTimetrackerDemo() {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LS_KEY_TT_DEMO, JSON.stringify(semillaDemo(Date.now())));
    window.location.reload();
  }
}

/** Una captura sin imagen real: un cuadro gris con la leyenda, como data URL. */
const CAPTURA_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="100%" height="100%" fill="#2a2f3a"/><text x="50%" y="50%" fill="#9aa4b2" font-family="sans-serif" font-size="16" text-anchor="middle">Demo screenshot</text></svg>');

function filaDeSesion(p: Partial<Session>): Session {
  const ahora = Date.now();
  return {
    id: p.id ?? uid(),
    employeeUid: p.employeeUid ?? "",
    employeeName: p.employeeName ?? null,
    projectId: p.projectId ?? null,
    assignmentId: p.assignmentId ?? null,
    payrollId: p.payrollId ?? null,
    memo: p.memo ?? "",
    weekOf: p.weekOf ?? null,
    date: p.date ?? null,
    startMs: p.startMs ?? null,
    endMs: p.endMs ?? null,
    durationSeconds: p.durationSeconds ?? 0,
    activeSeconds: p.activeSeconds ?? 0,
    idleSeconds: p.idleSeconds ?? 0,
    screenSeconds: p.screenSeconds ?? 0,
    keystrokes: p.keystrokes ?? 0,
    clicks: p.clicks ?? 0,
    lunchSeconds: p.lunchSeconds ?? 0,
    breakSeconds: p.breakSeconds ?? 0,
    breakEvents: p.breakEvents ?? [],
    manual: p.manual ?? false,
    source: p.source ?? "web",
    isLive: p.isLive ?? false,
    liveNote: p.liveNote ?? null,
    createdAt: p.createdAt ?? new Date(ahora).toISOString(),
  };
}

function filaDeNomina(p: Partial<Payroll>): Payroll {
  return {
    id: p.id ?? uid(),
    employeeUid: p.employeeUid ?? "",
    employeeName: p.employeeName ?? null,
    weekOf: p.weekOf ?? null,
    method: p.method ?? null,
    lines: p.lines ?? [],
    adjustments: p.adjustments ?? [],
    total: p.total ?? 0,
    paid: p.paid ?? false,
    paidAt: p.paidAt ?? null,
    paidBy: p.paidBy ?? null,
    draft: p.draft ?? false,
    sessionCount: p.sessionCount ?? 0,
    createdAt: p.createdAt ?? new Date().toISOString(),
  };
}

function filaDeProyecto(p: Partial<Project>): Project {
  return {
    id: p.id ?? uid(),
    name: p.name ?? "",
    location: p.location ?? "",
    client: p.client ?? "",
    category: p.category ?? "",
    positions: p.positions ?? [],
    payPeriod: p.payPeriod ?? "weekly",
    archived: p.archived ?? false,
    weekStartDay: p.weekStartDay ?? null,
    createdAt: p.createdAt ?? new Date().toISOString(),
  };
}

function filaDeAsignacion(p: Partial<Assignment>): AsignacionGuardada {
  return {
    id: p.id ?? uid(),
    employeeUid: p.employeeUid ?? "",
    projectId: p.projectId ?? "",
    hourlyRate: p.hourlyRate ?? 0,
    overtimeRate: p.overtimeRate ?? null,
    overtimeThreshold: p.overtimeThreshold ?? null,
    weeklyLimit: p.weeklyLimit ?? null,
    paymentMethod: p.paymentMethod ?? null,
    createdAt: p.createdAt ?? new Date().toISOString(),
  };
}

function conProyecto(asigs: AsignacionGuardada[], proyectos: Project[]): Assignment[] {
  const byId = new Map(proyectos.map((p) => [p.id, p]));
  return asigs
    .map((a) => ({ ...a, project: byId.get(a.projectId) }))
    .filter((a): a is Assignment => !!a.project);
}

export function DemoDataProvider({ children, me: meInicial }: { children: React.ReactNode; me: Employee }) {
  // En el servidor y en el primer pintado del navegador el almacén va vacío; se carga en un efecto
  // para que el HTML del servidor y el primer render del cliente coincidan (igual que LocalApp).
  const [store, setStore] = useState<Store>(() => ({ ...semillaDemo(Date.now()), sessions: [], requests: [], payrolls: [], audit: [], screenshots: [] }));
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Espejo del almacén que se actualiza SÍNCRONO en cada escritura: dos escrituras seguidas en el
  // mismo tick (parar y arrancar) no deben leer un estado viejo.
  const storeRef = useRef<Store>(store);
  const persist = useCallback((next: Store) => {
    storeRef.current = next;
    setStore(next);
    try { window.localStorage.setItem(LS_KEY_TT_DEMO, JSON.stringify(next)); } catch { /* sin sitio: se queda en memoria */ }
  }, []);
  const mutate = useCallback((fn: (s: Store) => Store) => { persist(fn(storeRef.current)); }, [persist]);

  useEffect(() => {
    const s = load();
    storeRef.current = s;
    setStore(s);
    syncAppSettings(s.settings);
    setReady(true);
  }, []);

  const notify = useCallback<DataState["notify"]>((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  const me = useMemo<Employee>(() => store.employees.find((e) => e.id === meInicial.id) ?? meInicial, [store.employees, meInicial]);
  const isAdmin = me.role === "admin";

  const projects = useMemo(() => store.projects.filter((p) => !p.archived), [store.projects]);
  const allAssignments = useMemo(() => conProyecto(store.assignments, store.projects), [store.assignments, store.projects]);
  const myAssignments = useMemo(() => allAssignments.filter((a) => a.employeeUid === me.id && !a.project.archived), [allAssignments, me.id]);
  const mySessions = useMemo(() => store.sessions.filter((s) => s.employeeUid === me.id), [store.sessions, me.id]);
  const myPayrolls = useMemo(() => store.payrolls.filter((p) => p.employeeUid === me.id), [store.payrolls, me.id]);
  const myRequests = useMemo(() => store.requests.filter((r) => r.employeeUid === me.id), [store.requests, me.id]);
  const myScreenshots = useMemo(
    () => store.screenshots.filter((s) => s.employeeUid === me.id).sort((a, b) => b.takenAt.localeCompare(a.takenAt)),
    [store.screenshots, me.id],
  );
  const liveSessions = useMemo(() => (isAdmin ? store.sessions.filter((s) => s.isLive) : []), [store.sessions, isAdmin]);
  const auditLog = useMemo(() => [...store.audit].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300), [store.audit]);

  const ensureSessionsSince = useCallback<DataState["ensureSessionsSince"]>(async () => { /* todo está ya en memoria */ }, []);

  const addRequest = useCallback<DataState["addRequest"]>(async (type, payload) => {
    const r: TimeRequest = { id: uid(), employeeUid: me.id, type, payload, status: "pending", resolvedAt: null, resolvedBy: null, createdAt: new Date().toISOString() };
    mutate((s) => ({ ...s, requests: [r, ...s.requests] }));
  }, [mutate, me.id]);

  const listLiveSessions = useCallback<DataState["listLiveSessions"]>(async () =>
    storeRef.current.sessions.filter((s) => s.employeeUid === me.id && s.isLive), [me.id]);

  const getSession = useCallback<DataState["getSession"]>(async (id) =>
    storeRef.current.sessions.find((s) => s.id === id && s.employeeUid === me.id) ?? null, [me.id]);

  const startSession = useCallback<DataState["startSession"]>(async (payload) => {
    const row = filaDeSesion(payload);
    mutate((s) => ({ ...s, sessions: [row, ...s.sessions] }));
    return row;
  }, [mutate]);

  const updateSession = useCallback<DataState["updateSession"]>(async (id, patch) => {
    mutate((s) => ({ ...s, sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  }, [mutate]);

  // Igual que en la base: una fila cerrada afecta a CERO filas y eso se devuelve (D-241).
  const updateLiveSession = useCallback<DataState["updateLiveSession"]>(async (id, patch) => {
    const viva = storeRef.current.sessions.some((x) => x.id === id && x.isLive);
    if (!viva) return false;
    mutate((s) => ({ ...s, sessions: s.sessions.map((x) => (x.id === id && x.isLive ? { ...x, ...patch } : x)) }));
    return true;
  }, [mutate]);

  const refrescarSesion = useCallback<DataState["refrescarSesion"]>(async () => true, []);

  const screenshotSignedUrl = useCallback<DataState["screenshotSignedUrl"]>(async (path) =>
    path.startsWith("blob:") || path.startsWith("data:") ? path : CAPTURA_PLACEHOLDER, []);

  const deleteScreenshot = useCallback<DataState["deleteScreenshot"]>(async (id, path) => {
    if (path && path.startsWith("blob:")) { try { URL.revokeObjectURL(path); } catch { /* ya no existe */ } }
    mutate((s) => ({ ...s, screenshots: s.screenshots.filter((x) => x.id !== id) }));
  }, [mutate]);

  const uploadScreenshot = useCallback<DataState["uploadScreenshot"]>(async ({ employeeUid, sessionId, blob, date, activityPercent }) => {
    const path = URL.createObjectURL(blob);
    const row: Screenshot = { id: uid(), employeeUid, sessionId: sessionId || null, path, url: path, takenAt: new Date().toISOString(), date: date || null, activityPercent: activityPercent || 0, noActivity: false };
    mutate((s) => ({ ...s, screenshots: [row, ...s.screenshots] }));
    return row;
  }, [mutate]);

  const insertBlankScreenshot = useCallback<DataState["insertBlankScreenshot"]>(async ({ employeeUid, sessionId, date }) => {
    const row: Screenshot = { id: uid(), employeeUid, sessionId: sessionId || null, path: null, url: null, takenAt: new Date().toISOString(), date: date || null, activityPercent: 0, noActivity: true };
    mutate((s) => ({ ...s, screenshots: [row, ...s.screenshots] }));
    return row;
  }, [mutate]);

  const updateMyAccount = useCallback<DataState["updateMyAccount"]>(async (patch) => {
    mutate((s) => ({
      ...s,
      employees: s.employees.map((e) => (e.id === me.id
        ? { ...e, fullName: patch.fullName.trim(), city: patch.city.trim(), payMethod: patch.payMethod || null, payDetails: patch.payDetails.trim() }
        : e)),
    }));
  }, [mutate, me.id]);

  const signOutEverywhere = useCallback<DataState["signOutEverywhere"]>(async () => {
    notify("Demo: no hay sesión que cerrar / nothing to sign out of");
  }, [notify]);

  const logAudit = useCallback<DataState["logAudit"]>(async (action, detail) => {
    const e: AuditEntry = { id: uid(), who: me.id, action, detail: detail || "", at: new Date().toISOString() };
    mutate((s) => ({ ...s, audit: [e, ...s.audit] }));
  }, [mutate, me.id]);

  const sessionsSince = useCallback<DataState["sessionsSince"]>(async (startISO, endISO) => {
    if (!isAdmin) return [];
    return storeRef.current.sessions.filter((s) => !!s.date && s.date >= startISO && (!endISO || s.date <= endISO));
  }, [isAdmin]);

  const sessionsByProject = useCallback<DataState["sessionsByProject"]>(async (projectId) =>
    storeRef.current.sessions.filter((s) => s.projectId === projectId), []);

  const insertSession = useCallback<DataState["insertSession"]>(async (payload) => {
    const row = filaDeSesion(payload);
    mutate((s) => ({ ...s, sessions: [row, ...s.sessions] }));
    return row;
  }, [mutate]);

  const removeSession = useCallback<DataState["removeSession"]>(async (id) => {
    mutate((s) => ({ ...s, sessions: s.sessions.filter((x) => x.id !== id) }));
  }, [mutate]);

  const payrollsForWeek = useCallback<DataState["payrollsForWeek"]>(async (weekOf) =>
    storeRef.current.payrolls.filter((p) => p.weekOf === weekOf), []);

  const insertPayroll = useCallback<DataState["insertPayroll"]>(async (payload) => {
    const row = filaDeNomina(payload);
    mutate((s) => ({ ...s, payrolls: [row, ...s.payrolls] }));
    return row;
  }, [mutate]);

  const updatePayroll = useCallback<DataState["updatePayroll"]>(async (id, patch) => {
    mutate((s) => ({ ...s, payrolls: s.payrolls.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  }, [mutate]);

  const removePayroll = useCallback<DataState["removePayroll"]>(async (id) => {
    mutate((s) => ({ ...s, payrolls: s.payrolls.filter((x) => x.id !== id) }));
  }, [mutate]);

  const payRates = useCallback<DataState["payRates"]>(async () => storeRef.current.payRates, []);

  const savePayRate = useCallback<DataState["savePayRate"]>(async (employeeUid, tarifa) => {
    const fila: TarifaPorHora & { employeeUid: string } = { employeeUid, hourlyRate: tarifa.hourlyRate, otMultiplier: tarifa.otMultiplier, otWeeklyHours: tarifa.otWeeklyHours };
    mutate((s) => ({ ...s, payRates: [...s.payRates.filter((r) => r.employeeUid !== employeeUid), fila] }));
  }, [mutate]);

  const paystubsForPeriod = useCallback<DataState["paystubsForPeriod"]>(async (periodStart) =>
    storeRef.current.paystubs.filter((t) => t.periodStart === periodStart), []);

  const paystubsForYear = useCallback<DataState["paystubsForYear"]>(async (year, employeeUids) => {
    if (!employeeUids.length) return [];
    const ini = `${year}-01-01`, fin = `${year}-12-31`;
    return storeRef.current.paystubs.filter((t) => employeeUids.includes(t.employeeUid) && t.periodStart >= ini && t.periodStart <= fin);
  }, []);

  // Como la base: un talón que ya existe (misma persona y periodo, o mismo lote) se deja como está.
  const insertPaystubs = useCallback<DataState["insertPaystubs"]>(async (stubs) => {
    if (!stubs.length) return;
    mutate((s) => {
      const nuevos: TalonDePago[] = [];
      for (const t of stubs) {
        const repetido = [...s.paystubs, ...nuevos].some((x) =>
          (x.employeeUid === t.employeeUid && x.periodStart === t.periodStart && x.kind === t.kind) || (!!t.payrollId && x.payrollId === t.payrollId));
        if (!repetido) nuevos.push({ ...t, id: t.id ?? uid(), createdAt: t.createdAt ?? new Date().toISOString() });
      }
      return { ...s, paystubs: [...s.paystubs, ...nuevos] };
    });
  }, [mutate]);

  const removePaystubOfPayroll = useCallback<DataState["removePaystubOfPayroll"]>(async (payrollId) => {
    mutate((s) => ({ ...s, paystubs: s.paystubs.filter((t) => t.payrollId !== payrollId) }));
  }, [mutate]);

  const insertProject = useCallback<DataState["insertProject"]>(async (payload) => {
    mutate((s) => ({ ...s, projects: [...s.projects, filaDeProyecto(payload)] }));
  }, [mutate]);

  const updateProject = useCallback<DataState["updateProject"]>(async (id, patch) => {
    mutate((s) => ({ ...s, projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  }, [mutate]);

  const insertAssignment = useCallback<DataState["insertAssignment"]>(async (payload) => {
    mutate((s) => ({ ...s, assignments: [...s.assignments, filaDeAsignacion(payload)] }));
  }, [mutate]);

  const updateAssignment = useCallback<DataState["updateAssignment"]>(async (id, patch) => {
    const { project: _p, ...resto } = patch;
    void _p;
    mutate((s) => ({ ...s, assignments: s.assignments.map((a) => (a.id === id ? { ...a, ...resto } : a)) }));
  }, [mutate]);

  const removeAssignment = useCallback<DataState["removeAssignment"]>(async (id) => {
    mutate((s) => ({ ...s, assignments: s.assignments.filter((a) => a.id !== id) }));
  }, [mutate]);

  // Atómico en el sentido del demo: solo gana si sigue pendiente, como el `.eq("status","pending")` real.
  const claimRequest = useCallback<DataState["claimRequest"]>(async (id, patch) => {
    const actual = storeRef.current.requests.find((r) => r.id === id);
    if (!actual || actual.status !== "pending") return null;
    const resuelta: TimeRequest = { ...actual, status: patch.status, resolvedBy: patch.resolvedBy, resolvedAt: new Date().toISOString() };
    mutate((s) => ({ ...s, requests: s.requests.map((r) => (r.id === id ? resuelta : r)) }));
    return resuelta;
  }, [mutate]);

  const resetRequestToPending = useCallback<DataState["resetRequestToPending"]>(async (id) => {
    mutate((s) => ({ ...s, requests: s.requests.map((r) => (r.id === id ? { ...r, status: "pending", resolvedAt: null, resolvedBy: null } : r)) }));
  }, [mutate]);

  const updateEmployeeSettings = useCallback<DataState["updateEmployeeSettings"]>(async (employeeId, patch) => {
    mutate((s) => ({
      ...s,
      employees: s.employees.map((e) => (e.id === employeeId
        ? {
          ...e,
          workerType: patch.workerType === undefined ? e.workerType : (patch.workerType as Employee["workerType"]),
          trackMode: patch.trackMode === undefined ? e.trackMode : (patch.trackMode as Employee["trackMode"]),
          breaksEnabled: patch.breaksEnabled === undefined ? e.breaksEnabled : patch.breaksEnabled,
          active: patch.active === undefined ? e.active : patch.active,
        }
        : e)),
    }));
  }, [mutate]);

  const updateSettings = useCallback<DataState["updateSettings"]>(async (patch) => {
    const merged: AppSettings = { ...APP_SETTINGS, ...patch };
    syncAppSettings(merged);
    mutate((s) => ({ ...s, settings: merged }));
  }, [mutate]);

  const value: DataState = {
    ready, me, settings: store.settings, projects, myAssignments, mySessions, ensureSessionsSince, myPayrolls,
    myRequests, addRequest,
    toast, notify,
    listLiveSessions, getSession, startSession, updateSession, updateLiveSession, refrescarSesion,
    myScreenshots, latestScreenshot: myScreenshots[0] ?? null, screenshotSignedUrl, deleteScreenshot,
    uploadScreenshot, insertBlankScreenshot,
    updateMyAccount, signOutEverywhere,
    allEmployees: isAdmin ? store.employees : [], allProjects: isAdmin ? store.projects : [], allAssignments: isAdmin ? allAssignments : [],
    allRequests: isAdmin ? store.requests : [], sessionsSince, sessionsByProject,
    auditLog: isAdmin ? auditLog : [], logAudit, liveSessions,
    insertSession, removeSession,
    payrollsForWeek, insertPayroll, updatePayroll, removePayroll,
    payRates, savePayRate, paystubsForPeriod, paystubsForYear, insertPaystubs, removePaystubOfPayroll,
    insertProject, updateProject, insertAssignment, updateAssignment, removeAssignment,
    claimRequest, resetRequestToPending, updateEmployeeSettings, updateSettings,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}
