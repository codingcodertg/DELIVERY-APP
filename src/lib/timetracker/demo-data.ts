import type { Assignment, AuditEntry, Employee, Payroll, Project, Screenshot, Session, TimeRequest } from "@/lib/timetracker/types";
import type { TalonDePago, TarifaPorHora } from "@/lib/timetracker/talon-de-pago";
import { APP_SETTINGS, type AppSettings, dateISO, weekStartISO } from "@/lib/timetracker/helpers";

// ============================================================
// Semilla del MODO DEMO de Time Tracker (sin base ni sesión), para los vídeos tutoriales.
//
// Pura: nada de React ni de navegador, y la fecha entra por argumento (`now`), nunca se lee dentro.
// Una prueba con la fecha real pasa en local y cae en el CI tras la medianoche UTC; con un `now`
// fijo la semilla es la misma en las dos máquinas. Todos los nombres son inventados.
// ============================================================

/** Asignación tal como se guarda: sin el `project` pegado, que se deriva al leer. */
export type AsignacionGuardada = Omit<Assignment, "project">;

export interface SemillaDemo {
  settings: AppSettings;
  employees: Employee[];
  projects: Project[];
  assignments: AsignacionGuardada[];
  sessions: Session[];
  requests: TimeRequest[];
  payrolls: Payroll[];
  audit: AuditEntry[];
  screenshots: Screenshot[];
  payRates: (TarifaPorHora & { employeeUid: string })[];
  paystubs: TalonDePago[];
}

const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;

/** El admin del demo: remoto con cronómetro por actividad, para que el Start/Stop se vea en el tutorial. */
export const ADMIN_DEMO: Employee = {
  id: "u-admin",
  fullName: "You (Admin)",
  email: "admin@demo.local",
  role: "admin",
  city: "McAllen",
  payMethod: "Bank transfer",
  payDetails: "",
  workerType: "remote",
  trackMode: "activity",
  breaksEnabled: true,
  active: true,
  deletedAt: null,
  tienda: "McAllen",
  puesto: "office",
};

export const DEMO_EMPLOYEES: Employee[] = [
  ADMIN_DEMO,
  { id: "u-carla", fullName: "Carla Cajera", email: "carla@demo.local", role: "employee", city: "McAllen", payMethod: "Cash", payDetails: "", workerType: "inhouse", trackMode: "inout", breaksEnabled: true, active: true, deletedAt: null, tienda: "McAllen", puesto: "sales" },
  { id: "u-pedro", fullName: "Pedro Piso", email: "pedro@demo.local", role: "employee", city: "Pharr", payMethod: "Cash", payDetails: "", workerType: "inhouse", trackMode: "inout", breaksEnabled: true, active: true, deletedAt: null, tienda: "Pharr", puesto: "warehouse" },
  { id: "u-lucia", fullName: "Lucia Logistica", email: "lucia@demo.local", role: "employee", city: "Edinburg", payMethod: "Bank transfer", payDetails: "", workerType: "inhouse", trackMode: "inout", breaksEnabled: false, active: true, deletedAt: null, tienda: "Edinburg", puesto: "office" },
  { id: "u-rita", fullName: "Rita Remota", email: "rita@demo.local", role: "employee", city: "Monterrey", payMethod: "PayPal", payDetails: "rita@demo.local", workerType: "remote", trackMode: "activity", breaksEnabled: true, active: true, deletedAt: null, tienda: null, puesto: null },
];

export const DEMO_PROJECTS: Project[] = [
  { id: "p-tienda", name: "McAllen Store", location: "McAllen", client: "RTG", category: "Retail", positions: ["sales", "office"], payPeriod: "weekly", archived: false, weekStartDay: 5, createdAt: "2026-01-05T15:00:00.000Z" },
  { id: "p-almacen", name: "Pharr Warehouse", location: "Pharr", client: "RTG", category: "Warehouse", positions: ["warehouse"], payPeriod: "weekly", archived: false, weekStartDay: 5, createdAt: "2026-01-05T15:05:00.000Z" },
  { id: "p-remoto", name: "Remote Office", location: "Remote", client: "RTG", category: "Back office", positions: ["office"], payPeriod: "weekly", archived: false, weekStartDay: 5, createdAt: "2026-01-05T15:10:00.000Z" },
];

