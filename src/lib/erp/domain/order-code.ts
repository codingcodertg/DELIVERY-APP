// Order code — the human-facing 5-char order id, e.g. "FA100". Ported from the deliveries app
// (ADR 0010). Framework-free (ADR 0006).
//
//   char 1  year   : letter = year − 2020  (2021=A … 2026=F … 2046=Z)
//   char 2  week   : 2 ISO weeks per letter (weeks 1-2 = A, 3-4 = B, …)
//   chars 3-5 seq  : odd week of the pair starts at 100, even week at 500
//
// 53-week ISO years (e.g. 2026): the final letter Z holds THREE weeks —
//   week 51 → 100, week 52 → 400, week 53 → 700 (300-wide bands).
//
// Codes for the same year sort chronologically as plain strings (fixed width), so lexicographic
// order == creation order. That property is why the format is worth preserving exactly: 77 migrated
// orders already carry these codes, and staff read them off paperwork.
//
// Ported verbatim, including the local-time dependence of isoWeek() (it reads getFullYear/getMonth/
// getDate, not UTC). Changing that would shift which week a late-evening order lands in.

const DAY = 24 * 60 * 60 * 1000;

/** ISO-8601 week number (1-53); week 1 holds the year's first Thursday. */
export function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY));
}

/** The ISO week-year (differs from the calendar year for a few days near Jan 1 / Dec 31). */
export function isoWeekYear(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  return date.getUTCFullYear();
}

/** 52 or 53 — how many ISO weeks the given ISO year has (Dec 28 is always in the last week). */
export function weeksInIsoYear(year: number): number {
  // Local noon Dec 28 — always in the ISO year's last week, and TZ-safe (its local y/m/d, which
  // isoWeek reads, is unambiguously Dec 28).
  return isoWeek(new Date(year, 11, 28, 12));
}

function yearLetter(year: number): string {
  const idx = year - 2020; // 2021 → 1 → 'A'
  const clamped = Math.min(26, Math.max(1, idx));
  return String.fromCharCode(64 + clamped);
}

/** The week's letter + starting number for its counter band. */
function weekLetterAndBase(week: number, weeksInYear: number): { letter: string; base: number; span: number } {
  if (weeksInYear >= 53 && week >= 51) {
    // Final letter Z absorbs weeks 51/52/53 → 100 / 400 / 700 (300-wide).
    const i = Math.min(2, week - 51);
    return { letter: "Z", base: 100 + i * 300, span: 300 };
  }
  const letterIdx = Math.floor((week - 1) / 2); // A=0
  const letter = String.fromCharCode(65 + Math.min(25, letterIdx));
  const odd = week % 2 === 1;
  return { letter, base: odd ? 100 : 500, span: odd ? 400 : 500 };
}

export interface CodeBand {
  year: number;
  week: number;
  weeksInYear: number;
  prefix: string; // 2 letters, e.g. "FA"
  base: number; // first number in the band (100 / 400 / 500 / 700)
  ceil: number; // exclusive upper bound of the band
}

/** The code band (prefix + numeric range) an order created on `date` belongs to. */
export function codeBand(date: Date): CodeBand {
  const year = isoWeekYear(date);
  const week = isoWeek(date);
  const weeksInYear = weeksInIsoYear(year);
  const { letter, base, span } = weekLetterAndBase(week, weeksInYear);
  return { year, week, weeksInYear, prefix: yearLetter(year) + letter, base, ceil: base + span };
}

/**
 * Next order code for `date`, given the codes already used. Fills the band from its base upward.
 *
 * Note it takes the MAX in the band rather than counting: a deleted or skipped code is never reused,
 * so a code always identifies one order for good.
 */
export function nextOrderCode(existingCodes: (string | null | undefined)[], date: Date): string {
  const b = codeBand(date);
  let max = b.base - 1;
  for (const c of existingCodes) {
    if (!c || c.length < 5) continue;
    if (c.slice(0, 2) !== b.prefix) continue;
    const n = parseInt(c.slice(2, 5), 10);
    if (Number.isNaN(n) || n < b.base || n >= b.ceil) continue;
    if (n > max) max = n;
  }
  return b.prefix + String(max + 1).padStart(3, "0");
}

/** Display id: the code plus any split-load suffix ("FA100", "FA100a"). */
export function codeLabel(d: {
  order_code?: string | null;
  order_no?: number;
  order_suffix?: string | null;
}): string {
  const base = d.order_code || (d.order_no != null ? String(d.order_no) : "");
  return `${base}${d.order_suffix ?? ""}`;
}
