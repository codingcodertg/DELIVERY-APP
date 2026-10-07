// App-facing (camelCase) shapes for the timetracker module. Mirrors the
// Postgres row shape one level deep — jsonb columns (payload, lines,
// adjustments, breakEvents) are passed through untouched, same convention
// timetracker's own original data layer used (see D-066).

export type TimetrackerRole = "admin" | "employee";

// Assembled client-side from public.profiles (identity) + timetracker.
// employee_settings (module-specific fields) — two tables now, where the
// original single-project app had one `profiles` row. See D-064/D-065.
export interface Employee {
  id: string;
  fullName: string;
  /** From auth.users, not public.profiles (which has no email column here —
   * see D-069). Read-only in this module; changing it is an account-level
   * action outside timetracker's scope. */
  email: string | null;
  role: TimetrackerRole;
  city: string | null;
  payMethod: string | null;
  payDetails: string | null;
  workerType: "remote" | "inhouse" | null;
  trackMode: "activity" | "inout" | null;
  breaksEnabled: boolean | null;
  /** Pending until a timetracker admin activates them — independent of
   * whether they even HAVE the module (see employee_settings.active, 059). */
  active: boolean;
  deletedAt: string | null;
  /** Su tienda: la de fichaje (`clockin.job_sites` por su `store_id`) o, sin ella, la del hub
   * (`profiles.store`). Es el «proyecto» del presencial (D-NEXT): ver `tienda-y-puesto.ts`. */
  tienda?: string | null;
  /** Su puesto de fichaje (`clockin.employee_settings.position`: sales, office…). Ídem. */
  puesto?: string | null;
}

export interface Project {
  id: string;
  name: string;
  location: string;
  client: string;
  category: string;
  positions: string[];
  payPeriod: "weekly" | "biweekly" | "monthly";
  archived: boolean;
  weekStartDay: number | null;
  createdAt: string;
}

export interface Assignment {
  id: string;
  employeeUid: string;
  projectId: string;
  hourlyRate: number;
  overtimeRate: number | null;
  overtimeThreshold: number | null;
  weeklyLimit: number | null;
  paymentMethod: string | null;
  createdAt: string;
  /** Attached client-side for convenience (Tracker/Reports read a.project.*
   * constantly) — never written back, always derived from `projects`. */
  project: Project;
}

export interface BreakEvent { kind: "lunch" | "break"; start: number; end: number | null }

export interface Session {
  id: string;
  employeeUid: string;
  employeeName: string | null;
  projectId: string | null;
  assignmentId: string | null;
  payrollId: string | null;
  memo: string;
  weekOf: string | null;
  date: string | null;
  startMs: number | null;
  endMs: number | null;
  durationSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  screenSeconds: number;
  keystrokes: number;
  clicks: number;
  lunchSeconds: number;
  breakSeconds: number;
  breakEvents: BreakEvent[];
  manual: boolean;
  source: string;
  isLive: boolean;
  liveNote: string | null;
  createdAt: string;
}

export type RequestType = "add" | "adjust" | "delete";
export type RequestStatus = "pending" | "approved" | "rejected";

export interface TimeRequest {
  id: string;
  employeeUid: string;
  type: RequestType | null;
  payload: Record<string, unknown>;
  status: RequestStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

export interface PayrollLine { projectId?: string; hours?: number; regular?: number; ot?: number; pay?: number; note?: string; [k: string]: unknown }
export interface PayrollAdjustment { label: string; amount: number }

export interface Payroll {
  id: string;
  employeeUid: string;
  employeeName: string | null;
  weekOf: string | null;
  method: string | null;
  lines: PayrollLine[];
  adjustments: PayrollAdjustment[];
  total: number;
  paid: boolean;
  paidAt: string | null;
  paidBy: string | null;
  draft: boolean;
  sessionCount: number;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  who: string | null;
  action: string | null;
  detail: string | null;
  at: string;
}

export interface Screenshot {
  id: string;
  employeeUid: string;
  sessionId: string | null;
  path: string | null;
  url: string | null;
  takenAt: string;
  date: string | null;
  activityPercent: number;
  noActivity: boolean;
}