export const DEMO_ASSIGNMENTS: AsignacionGuardada[] = [
  { id: "a-admin", employeeUid: "u-admin", projectId: "p-remoto", hourlyRate: 25, overtimeRate: 37.5, overtimeThreshold: 40, weeklyLimit: null, paymentMethod: "Bank transfer", createdAt: "2026-01-06T15:00:00.000Z" },
  { id: "a-carla", employeeUid: "u-carla", projectId: "p-tienda", hourlyRate: 14, overtimeRate: 21, overtimeThreshold: 40, weeklyLimit: 45, paymentMethod: "Cash", createdAt: "2026-01-06T15:01:00.000Z" },
  { id: "a-pedro", employeeUid: "u-pedro", projectId: "p-almacen", hourlyRate: 15, overtimeRate: 22.5, overtimeThreshold: 40, weeklyLimit: 45, paymentMethod: "Cash", createdAt: "2026-01-06T15:02:00.000Z" },
  { id: "a-lucia", employeeUid: "u-lucia", projectId: "p-tienda", hourlyRate: 16, overtimeRate: 24, overtimeThreshold: 40, weeklyLimit: null, paymentMethod: "Bank transfer", createdAt: "2026-01-06T15:03:00.000Z" },
  { id: "a-rita", employeeUid: "u-rita", projectId: "p-remoto", hourlyRate: 12, overtimeRate: null, overtimeThreshold: null, weeklyLimit: 40, paymentMethod: "PayPal", createdAt: "2026-01-06T15:04:00.000Z" },
];

export const DEMO_PAY_RATES: (TarifaPorHora & { employeeUid: string })[] = [
  { employeeUid: "u-carla", hourlyRate: 14, otMultiplier: 1.5, otWeeklyHours: 40 },
  { employeeUid: "u-pedro", hourlyRate: 15, otMultiplier: 1.5, otWeeklyHours: 40 },
  { employeeUid: "u-lucia", hourlyRate: 16, otMultiplier: 1.5, otWeeklyHours: 40 },
];

