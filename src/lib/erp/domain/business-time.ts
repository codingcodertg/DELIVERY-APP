// Business-calendar helpers for the merged deliveries module (ADR 0010). Framework-free (ADR 0006).
//
// WHY A FIXED TIMEZONE, NOT THE DEVICE CLOCK. The business runs in South Texas (US Central). "Today"
// is computed in that fixed zone so the server (UTC on Vercel) and the browser agree on the same
// calendar day. They don't otherwise: after ~7pm Central, UTC has already rolled over, the
// server-rendered HTML says one date and the client's first render says another, and React throws a
// hydration error. That is not hypothetical — it is a bug this logic already fixed once in the source
// app, and it is the reason `new Date().getDate()` must never be used for rendered "today"/"overdue"
// logic here either.
//
// It is also simply what the operation means by "today": a delivery scheduled for the 14th is the
// 14th in Texas, regardless of where the device asking is.

export const BUSINESS_TZ = "America/Chicago";

const isoInTZ = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/** Today's calendar date in the business timezone, as YYYY-MM-DD. */
export const todayISO = (now: Date = new Date()): string => isoInTZ(now);

/** Current wall-clock time in the business timezone, as HH:MM (24h). */
export function nowHHMM(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

/**
 * Shift a YYYY-MM-DD date by whole days, staying on the calendar.
 *
 * Built from UTC noon rather than midnight on purpose: midnight ± a DST hour can land on the previous
 * or next day, which would silently move a delivery date by one. Noon has 12 hours of slack either
 * way, so no DST transition can push it across a date boundary.
 */
export function shiftDateISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Whole days from `aISO` to `bISO` (negative when b is earlier). */
export function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(`${aISO}T12:00:00Z`);
  const b = Date.parse(`${bISO}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * An order is overdue when its delivery date is in the past and it never reached a terminal stage.
 * Delivered and canceled are outcomes, not delays — an order delivered late is not "overdue" today.
 */
export function isOverdue(
  o: { delivery_date?: string | null; stage?: string | null },
  now: Date = new Date()
): boolean {
  if (!o.delivery_date) return false;
  if (o.stage === "delivered" || o.stage === "canceled") return false;
  return o.delivery_date < todayISO(now);
}

/** An order that needs a driver: past the office stages, still nobody assigned. */
export function awaitingDriver(o: { assigned_driver?: string | null; stage?: string | null }): boolean {
  const open = o.stage !== "delivered" && o.stage !== "canceled" && o.stage !== "draft";
  return open && !(o.assigned_driver || "").trim();
}

/**
 * How far the business timezone sits from UTC at a given instant, in ms.
 *
 * Read from Intl rather than hard-coded, because the offset is -5 or -6 depending on the date and
 * hard-coding either one is wrong for half the year.
 */
function tzOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
  return asIfUtc - at.getTime();
}

/**
 * The UTC instant for a wall-clock time on a business calendar date.
 *
 * `businessTimeMs("2026-08-20", 12 * 60)` is noon in Texas on that date — not noon wherever the
 * server happens to be. This is the piece that was missing wherever a promised delivery time was
 * built with `new Date(date + "T00:00:00")`: that parses in the RUNTIME's zone, so the same order was
 * on time on a developer's laptop and late in production, which runs UTC.
 *
 * Applied twice because the offset depends on the instant, and the instant depends on the offset:
 * one pass lands close enough that the second reads the correct side of any DST boundary.
 */
export function businessTimeMs(dateISO: string, minutesIntoDay: number): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0) + minutesIntoDay * 60_000;
  let ms = naive - tzOffsetMs(new Date(naive));
  ms = naive - tzOffsetMs(new Date(ms));
  return ms;
}
