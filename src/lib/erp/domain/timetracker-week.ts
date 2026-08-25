// The weekly timesheet: which week a session belongs to, and what it is worth.
// Ported from the Time Tracker app (ADR 0010).

/** ISO weekday of a calendar date, 0 = Sunday, built from the date parts rather than parsed. */
export function weekdayOfISO(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The start of the pay week a date falls in.
 *
 * `weekStartDay` is configurable per company — 0 = Sunday, 6 = Saturday — because a pay week is a
 * business decision, not a calendar fact. Everything else here keys off this one function, so
 * getting it wrong would shift every total by a day rather than fail visibly.
 */
export function weekStartISO(iso: string, weekStartDay = 0): string {
  const diff = (weekdayOfISO(iso) - weekStartDay + 7) % 7;
  return shiftISO(iso, -diff);
}

export const weekEndISO = (startISO: string) => shiftISO(startISO, 6);
export const addWeeks = (startISO: string, n: number) => shiftISO(startISO, n * 7);

/** "Jul 4 – Jul 10, 2026" */
export function weekLabel(startISO: string, locale = "en-US"): string {
  const day = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  const end = weekEndISO(startISO);
  return `${day(startISO)} – ${day(end)}, ${end.slice(0, 4)}`;
}

/** A week is finished once its last day is in the past — not merely once it has started. */
export function weekIsFinished(startISO: string, todayISO: string): boolean {
  return weekEndISO(startISO) < todayISO;
}

export interface PayInputs {
  hourly_rate?: number | string | null;
  overtime_rate?: number | string | null;
  overtime_threshold?: number | string | null;
  weekly_limit?: number | string | null;
}

export interface Pay {
  /** Hours that will actually be paid, after any weekly cap. */
  billable: number;
  /** Hours worked beyond the cap. Recorded, not paid — somebody has to see them. */
  overLimit: number;
  reg: number;
  ot: number;
  pay: number;
  rate: number;
  otRate: number;
}

/**
 * What a week of hours is worth on one assignment.
 *
 * The order matters and is the source's: the WEEKLY LIMIT is applied first, then overtime is worked
 * out on what is left. Doing it the other way round would pay overtime on hours the limit says are
 * not payable at all.
 *
 * An absent threshold or limit means "no cap", which is why they become Infinity rather than 0 —
 * treating a blank field as zero would silently reduce everyone to no billable hours. An absent
 * overtime rate falls back to the normal rate, so a missing setting never pays MORE by accident.
 */
export function computePay(hoursWorked: number, a: PayInputs): Pay {
  const num = (v: unknown) => Number(v) || 0;
  const cap = (v: unknown) => (v === "" || v == null ? Infinity : Number(v));

  const rate = num(a.hourly_rate);
  const otRate = num(a.overtime_rate) || rate;
  const otThresh = cap(a.overtime_threshold);
  const wLimit = cap(a.weekly_limit);

  const billable = Math.min(hoursWorked, wLimit);
  const overLimit = Math.max(0, hoursWorked - wLimit);
  const reg = Math.min(billable, otThresh);
  const ot = Math.max(0, billable - otThresh);

  return { billable, overLimit, reg, ot, pay: reg * rate + ot * otRate, rate, otRate };
}

export interface WeekSession {
  id: string;
  date?: string | null;
  assignment_id?: string | null;
  duration_seconds?: number | null;
  start_ms?: number | null;
  end_ms?: number | null;
  memo?: string | null;
  manual?: boolean | null;
}

export interface DayGroup<T> {
  date: string;
  seconds: number;
  items: T[];
}

/** Sessions grouped by day, newest day first, each day's entries in the order they happened. */
export function groupByDay<T extends WeekSession>(sessions: T[]): DayGroup<T>[] {
  const by = new Map<string, DayGroup<T>>();
  for (const s of sessions) {
    const d = s.date ?? "";
    let g = by.get(d);
    if (!g) {
      g = { date: d, seconds: 0, items: [] };
      by.set(d, g);
    }
    g.seconds += s.duration_seconds || 0;
    g.items.push(s);
  }
  return [...by.values()]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => (a.start_ms || 0) - (b.start_ms || 0)) }));
}

/** Seconds worked per assignment, which is what pay is calculated from. */
export function secondsByAssignment(sessions: WeekSession[]): Map<string, number> {
  const by = new Map<string, number>();
  for (const s of sessions) {
    const k = s.assignment_id ?? "";
    by.set(k, (by.get(k) ?? 0) + (s.duration_seconds || 0));
  }
  return by;
}
