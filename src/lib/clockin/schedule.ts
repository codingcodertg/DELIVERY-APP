// Scheduling helpers. Shift times are stored as Postgres `time` ("08:00:00").
import { centralShiftMs } from "./tz";

export const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Schedule types assigned to employees at hire. A/B/C are real weekly patterns
// (day index 0=Mon … 5=Sat, 6=Sun); "custom" = personalized, set manually.
// Lunch is 1 hour with no fixed start time for all of them.
export type ScheduleType = "A" | "B" | "C" | "custom";
type DayShift = { start: string; end: string };
export const PRESET_TYPES = ["A", "B", "C"] as const;
export type PresetType = (typeof PRESET_TYPES)[number];

export const SCHEDULES: Record<PresetType, {
  hours: number;
  lunch: number;
  summary: { en: string; es: string };
  byDay: Record<number, DayShift>;
}> = {
  A: {
    hours: 40,
    lunch: 60,
    summary: { en: "Mon–Fri 8–4, Sat 10–4", es: "Lun–Vie 8–4, Sáb 10–4" },
    byDay: {
      0: { start: "08:00", end: "16:00" },
      1: { start: "08:00", end: "16:00" },
      2: { start: "08:00", end: "16:00" },
      3: { start: "08:00", end: "16:00" },
      4: { start: "08:00", end: "16:00" },
      5: { start: "10:00", end: "16:00" },
    },
  },
  B: {
    hours: 40,
    lunch: 60,
    summary: { en: "Mon–Fri 9–6", es: "Lun–Vie 9–6" },
    byDay: {
      0: { start: "09:00", end: "18:00" },
      1: { start: "09:00", end: "18:00" },
      2: { start: "09:00", end: "18:00" },
      3: { start: "09:00", end: "18:00" },
      4: { start: "09:00", end: "18:00" },
    },
  },
  C: {
    hours: 52,
    lunch: 60,
    summary: { en: "Mon–Fri 8–6, Sat 8–4", es: "Lun–Vie 8–6, Sáb 8–4" },
    byDay: {
      0: { start: "08:00", end: "18:00" },
      1: { start: "08:00", end: "18:00" },
      2: { start: "08:00", end: "18:00" },
      3: { start: "08:00", end: "18:00" },
      4: { start: "08:00", end: "18:00" },
      5: { start: "08:00", end: "16:00" },
    },
  },
};

export function scheduleLabel(type: PresetType, lang: "en" | "es") {
  const s = SCHEDULES[type];
  return `${type} · ${s.summary[lang]} (~${s.hours}h)`;
}

/** Worked minutes a shift represents (end - start - lunch), with overnight guard. */
export function shiftMinutes(start: string, end: string, lunch: number) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm) - (lunch || 0);
  if (mins < 0) mins += 24 * 60;
  return Math.max(0, mins);
}

/** "08:00:00" -> "8:00 AM" */
export function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** "2026-06-22" -> "Mon, Jun 22" */
export function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Central-time calendar date string for an instant (YYYY-MM-DD). */
export function centralDateStr(now: Date = new Date()) {
  return new Date(now.getTime() - centralShiftMs(now)).toISOString().slice(0, 10);
}

/** The seven YYYY-MM-DD dates of the current Central week (Mon-first). */
export function weekDates(now: Date = new Date()) {
  const local = new Date(now.getTime() - centralShiftMs(now));
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const monday = dayStart - ((local.getUTCDay() + 6) % 7) * 86400000;
  return Array.from({ length: 7 }, (_, i) => new Date(monday + i * 86400000).toISOString().slice(0, 10));
}

/**
 * Payroll week runs FRIDAY → THURSDAY (Central). Returns the 7 dates Fri..Thu of
 * the pay period containing `now`; [0]=Friday (period_start), [6]=Thursday (the
 * last day, when managers approve and the owner downloads).
 */
export function payPeriodDates(now: Date = new Date()) {
  const local = new Date(now.getTime() - centralShiftMs(now));
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const sinceFriday = (local.getUTCDay() - 5 + 7) % 7; // getUTCDay: 0=Sun..5=Fri..6=Sat
  const friday = dayStart - sinceFriday * 86400000;
  return Array.from({ length: 7 }, (_, i) => new Date(friday + i * 86400000).toISOString().slice(0, 10));
}

/** The Friday (period_start, YYYY-MM-DD Central) of the pay period a date falls in. */
export function payPeriodStartOf(dateOrIso: string | Date): string {
  return payPeriodDates(new Date(dateOrIso))[0];
}

export function minutesToHrs(mins: number) {
  return Math.round((mins / 60) * 10) / 10;
}

/** Monday (YYYY-MM-DD) `n` weeks after the given Monday. */
export function addWeeks(mondayStr: string, n: number): string {
  return new Date(new Date(`${mondayStr}T12:00:00Z`).getTime() + n * 7 * 86400000).toISOString().slice(0, 10);
}

// A recurring weekly pattern: day index ("0"=Mon … "6"=Sun) -> that day's shift.
// A missing/blank day means "off". Used for both the A/B/C presets and custom.
export type DayPattern = { start: string; end: string; lunch: number };
export type WeekPattern = Record<string, DayPattern>;

