// Delivery scheduling rules — capacity + conflict guard. Ported from the deliveries app (ADR 0010).
// Framework-free (ADR 0006).
//
// When a rep picks a delivery date + time window, the proposed slot is checked against what is
// already booked that day at that store. **None of these hard-block.** The rep is asked "Request
// anyway?", so an exception is still possible — it just cannot happen by accident. That is the
// design intent and the reason this returns a list of warnings rather than a boolean.
//
// Rules:
//   1. Outside working hours (default 0830–1730)
//   2. Exact same window already booked
//   3. Another delivery starting within 3 hours of the requested window
//   4. More than 1 delivery in the MORNING (before 12:00)
//   5. More than 1 delivery in the AFTERNOON (12:00 and later)
//
// Warning text is carried in both languages because the source app renders whichever the user has
// selected; dropping one half here would silently make the merged app English-only for these.

/** Working day, in minutes from midnight. 0830 → 1730. */
export const DAY_START = 8 * 60 + 30;
export const DAY_END = 17 * 60 + 30;
export const NOON = 12 * 60;
/** Two deliveries whose windows start within this span are "clustered". */
export const CLUSTER_MINUTES = 3 * 60;
/** How many deliveries are allowed per half-day before we alert. */
export const HALF_DAY_LIMIT = 1;

export interface ScheduleWarning {
  code: "outside_hours" | "same_window" | "cluster" | "am_overload" | "pm_overload";
  en: string;
  es: string;
}

export interface ScheduleOrder {
  id?: string;
  order_no?: number | null;
  stage?: string | null;
  store?: string | null;
  delivery_date?: string | null;
  delivery_windows?: string | null;
}

/**
 * Parse a "0830-1200" style window into [startMinutes, endMinutes].
 *
 * Accepts 3- or 4-digit times and either hyphen or en-dash, because both appear in real data. A
 * reversed range is normalised rather than rejected — "1200-0830" means the same shift to the person
 * who typed it.
 */
export function parseWindow(win: string | null | undefined): [number, number] | null {
  if (!win) return null;
  const m = win.match(/(\d{3,4})\s*[-–]\s*(\d{3,4})/);
  if (!m) return null;
  const toMin = (s: string) => {
    const p = s.padStart(4, "0");
    return parseInt(p.slice(0, 2), 10) * 60 + parseInt(p.slice(2), 10);
  };
  const a = toMin(m[1]);
  const b = toMin(m[2]);
  return a <= b ? [a, b] : [b, a];
}

/** A canceled or rejected order occupies no capacity. */
const isLive = (d: ScheduleOrder) => d.stage !== "canceled" && d.stage !== "rejected";

