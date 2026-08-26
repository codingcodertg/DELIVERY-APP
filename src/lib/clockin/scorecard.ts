// Attendance scorecard: compares actual punches against scheduled shifts to
// derive late / early-departure / missed / overtime. All time-of-day math is in
// US Central (matches the schedule helpers).
import { centralDateStr, shiftMinutes } from "./schedule";
import { centralShiftMs } from "./tz";

const GRACE_MIN = 5; // a few minutes of slack before "late"/"early"

export type Shift = {
  employee_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  lunch_minutes: number;
};
export type Entry = {
  id?: string;
  employee_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  /** Punched lunch minutes (from payroll.attachLunch); subtracted from worked time. */
  punched_lunch_min?: number | null;
};

export type PersonScore = {
  employeeId: string;
  scheduledMins: number;
  workedMins: number;
  onTimeDays: number;
  lateCount: number;
  lateMinTotal: number;
  earlyDepartures: number;
  clockedInEarly: number;
  missed: number;
  approachingOT: boolean;
  overtime: boolean;
};

const LONG_LUNCH_MIN = 45; // a lunch break longer than this is "long"

/** Count long lunches per employee from their "lunch" leave events (with return). */
export function longLunchesByEmployee(
  lunchEvents: { employee_id: string; left_at: string | null; returned_at: string | null }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of lunchEvents) {
    if (!e.left_at || !e.returned_at) continue;
    const mins = (new Date(e.returned_at).getTime() - new Date(e.left_at).getTime()) / 60000;
    if (mins > LONG_LUNCH_MIN) m.set(e.employee_id, (m.get(e.employee_id) ?? 0) + 1);
  }
  return m;
}

export function centralMinutes(iso: string) {
  const t = new Date(iso);
  const d = new Date(t.getTime() - centralShiftMs(t));
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
export function centralDateOf(iso: string) {
  const t = new Date(iso);
  return new Date(t.getTime() - centralShiftMs(t)).toISOString().slice(0, 10);
}
function parseHM(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function scoreWeek(
  shifts: Shift[],
  entries: Entry[],
  opts: { otWeeklyHours?: number; now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  const today = centralDateStr(now);
  const nowMs = now.getTime();
  const otMin = (opts.otWeeklyHours ?? 40) * 60;

  const scores = new Map<string, PersonScore>();
  const ensure = (id: string) => {
    let s = scores.get(id);
    if (!s) {
      s = {
        employeeId: id,
        scheduledMins: 0,
        workedMins: 0,
        onTimeDays: 0,
        lateCount: 0,
        lateMinTotal: 0,
        earlyDepartures: 0,
        clockedInEarly: 0,
        missed: 0,
        approachingOT: false,
        overtime: false,
      };
      scores.set(id, s);
    }
    return s;
  };

  // entries grouped by employee + central date
  const byEmpDate = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = e.employee_id + "|" + centralDateOf(e.clock_in_at);
    const arr = byEmpDate.get(key) ?? [];
    arr.push(e);
    byEmpDate.set(key, arr);
    const s = ensure(e.employee_id);
    const start = new Date(e.clock_in_at).getTime();
    const end = e.clock_out_at ? new Date(e.clock_out_at).getTime() : nowMs;
    // Punched lunch breaks are unpaid — don't count them as worked time.
    s.workedMins += Math.max(0, (end - start) / 60000 - (e.punched_lunch_min ?? 0));
  }

  for (const sh of shifts) {
    const s = ensure(sh.employee_id);
    s.scheduledMins += shiftMinutes(sh.start_time, sh.end_time, sh.lunch_minutes);
    if (sh.shift_date > today) continue; // future shift — nothing to grade yet

    const dayEntries = byEmpDate.get(sh.employee_id + "|" + sh.shift_date) ?? [];
    if (dayEntries.length === 0) {
      if (sh.shift_date < today) s.missed += 1; // a past scheduled day with no punch
      continue;
    }
    const startMin = parseHM(sh.start_time);
    const earliestIn = Math.min(...dayEntries.map((e) => centralMinutes(e.clock_in_at)));
    if (earliestIn > startMin + GRACE_MIN) {
      s.lateCount += 1;
      s.lateMinTotal += earliestIn - startMin;
    } else {
      s.onTimeDays += 1;
      if (earliestIn < startMin - GRACE_MIN) s.clockedInEarly += 1; // clocked in early
    }
    const closed = dayEntries.filter((e) => e.clock_out_at);
    if (closed.length) {
      const endMin = parseHM(sh.end_time);
      const latestOut = Math.max(...closed.map((e) => centralMinutes(e.clock_out_at!)));
      if (latestOut < endMin - GRACE_MIN) s.earlyDepartures += 1;
    }
  }

  for (const s of scores.values()) {
    s.workedMins = Math.round(s.workedMins);
    s.overtime = s.workedMins >= otMin;
    s.approachingOT = !s.overtime && s.workedMins >= otMin - 4 * 60;
  }
  return scores;
}

/** Who, scheduled today, is currently late or hasn't clocked in yet. */
export function todayAlerts(shifts: Shift[], entries: Entry[], now: Date = new Date()) {
  const today = centralDateStr(now);
  const nowMin = centralMinutes(now.toISOString());
  const late: { employeeId: string; minutes: number }[] = [];
  const notInYet: { employeeId: string; startMin: number }[] = [];

  for (const sh of shifts) {
    if (sh.shift_date !== today) continue;
    const startMin = parseHM(sh.start_time);
    const dayEntries = entries.filter(
      (e) => e.employee_id === sh.employee_id && centralDateOf(e.clock_in_at) === today,
    );
    if (dayEntries.length === 0) {
      if (nowMin > startMin + GRACE_MIN) notInYet.push({ employeeId: sh.employee_id, startMin });
    } else {
      const earliestIn = Math.min(...dayEntries.map((e) => centralMinutes(e.clock_in_at)));
      if (earliestIn > startMin + GRACE_MIN) late.push({ employeeId: sh.employee_id, minutes: earliestIn - startMin });
    }
  }
  return { late, notInYet };
}
