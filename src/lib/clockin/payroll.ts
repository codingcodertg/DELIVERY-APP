// Payroll math shared by the reports page, CSV export, XLSX export AND the
// attendance scorecard so every surface reports the SAME hours.
//
// Lunch handling — one rule everywhere: a PUNCHED lunch break (an exceptions
// row with reason=lunch linked by time_entry_id) is the source of truth. The
// legacy `lunch_minutes` column is only a fallback for entries with no punched
// break. Callers fetch the lunch rows and run attachLunch() before summing.

export type PayEntry = {
  id: string;
  employee_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  lunch_minutes: number | null;
  /** Minutes of the punched lunch break, filled by attachLunch(). */
  punched_lunch_min?: number | null;
  /** Actual lunch punches for the day (left/returned), filled by attachLunch(). */
  lunch_windows?: { left: string; returned: string }[];
  status?: string | null;
  manual?: boolean | null;
  edited_at?: string | null;
  edit_note?: string | null;
};

export type LunchRow = { time_entry_id: string | null; left_at: string | null; returned_at: string | null };

/**
 * Attach punched-lunch minutes onto entries (in place, and returned) from
 * exceptions rows (reason=lunch). Multiple breaks on one entry accumulate.
 */
export function attachLunch<
  T extends { id: string; punched_lunch_min?: number | null; lunch_windows?: { left: string; returned: string }[] },
>(entries: T[], lunchRows: LunchRow[]): T[] {
  const byEntry = new Map<string, number>();
  const windows = new Map<string, { left: string; returned: string }[]>();
  for (const l of lunchRows) {
    if (!l.time_entry_id || !l.left_at || !l.returned_at) continue;
    const mins = (new Date(l.returned_at).getTime() - new Date(l.left_at).getTime()) / 60000;
    if (mins > 0) {
      byEntry.set(l.time_entry_id, (byEntry.get(l.time_entry_id) ?? 0) + mins);
      const arr = windows.get(l.time_entry_id) ?? [];
      arr.push({ left: l.left_at, returned: l.returned_at });
      windows.set(l.time_entry_id, arr);
    }
  }
  for (const e of entries) {
    e.punched_lunch_min = byEntry.get(e.id) ?? null;
    e.lunch_windows = windows.get(e.id) ?? [];
  }
  return entries;
}

/** Effective lunch minutes for one entry: punched break wins, else legacy field. */
export function lunchMinutes(e: { punched_lunch_min?: number | null; lunch_minutes?: number | null }): number {
  return Math.max(0, e.punched_lunch_min ?? e.lunch_minutes ?? 0);
}

const OT_WEEKLY_MIN = 40 * 60; // hours past 40/week count as overtime

/** Worked minutes for one entry (0 if still open / no clock-out). */
export function entryMinutes(e: PayEntry): number {
  if (!e.clock_out_at) return 0;
  const gross = (new Date(e.clock_out_at).getTime() - new Date(e.clock_in_at).getTime()) / 60000;
  return Math.max(0, gross - lunchMinutes(e));
}

// lunchMin: total unpaid break time deducted this period. It was always
// subtracted from the hours but never surfaced, so a manager could not see how
// much lunch anyone actually took.
export type PaySummary = { totalMin: number; regularMin: number; otMin: number; openCount: number; lunchMin: number };

export function summarize(entries: PayEntry[]): PaySummary {
  let totalMin = 0;
  let lunchMin = 0;
  let openCount = 0;
  for (const e of entries) {
    if (!e.clock_out_at) {
      openCount++;
      continue;
    }
    totalMin += entryMinutes(e);
    lunchMin += lunchMinutes(e);
  }
  const regularMin = Math.min(totalMin, OT_WEEKLY_MIN);
  const otMin = Math.max(0, totalMin - OT_WEEKLY_MIN);
  return { totalMin, regularMin, otMin, openCount, lunchMin };
}

/** Minutes -> decimal hours string, 2 dp (payroll convention). */
export function hrs(min: number): string {
  return (Math.round((min / 60) * 100) / 100).toFixed(2);
}