const fmt = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}${String(mins % 60).padStart(2, "0")}`;

/**
 * Orders already booked the same day at the same store (excluding this one).
 *
 * Capacity is per store — each branch runs its own trucks. A draft with no store yet compares across
 * all of them, which over-warns rather than under-warns; that is the safe direction.
 */
export function sameDayOrders(c: ScheduleOrder, deliveries: ScheduleOrder[]): ScheduleOrder[] {
  if (!c.delivery_date) return [];
  return deliveries.filter(
    (d) =>
      d.id !== c.id &&
      isLive(d) &&
      d.delivery_date === c.delivery_date &&
      (!c.store || d.store === c.store)
  );
}

/** Evaluate a proposed delivery slot. Returns every rule it trips (empty = clean). */
export function checkSchedule(c: ScheduleOrder, deliveries: ScheduleOrder[]): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const win = parseWindow(c.delivery_windows);
  if (!c.delivery_date || !win) return warnings; // nothing to check yet
  const [start, end] = win;

  // 1 — outside the working day
  if (start < DAY_START || end > DAY_END) {
    warnings.push({
      code: "outside_hours",
      en: `That window (${c.delivery_windows}) is outside delivery hours ${fmt(DAY_START)}–${fmt(DAY_END)}.`,
      es: `Esa ventana (${c.delivery_windows}) está fuera del horario de entrega ${fmt(DAY_START)}–${fmt(DAY_END)}.`,
    });
  }

  const withWindows = sameDayOrders(c, deliveries)
    .map((d) => ({ d, w: parseWindow(d.delivery_windows) }))
    .filter((x): x is { d: ScheduleOrder; w: [number, number] } => x.w !== null);

  // 2 — the exact same window is already taken
  const exact = withWindows.filter((x) => x.w[0] === start && x.w[1] === end);
  if (exact.length) {
    const ids = exact.map((x) => `#${x.d.order_no}`).join(", ");
    warnings.push({
      code: "same_window",
      en: `Window ${c.delivery_windows} is already booked by ${ids}.`,
      es: `La ventana ${c.delivery_windows} ya está reservada por ${ids}.`,
    });
  }

  // 3 — another delivery starts within 3 hours of this one
  const near = withWindows
    .filter((x) => x.w[0] !== start || x.w[1] !== end)
    .filter((x) => Math.abs(x.w[0] - start) < CLUSTER_MINUTES);
  if (near.length) {
    const ids = near.map((x) => `#${x.d.order_no} (${x.d.delivery_windows})`).join(", ");
    warnings.push({
      code: "cluster",
      en: `${near.length} other delivery(ies) within 3 hours of this window: ${ids}.`,
      es: `${near.length} entrega(s) dentro de 3 horas de esta ventana: ${ids}.`,
    });
  }

  // 4/5 — half-day capacity (this order counts toward its own half)
  const amOthers = withWindows.filter((x) => x.w[0] < NOON);
  const pmOthers = withWindows.filter((x) => x.w[0] >= NOON);
  const isAM = start < NOON;
  const amTotal = amOthers.length + (isAM ? 1 : 0);
  const pmTotal = pmOthers.length + (isAM ? 0 : 1);

  if (isAM && amTotal > HALF_DAY_LIMIT) {
    const ids = amOthers.map((x) => `#${x.d.order_no}`).join(", ");
    warnings.push({
      code: "am_overload",
      en: `${amTotal} deliveries would be scheduled before 12:00 that day (${ids}). Only ${HALF_DAY_LIMIT} is planned for.`,
      es: `Habría ${amTotal} entregas antes de las 12:00 ese día (${ids}). Solo se planifica ${HALF_DAY_LIMIT}.`,
    });
  }
  if (!isAM && pmTotal > HALF_DAY_LIMIT) {
    const ids = pmOthers.map((x) => `#${x.d.order_no}`).join(", ");
    warnings.push({
      code: "pm_overload",
      en: `${pmTotal} deliveries would be scheduled after 12:00 that day (${ids}). Only ${HALF_DAY_LIMIT} is planned for.`,
      es: `Habría ${pmTotal} entregas después de las 12:00 ese día (${ids}). Solo se planifica ${HALF_DAY_LIMIT}.`,
    });
  }

  return warnings;
}

// --- Delivery window presets -------------------------------------------------
// Same "HHMM-HHMM" string the rest of the app parses (conflicts, routing) — the picker is a fixed
// list rather than free text, which is also why parseWindow's colon-format bug never bites here.

export interface WindowPreset {
  key: string;
  label: string;
  value: string;
}

export const DELIVERY_WINDOW_PRESETS: WindowPreset[] = [
  { key: "early_morning", label: "Early Morning (8:30-10)", value: "0830-1000" },
  { key: "morning", label: "Morning (8:30-12)", value: "0830-1200" },
  { key: "afternoon", label: "Afternoon (12-5:30)", value: "1200-1730" },
  { key: "all_day", label: "All Day (8:30-5:30)", value: "0830-1730" },
  { key: "saturday", label: "Saturday all day (8:30-3:30)", value: "0830-1530" },
];

/** Saturday closes earlier, in every branch. */
export const SATURDAY_WINDOW = "0830-1530";
export const WEEKDAY_ALL_DAY_WINDOW = "0830-1730";

/**
 * Is this calendar date a Saturday?
 *
 * Built from the date parts in UTC rather than parsed from a string. The source uses
 * `new Date(iso + "T12:00:00")`, picking noon so the runtime's offset cannot push it onto the wrong
 * day — a sound trick, but it still asks the runtime's timezone a question that has nothing to do
 * with it. A calendar date has a weekday on its own.
 */
export function isSaturdayISO(iso: string): boolean {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return false;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6;
}

/** The all-day window that belongs to this date's weekday. */
export function defaultWindowFor(iso: string): string {
  return isSaturdayISO(iso) ? SATURDAY_WINDOW : WEEKDAY_ALL_DAY_WINDOW;
}

/**
 * The window to select when the date changes.
 *
 * Flips BOTH ways between the Saturday and weekday defaults, but only when the field is empty or
 * still sitting on the other day's default. A window somebody chose deliberately is never fought —
 * that is the whole subtlety here, and why this is a function rather than an assignment.
 */
export function autoWindowSwap(current: string | null | undefined, iso: string): string {
  const want = defaultWindowFor(iso);
  const other = want === SATURDAY_WINDOW ? WEEKDAY_ALL_DAY_WINDOW : SATURDAY_WINDOW;
  const cur = (current ?? "").trim();
  return !cur || cur === other ? want : cur;
}

/** Every preset — the list does not shrink on a weekday, matching the source's picker. */
export function windowsForDate(_iso?: string): WindowPreset[] {
  return DELIVERY_WINDOW_PRESETS;
}
