// Time-tracker presentation helpers (ADR 0010). Framework-free (ADR 0006).
//
// The tracker records seconds; people read hours. These do that conversion in one place so a
// timesheet, a week total and a payroll line can never disagree about what 3,725 seconds is.

/** Seconds → "1h 02m". Rounds to the nearest minute, which is how timesheets are read. */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds ?? 0)));
  const totalMin = Math.round(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Seconds → decimal hours, 2dp. What payroll multiplies by a rate. */
export function toHours(seconds: number | null | undefined): number {
  return Math.round((Math.max(0, Number(seconds ?? 0)) / 3600) * 100) / 100;
}

/**
 * Active share of a session, 0-100.
 *
 * Returns null rather than 0 when there is no tracked time: "no data" and "idle the whole time" are
 * different facts, and showing 0% for a session that never started would read as a performance
 * problem that did not happen.
 */
export function activityPct(
  activeSeconds: number | null | undefined,
  durationSeconds: number | null | undefined
): number | null {
  const d = Number(durationSeconds ?? 0);
  if (!d || d <= 0) return null;
  const a = Math.max(0, Number(activeSeconds ?? 0));
  return Math.round((a / d) * 100);
}

export interface SessionLike {
  employee_uid?: string | null;
  employee_name?: string | null;
  date?: string | null;
  duration_seconds?: number | null;
  active_seconds?: number | null;
  idle_seconds?: number | null;
  keystrokes?: number | null;
  clicks?: number | null;
  manual?: boolean | null;
}

export interface EmployeeTotals {
  employee: string;
  sessions: number;
  seconds: number;
  activeSeconds: number;
  hours: number;
  activityPct: number | null;
  manualCount: number;
}

/**
 * Roll sessions up per employee, heaviest first.
 *
 * Manual entries are counted separately rather than excluded: they are legitimate (a forgotten
 * clock-in gets added back) but a timesheet that is mostly manual is worth seeing as such.
 */
export function employeeTotals(sessions: SessionLike[]): EmployeeTotals[] {
  const map = new Map<string, EmployeeTotals>();
  for (const s of sessions) {
    const key = s.employee_name || s.employee_uid || "—";
    const t =
      map.get(key) ??
      { employee: key, sessions: 0, seconds: 0, activeSeconds: 0, hours: 0, activityPct: null, manualCount: 0 };
    t.sessions++;
    t.seconds += Math.max(0, Number(s.duration_seconds ?? 0));
    t.activeSeconds += Math.max(0, Number(s.active_seconds ?? 0));
    if (s.manual) t.manualCount++;
    map.set(key, t);
  }
  return [...map.values()]
    .map((t) => ({ ...t, hours: toHours(t.seconds), activityPct: activityPct(t.activeSeconds, t.seconds) }))
    .sort((a, b) => b.seconds - a.seconds);
}
