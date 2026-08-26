// DST-aware Central Time (America/Chicago) offset.
//
// The app used to hardcode a 5-hour offset, which is only correct in summer
// (CDT). From November to March the RGV is on CST (UTC-6), so every time-of-day
// calculation — clock-in dates, late/early grading, reminder windows — would be
// off by an hour. This computes the ACTUAL offset for a given instant so the
// math stays correct across the CST/CDT switch.
//
// Returns the whole-millisecond amount to SUBTRACT from a UTC instant to get a
// Date whose UTC fields read as Central wall-clock time: +5h in CDT (summer),
// +6h in CST (winter).

const CACHE = new Map<string, number>();

export function centralShiftMs(at: Date = new Date()): number {
  // Offset only changes twice a year — cache by calendar day.
  const key = at.toISOString().slice(0, 10);
  const cached = CACHE.get(key);
  if (cached !== undefined) return cached;

  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-6";
  const m = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  let ms = 6 * 3600000; // safe winter default
  if (m) {
    const sign = m[1] === "-" ? 1 : -1; // west of GMT => subtract a positive amount
    ms = sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0)) * 60000;
  }
  CACHE.set(key, ms);
  return ms;
}

/** UTC ISO -> "YYYY-MM-DDTHH:MM" in Central wall-clock, for <input type="datetime-local">. */
export function utcToCentralInput(iso: string): string {
  const t = new Date(iso);
  return new Date(t.getTime() - centralShiftMs(t)).toISOString().slice(0, 16);
}

/** "YYYY-MM-DDTHH:MM" (Central wall-clock, from a datetime-local input) -> UTC ISO. */
export function centralWallToUtc(local: string): string {
  const asUtc = new Date(local + ":00.000Z").getTime();
  return new Date(asUtc + centralShiftMs(new Date(asUtc))).toISOString();
}
