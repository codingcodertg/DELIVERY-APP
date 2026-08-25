// The recruiter's daily action list. Ported from the recruiting app (ADR 0010).
//
// Nothing here is stored: every list is derived on read from data the other screens already track.
// That is deliberate in the source and worth keeping — a "today" list held in its own table drifts
// out of step with the records it describes, and then has to be reconciled.

import { terminalKeys, type Stage, type BoardCandidate } from "./recruiting-board";

/** Hours after an in-person interview before an unrecorded verdict starts nagging. */
export const OUTCOME_GRACE_HOURS = 3;

export interface TodayCandidate extends BoardCandidate {
  inperson_date?: string | null;
  follow_up?: string | null;
  reg_date?: string | null;
}

/**
 * Is this timestamp on the given calendar day, in business time?
 *
 * The source compares against the RUNTIME's local date, which puts a 7pm Central interview on
 * tomorrow's list for a server running UTC. Here the day is taken from a caller-supplied ISO date,
 * which every page derives from todayISO() in business time — the same correction made to the
 * on-time calculation in delivery-analytics.
 */
export function isOnDay(iso: string | null | undefined, dayISO: string): boolean {
  if (!iso) return false;
  return String(iso).slice(0, 10) === dayISO;
}

export function outcomeDueAt(c: TodayCandidate): Date | null {
  if (!c.inperson_date) return null;
  return new Date(new Date(c.inperson_date).getTime() + OUTCOME_GRACE_HOURS * 3600_000);
}

/** Interviewed in person, still sitting in that stage, with no verdict recorded. */
export function awaitingOutcome(c: TodayCandidate): boolean {
  return !c.archived && !!c.inperson_date && c.status === "inperson";
}

/** Awaiting a verdict AND past the grace period. This is what nags. */
export function outcomeDue(c: TodayCandidate, now: Date = new Date()): boolean {
  if (!awaitingOutcome(c)) return false;
  const due = outcomeDueAt(c);
  return !!due && due <= now;
}

/** Rough "2h 10m" / "3d 4h" since a moment passed, for overdue labels. */
export function sinceLabel(iso: string | Date, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (ms < 0) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

export interface TodayEvent<T> {
  candidate: T;
  kind: "phone" | "inperson";
  at: string;
}

export interface TodayLists<T> {
  interviews: TodayEvent<T>[];
  outcomesDue: T[];
  followUps: T[];
  awaitingFirstCall: T[];
  total: number;
}

/**
 * Everything needing a recruiter's attention right now.
 *
 * Archived candidates are excluded from every list at the top, once, rather than in each filter —
 * missing it in one place is how an archived candidate reappears on exactly one screen.
 */
export function todayLists<T extends TodayCandidate>(
  candidates: T[],
  stages: Stage[],
  dayISO: string,
  now: Date = new Date()
): TodayLists<T> {
  const active = candidates.filter((c) => !c.archived);
  const terminal = terminalKeys(stages);

  const interviews: TodayEvent<T>[] = active
    .flatMap((c) => {
      const out: TodayEvent<T>[] = [];
      if (isOnDay(c.phone_date, dayISO)) out.push({ candidate: c, kind: "phone", at: c.phone_date! });
      if (isOnDay(c.inperson_date, dayISO))
        out.push({ candidate: c, kind: "inperson", at: c.inperson_date! });
      return out;
    })
    .sort((a, b) => a.at.localeCompare(b.at));

  const outcomesDue = active
    .filter((c) => outcomeDue(c, now))
    .sort((a, b) => (a.inperson_date || "").localeCompare(b.inperson_date || ""));

  // A follow-up due today or any day before it — an overdue one does not stop being due.
  const followUps = active
    .filter((c) => c.follow_up && c.follow_up <= dayISO && !terminal.has(c.status))
    .sort((a, b) => (a.follow_up || "").localeCompare(b.follow_up || ""));

  const awaitingFirstCall = active
    .filter((c) => c.status === "registered" && !c.phone_date)
    .sort((a, b) => String(a.reg_date ?? "").localeCompare(String(b.reg_date ?? "")));

  return {
    interviews,
    outcomesDue,
    followUps,
    awaitingFirstCall,
    total: interviews.length + outcomesDue.length + followUps.length + awaitingFirstCall.length,
  };
}