/** Las 9:00 locales de hace `diasAtras` días respecto a `now`. */
function lasNueveDe(now: number, diasAtras: number): number {
  const d = new Date(now - diasAtras * DIA_MS);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

/** Horas verosímiles y deterministas (4,5 h – 8,5 h), distintas por persona y día. */
function horasDe(indicePersona: number, diasAtras: number): number {
  return 4.5 + (((indicePersona * 7 + diasAtras * 3) % 9) / 2);
}

/** Sesiones CERRADAS de los últimos 14 días de cada asignación (sin hoy, que es el día de grabar). */
export function demoSessions(now: number): Session[] {
  const out: Session[] = [];
  DEMO_ASSIGNMENTS.forEach((a, i) => {
    const quien = DEMO_EMPLOYEES.find((e) => e.id === a.employeeUid)!;
    for (let diasAtras = 1; diasAtras <= 14; diasAtras++) {
      const inicio = lasNueveDe(now, diasAtras);
      if (new Date(inicio).getDay() === 0) continue; // domingo: la tienda descansa
      const horas = horasDe(i, diasAtras);
      const dur = Math.round(horas * 3600);
      const fin = inicio + dur * 1000;
      const remoto = quien.workerType === "remote";
      out.push({
        id: `s-${a.id}-${diasAtras}`,
        employeeUid: a.employeeUid,
        employeeName: quien.fullName,
        projectId: a.projectId,
        assignmentId: a.id,
        payrollId: null,
        memo: remoto ? (diasAtras % 3 === 0 ? "Inventory reconciliation" : "Orders and follow-ups") : "",
        weekOf: weekStartISO(inicio),
        date: dateISO(inicio),
        startMs: inicio,
        endMs: fin,
        durationSeconds: dur,
        activeSeconds: remoto ? Math.round(dur * 0.82) : dur,
        idleSeconds: remoto ? Math.round(dur * 0.18) : 0,
        screenSeconds: remoto ? dur : 0,
        keystrokes: remoto ? 1800 + diasAtras * 97 : 0,
        clicks: remoto ? 600 + diasAtras * 31 : 0,
        lunchSeconds: horas > 6 ? 1800 : 0,
        breakSeconds: 0,
        breakEvents: horas > 6 ? [{ kind: "lunch", start: inicio + 4 * HORA_MS, end: inicio + 4 * HORA_MS + 1800_000 }] : [],
        manual: !remoto,
        source: remoto ? "web" : "manual",
        isLive: false,
        liveNote: null,
        createdAt: new Date(fin).toISOString(),
      });
    }
  });
  return out;
}

/** Dos pendientes y una aprobada, con fechas dentro de los 14 días. */
export function demoRequests(now: number): TimeRequest[] {
  const hace = (d: number) => new Date(now - d * DIA_MS).toISOString();
  return [
    {
      id: "r-add-rita", employeeUid: "u-rita", type: "add", status: "pending", resolvedAt: null, resolvedBy: null, createdAt: hace(1),
      payload: { date: dateISO(now - 2 * DIA_MS), projectId: "p-remoto", startMs: lasNueveDe(now, 2) + 13 * HORA_MS, endMs: lasNueveDe(now, 2) + 15 * HORA_MS, memo: "Forgot to start the timer after lunch" },
    },
    {
      id: "r-adjust-carla", employeeUid: "u-carla", type: "adjust", status: "pending", resolvedAt: null, resolvedBy: null, createdAt: hace(2),
      payload: { sessionId: "s-a-carla-3", endMs: lasNueveDe(now, 3) + 9 * HORA_MS, memo: "Stayed to close the register" },
    },
    {
      id: "r-delete-pedro", employeeUid: "u-pedro", type: "delete", status: "approved", resolvedAt: hace(5), resolvedBy: "u-admin", createdAt: hace(6),
      payload: { sessionId: "s-a-pedro-7", memo: "Duplicate entry" },
    },
  ];
}

/** La nómina de la semana pasada de la remota, ya pagada. */
export function demoPayrolls(now: number): Payroll[] {
  const semanaPasada = weekStartISO(now - 7 * DIA_MS);
  const horas = 32.5;
  return [{
    id: "py-rita-1",
    employeeUid: "u-rita",
    employeeName: "Rita Remota",
    weekOf: semanaPasada,
    method: "PayPal",
    lines: [{ projectId: "p-remoto", hours: horas, regular: horas, ot: 0, pay: horas * 12 }],
    adjustments: [{ label: "Bonus", amount: 20 }],
    total: horas * 12 + 20,
    paid: true,
    paidAt: new Date(now - 4 * DIA_MS).toISOString(),
    paidBy: "u-admin",
    draft: false,
    sessionCount: 5,
    createdAt: new Date(now - 4 * DIA_MS).toISOString(),
  }];
}

export function demoAudit(now: number): AuditEntry[] {
  const hace = (h: number) => new Date(now - h * HORA_MS).toISOString();
  return [
    { id: "au-1", who: "u-admin", action: "payroll.paid", detail: "Rita Remota · last week · $410.00", at: hace(96) },
    { id: "au-2", who: "u-admin", action: "request.approved", detail: "Pedro Piso · delete · duplicate entry", at: hace(120) },
    { id: "au-3", who: "u-admin", action: "assignment.updated", detail: "Lucia Logistica · McAllen Store · $16/h", at: hace(150) },
    { id: "au-4", who: "u-admin", action: "project.created", detail: "Remote Office", at: hace(200) },
    { id: "au-5", who: "u-admin", action: "settings.updated", detail: "weekStartDay=5", at: hace(260) },
  ];
}

/** Dos capturas en blanco (sin imagen) del admin, de ayer: el diario enseña la casilla vacía. */
export function demoScreenshots(now: number): Screenshot[] {
  const ayer = lasNueveDe(now, 1);
  return [0, 1].map((i) => ({
    id: `sh-${i}`,
    employeeUid: "u-admin",
    sessionId: "s-a-admin-1",
    path: null,
    url: null,
    takenAt: new Date(ayer + (i + 1) * 10 * 60_000).toISOString(),
    date: dateISO(ayer),
    activityPercent: 0,
    noActivity: true,
  }));
}

export function semillaDemo(now: number): SemillaDemo {
  return {
    settings: { ...APP_SETTINGS, appName: "TimeTracker", companyName: "Demo Tile Co.", locations: [{ name: "McAllen", weekStartDay: 5 }, { name: "Pharr", weekStartDay: 5 }, { name: "Remote", weekStartDay: 5 }] },
    employees: DEMO_EMPLOYEES,
    projects: DEMO_PROJECTS,
    assignments: DEMO_ASSIGNMENTS,
    sessions: demoSessions(now),
    requests: demoRequests(now),
    payrolls: demoPayrolls(now),
    audit: demoAudit(now),
    screenshots: demoScreenshots(now),
    payRates: DEMO_PAY_RATES,
    paystubs: [],
  };
}

/** Horas cronometradas por persona entre dos fechas ISO (ambas incluidas), para la cabecera de Nómina del demo. */
export function horasPorPersona(sessions: Session[], startISO: string, endISO: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) {
    if (!s.date || s.date < startISO || s.date > endISO || s.isLive) continue;
    m.set(s.employeeUid, (m.get(s.employeeUid) ?? 0) + s.durationSeconds / 3600);
  }
  return m;
}
