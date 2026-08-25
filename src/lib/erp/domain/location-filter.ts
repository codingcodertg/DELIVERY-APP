// Ported from the deliveries app (ADR 0010). Framework-free (ADR 0006).
// ============================================================
// Rules for which GPS fixes are worth sending to the server.
//
// Kept free of React so it can be tested on its own — and because these are
// the rules that decide a driver's battery life and how much position history
// the database carries. A phone reports a fix every second or two; almost all
// of them say nothing new.
// ============================================================

/**
 * Don't write more often than this, however many fixes the phone offers.
 *
 * Ten seconds, not twenty-five. This is what actually decides how precise a
 * driven route can ever be: at 30 mph a point every 25 s left 400 m of road
 * unrecorded between them, which is a straight line across streets the truck
 * never took. At 10 s it's about 130 m — close enough to see the roads taken.
 *
 * The battery argument for a longer gap doesn't hold: the GPS runs at high
 * accuracy every second regardless (see the plugin's LocationRequest), so a
 * longer gap doesn't save power, it only throws away positions already paid
 * for. What it costs is rows — about 1,500 a day per driver instead of 170.
 */
export const MIN_INTERVAL_MS = 10_000;
/** Coarser than this is a cell-tower guess, not a position — ignore it. */
export const MAX_ACCURACY_M = 200;
/**
 * Below this the truck is parked and the GPS is just drifting.
 *
 * Twenty-five metres rather than forty: at forty, a turn through an
 * intersection could pass unrecorded, and the trace cut the corner. Still well
 * clear of the drift a parked phone shows at the 4–10 m accuracy these fixes
 * report.
 */
export const MIN_MOVE_M = 25;
/**
 * Report at least this often even when the truck hasn't moved.
 *
 * Without a heartbeat a parked truck and a dead app look IDENTICAL in the
 * data: both are silence. That ambiguity is what makes "the app paused"
 * impossible to prove after the fact, and it also makes the dispatcher's
 * "not reporting" flag fire on drivers who are simply unloading — the flag
 * trips at 15 minutes and a long stop beats that easily.
 *
 * Well under STALE_AFTER_MIN so a heartbeat that slips a little (a phone
 * throttling timers with the screen off) still lands inside the window.
 */
export const HEARTBEAT_MS = 5 * 60_000;

/** Metres between two lat/lng points (haversine). */
export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Is this fix worth a write? Too soon, too vague, or hasn't moved → no.
 * Once the heartbeat is due, standing still is reason enough to write. */
export function shouldSend(
  fix: { lat: number; lng: number; accuracy?: number | null },
  last: { lat: number; lng: number; at: number } | null,
  now: number,
): boolean {
  if (fix.accuracy != null && fix.accuracy > MAX_ACCURACY_M) return false;
  if (!last) return true;
  if (now - last.at < MIN_INTERVAL_MS) return false;
  if (now - last.at >= HEARTBEAT_MS) return true;
  return metresBetween(last.lat, last.lng, fix.lat, fix.lng) >= MIN_MOVE_M;
}

/** Is a heartbeat overdue? Used to re-send the last known position when the
 * phone has stopped offering new ones because the truck is standing still. */
export function heartbeatDue(lastSentAt: number | null, now: number): boolean {
  return lastSentAt != null && now - lastSentAt >= HEARTBEAT_MS;
}