/** The A/B/C preset as a WeekPattern (per-day lunch, matching custom's shape). */
export function presetPattern(type: PresetType): WeekPattern {
  const s = SCHEDULES[type];
  const out: WeekPattern = {};
  for (const [d, sh] of Object.entries(s.byDay)) out[d] = { start: sh.start, end: sh.end, lunch: s.lunch };
  return out;
}

/** Keep only valid working days from an arbitrary (e.g. user-entered) pattern. */
export function cleanPattern(p: unknown): WeekPattern {
  const out: WeekPattern = {};
  if (!p || typeof p !== "object") return out;
  for (const [d, v] of Object.entries(p as Record<string, unknown>)) {
    const n = Number(d);
    if (!Number.isInteger(n) || n < 0 || n > 6) continue;
    const sh = v as Partial<DayPattern>;
    if (sh && typeof sh.start === "string" && typeof sh.end === "string" && sh.start && sh.end) {
      out[String(n)] = { start: sh.start, end: sh.end, lunch: Number(sh.lunch) || 0 };
    }
  }
  return out;
}

/** The shift rows a weekly pattern produces for one week (Monday `weekMonday`). */
export function patternRows(
  pattern: WeekPattern,
  weekMonday: string,
): { shift_date: string; start_time: string; end_time: string; lunch_minutes: number }[] {
  const base = new Date(`${weekMonday}T12:00:00Z`).getTime();
  return Object.entries(pattern)
    .filter(([, sh]) => sh && sh.start && sh.end)
    .map(([d, sh]) => ({
      shift_date: new Date(base + Number(d) * 86400000).toISOString().slice(0, 10),
      start_time: sh.start,
      end_time: sh.end,
      lunch_minutes: sh.lunch ?? 0,
    }));
}

/** Preset (A/B/C) rows for one week — thin wrapper over patternRows. */
export function scheduleRows(type: PresetType, weekMonday: string) {
  return patternRows(presetPattern(type), weekMonday);
}

/**
 * The shift rows a weekly pattern produces for a specific set of calendar dates,
 * matched by day-of-week. Used so scheduling works over the Fri→Thu pay week
 * (which spans two Mon–Sun calendar weeks), not just a Monday-anchored week.
 */
export function patternRowsForDates(
  pattern: WeekPattern,
  dates: string[],
): { shift_date: string; start_time: string; end_time: string; lunch_minutes: number }[] {
  const out: { shift_date: string; start_time: string; end_time: string; lunch_minutes: number }[] = [];
  for (const d of dates) {
    const dow = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
    const sh = pattern[String(dow)];
    if (sh && sh.start && sh.end) {
      out.push({ shift_date: d, start_time: sh.start, end_time: sh.end, lunch_minutes: sh.lunch ?? 0 });
    }
  }
  return out;
}

// ── A/B weekly rotation ──────────────────────────────────────────────────────
// A- and B-assigned people SWAP patterns every pay-week: when the A cohort works
// pattern A, the B cohort works pattern B; the following Friday they trade. C and
// custom never rotate. This anchor is a phase-0 Friday (A-assigned → pattern A);
// the pay-week of 2026-07-10 is an A-week, so 2026-07-17 flips A→B.
export const AB_ANCHOR_FRIDAY = "2026-07-10";

/** Parity (0 or 1) of the pay-week that starts on `periodFriday` (YYYY-MM-DD). */
export function abPhase(periodFriday: string): 0 | 1 {
  const weeks = Math.round(
    (Date.parse(`${periodFriday}T12:00:00Z`) - Date.parse(`${AB_ANCHOR_FRIDAY}T12:00:00Z`)) / (7 * 86400000),
  );
  return (((weeks % 2) + 2) % 2) as 0 | 1;
}

/** The pattern an A/B-assigned person actually works in the given pay-week. */
export function effectivePreset(assigned: PresetType, periodFriday: string): PresetType {
  if (assigned !== "A" && assigned !== "B") return assigned; // C never rotates
  return abPhase(periodFriday) === 1 ? (assigned === "A" ? "B" : "A") : assigned;
}

/**
 * Shift rows for an A/B/C-assigned person over a set of dates, applying the weekly
 * A/B swap per pay-week (each week uses that week's effective pattern).
 */
export function presetRowsForDates(assigned: PresetType, dates: string[]) {
  const byWeek = new Map<string, string[]>();
  for (const d of dates) {
    // Parse at noon: a bare YYYY-MM-DD is UTC-midnight, and the Central shift
    // would roll a Friday back into the previous pay week (the boundary day).
    const fri = payPeriodStartOf(`${d}T12:00:00Z`);
    (byWeek.get(fri) ?? byWeek.set(fri, []).get(fri)!).push(d);
  }
  const out: { shift_date: string; start_time: string; end_time: string; lunch_minutes: number }[] = [];
  for (const [fri, wkDates] of byWeek) {
    out.push(...patternRowsForDates(presetPattern(effectivePreset(assigned, fri)), wkDates));
  }
  return out;
}

/** This pay period's 7 dates plus next pay period's 7 dates (Fri→Thu × 2). */
export function currentAndNextPeriodDates(now: Date = new Date()): string[] {
  const cur = payPeriodDates(now);
  const nextFriday = new Date(`${cur[0]}T12:00:00Z`).getTime() + 7 * 86400000;
  const next = payPeriodDates(new Date(nextFriday));
  return [...cur, ...next];
}
