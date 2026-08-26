// Time helpers for dashboards. Boundaries are computed for the company's local
// time zone (US Central), DST-aware via centralShiftMs (CST/CDT).
import { centralShiftMs } from "./tz";

export function dayAndWeekStart(now: Date = new Date()) {
  const shift = centralShiftMs(now);
  // Shift so UTC calendar fields read as Central wall-clock time.
  const local = new Date(now.getTime() - shift);
  const dayStartLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const mondayIndex = (local.getUTCDay() + 6) % 7; // 0 = Monday
  const weekStartLocal = dayStartLocal - mondayIndex * 24 * 60 * 60 * 1000;
  return {
    todayStartUtc: new Date(dayStartLocal + shift),
    weekStartUtc: new Date(weekStartLocal + shift),
  };
}

/** Milliseconds -> "Xh Ym" */
export function formatDuration(ms: number) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

/** Hours as a decimal, 1 dp (for totals). */
export function hoursDecimal(ms: number) {
  return Math.round((ms / 3600000) * 10) / 10;
}

export function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

/** "Jun 22, 4:15 PM" — date + time in Central. */
export function dateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}
