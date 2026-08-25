import { todayISO } from "./business-time";

/**
 * The interview calendar.
 *
 * Every date here is resolved in BUSINESS time, not the viewer's. An interview at 7pm Central is
 * still that day for the office in McAllen, but a recruiter checking from a laptop set to UTC would
 * otherwise see it land on the next day — and a calendar that puts an interview on the wrong day is
 * worse than no calendar. `todayISO(date)` is the existing helper for "what business day is this
 * instant", so the rule is enforced by reuse rather than by remembering.
 */

export type InterviewKind = "phone" | "inperson";

export interface CalendarCandidate {
  id: string;
  name: string | null;
  role: string | null;
  phone: string | null;
  phone_date: string | null;
  inperson_date: string | null;
}

export interface CalendarEvent {
  candidateId: string;
  name: string;
  role: string | null;
  phone: string | null;
  kind: InterviewKind;
  /** The original timestamp. */
  at: string;
  /** The business day it falls on, as YYYY-MM-DD. */
  day: string;
}

/** Every scheduled interview across all candidates, as flat events, sorted by time. */
export function interviewEvents(candidates: CalendarCandidate[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const c of candidates) {
    const base = { candidateId: c.id, name: c.name ?? "(no name)", role: c.role, phone: c.phone };
    if (c.phone_date) out.push({ ...base, kind: "phone", at: c.phone_date, day: todayISO(new Date(c.phone_date)) });
    if (c.inperson_date) {
      out.push({ ...base, kind: "inperson", at: c.inperson_date, day: todayISO(new Date(c.inperson_date)) });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The cells of a month grid: leading nulls to line the 1st up under its weekday, then day numbers.
 *
 * `month` is 1-12, not the 0-11 that Date uses — the off-by-one there is a classic, and a module
 * boundary is a good place to stop paying for it.
 */
export function monthCells(year: number, month: number): (number | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startDow = first.getUTCDay();
  const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: (number | null)[] = Array(startDow).fill(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  return cells;
}

/** Events of one month, bucketed by day-of-month. */
export function eventsByDay(events: CalendarEvent[], year: number, month: number): Map<number, CalendarEvent[]> {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  const byDay = new Map<number, CalendarEvent[]>();

  for (const ev of events) {
    if (!ev.day.startsWith(prefix)) continue;
    const d = Number(ev.day.slice(8, 10));
    const list = byDay.get(d);
    if (list) list.push(ev);
    else byDay.set(d, [ev]);
  }
  return byDay;
}

/** Step a year/month pair, 1-12, without tripping over December. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = (year * 12 + (month - 1)) + delta;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

/**
 * The next few interviews, wherever they fall.
 *
 * Includes yesterday, deliberately: an interview that happened this morning is still the thing a
 * recruiter is looking for at lunchtime, and dropping it at midnight makes the list feel broken.
 */
export function upcomingInterviews(events: CalendarEvent[], now: Date = new Date(), limit = 8): CalendarEvent[] {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  return events.filter((ev) => ev.at >= cutoff).slice(0, limit);
}
