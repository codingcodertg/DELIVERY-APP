// Ported from the deliveries app (ADR 0010). Framework-free (ADR 0006).
import { haversineMi, type LatLng } from "./route-batching";

// ============================================================
// What a driver's day actually looked like, rebuilt from position fixes.
//
// The phone reports on movement, not on a clock, so this is a reconstruction
// from scattered points — not a recording. Everything here is built to be
// honest about that rather than to produce a confident-looking number.
//
// THE HARD PART IS THE GAPS. A stretch with no fixes means one of two things
// and the data cannot tell them apart: the truck stood still (nothing to
// report), or the app was asleep while it drove (measured in production —
// fixes have arrived over an hour late, see D-031). Folding those minutes into
// "time at stores" would invent time the driver never spent standing around,
// and folding them into driving would invent miles. So they are counted as
// their own thing and reported as unknown.
// ============================================================

export interface Fix {
  lat: number;
  lng: number;
  /** ISO timestamp. */
  at: string;
  accuracy_m?: number | null;
}

/** Below this, the truck is parked and the GPS is drifting. */
export const STILL_M = 60;
/** A stop worth naming — shorter than this is a traffic light. */
export const STOP_MIN_MINUTES = 4;
/** Longer than this between fixes and we simply don't know what happened. */
export const GAP_MINUTES = 20;
/** Coarser than this is a cell-tower guess, not a position. */
export const MAX_ACCURACY_M = 200;
/**
 * Faster than this between two fixes and the truck did not travel it.
 *
 * A single impossible jump wrecks every number downstream: one fix from
 * another device turned a day's driving into 4,936 miles. Rather than average
 * that away, the jump is refused and counted, so it shows up as something to
 * look at instead of quietly inflating a mileage figure.
 */
export const MAX_SPEED_MPH = 100;
/**
 * ...but only over a real distance.
 *
 * Two fixes 0.3 seconds and 21 metres apart imply 160 mph, and that is GPS
 * jitter, not a jump — dividing by a near-zero time makes any wobble look
 * supersonic. A jump that actually means a second device is hundreds of miles,
 * never metres, so requiring a mile before the speed test even applies costs
 * nothing and stops the rule crying wolf on its own noise.
 */
export const MIN_TELEPORT_MI = 1;

export interface Stop {
  at: LatLng;
  /** ISO. */
  from: string;
  to: string;
  minutes: number;
}

export interface TrackSummary {
  /** Straight-line miles between consecutive fixes. Understates real road
   * distance — see `sparse`. */
  miles: number;
  movingMinutes: number;
  stoppedMinutes: number;
  /** Minutes we genuinely cannot account for. */
  unknownMinutes: number;
  /** First and last fix of the day, ISO. */
  firstAt: string | null;
  lastAt: string | null;
  stops: Stop[];
  /** How many stretches were too long to interpret. */
  gaps: number;
  /** Jumps no vehicle could have made — a sign of a second device on the same
   * account, or a spoofed position. Never folded into the distance. */
  teleports: number;
  /** True when the fixes are too far apart for the distance to mean much. */
  sparse: boolean;
  fixes: number;
}

const EMPTY: TrackSummary = {
  miles: 0, movingMinutes: 0, stoppedMinutes: 0, unknownMinutes: 0,
  firstAt: null, lastAt: null, stops: [], gaps: 0, teleports: 0, sparse: false, fixes: 0,
};

function minutesBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
}

/** Drop what can't be trusted, and put the rest in time order. */
export function cleanFixes(fixes: Fix[]): Fix[] {
  return fixes
    .filter((f) =>
      Number.isFinite(f.lat) && Number.isFinite(f.lng) &&
      !Number.isNaN(new Date(f.at).getTime()) &&
      (f.accuracy_m == null || f.accuracy_m <= MAX_ACCURACY_M))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/**
 * Rebuild the day: distance covered, time driving, time standing still, and
 * where the standing still happened.
 */
export function summarizeTrack(raw: Fix[]): TrackSummary {
  const fixes = cleanFixes(raw);
  if (fixes.length === 0) return { ...EMPTY };
  if (fixes.length === 1) {
    return { ...EMPTY, firstAt: fixes[0].at, lastAt: fixes[0].at, fixes: 1 };
  }

  let miles = 0;
  let movingMinutes = 0;
  let stoppedMinutes = 0;
  let unknownMinutes = 0;
  let gaps = 0;
  let teleports = 0;

  // A stop being accumulated: where it started and when.
  let anchor: { at: LatLng; from: string; to: string } | null = null;
  const stops: Stop[] = [];

  const closeStop = () => {
    if (!anchor) return;
    const mins = minutesBetween(anchor.from, anchor.to);
    if (mins >= STOP_MIN_MINUTES) {
      stops.push({ at: anchor.at, from: anchor.from, to: anchor.to, minutes: Math.round(mins) });
    }
    anchor = null;
  };

  for (let i = 1; i < fixes.length; i++) {
    const prev = fixes[i - 1];
    const cur = fixes[i];
    const mins = minutesBetween(prev.at, cur.at);
    if (mins <= 0) continue;                       // duplicate stamps
    const metres = haversineMi(prev, cur) * 1609.344;

    // Impossible jump: two devices on one account, or a faked position. The
    // distance is thrown away — counting it would put thousands of miles on a
    // truck that never moved them — and the time is unaccounted for, because
    // we no longer know which of the two positions was the real one.
    const jumpMi = metres / 1609.344;
    if (jumpMi >= MIN_TELEPORT_MI && jumpMi / (mins / 60) > MAX_SPEED_MPH) {
      teleports++;
      unknownMinutes += mins;
      closeStop();
      continue;
    }

    if (mins > GAP_MINUTES) {
      // Unreadable. Count the distance (the truck really did end up there)
      // but refuse to say whether the time was spent driving or parked.
      miles += metres / 1609.344;
      unknownMinutes += mins;
      gaps++;
      closeStop();
      continue;
    }

    if (metres < STILL_M) {
      stoppedMinutes += mins;
      if (!anchor) anchor = { at: { lat: prev.lat, lng: prev.lng }, from: prev.at, to: cur.at };
      else anchor.to = cur.at;
    } else {
      miles += metres / 1609.344;
      movingMinutes += mins;
      closeStop();
    }
  }
  closeStop();

  // Fixes this far apart make the straight-line total little more than an
  // outline; say so rather than presenting it as a mileage figure.
  const span = minutesBetween(fixes[0].at, fixes[fixes.length - 1].at);
  const perFix = span / Math.max(1, fixes.length - 1);

  return {
    miles: Math.round(miles * 10) / 10,
    movingMinutes: Math.round(movingMinutes),
    stoppedMinutes: Math.round(stoppedMinutes),
    unknownMinutes: Math.round(unknownMinutes),
    firstAt: fixes[0].at,
    lastAt: fixes[fixes.length - 1].at,
    stops,
    gaps,
    teleports,
    sparse: perFix > 5 || gaps > 0 || teleports > 0,
    fixes: fixes.length,
  };
}

/**
 * Put a name to a stop by finding the closest known place — a delivery
 * address or a store — within `withinMi`.
 *
 * Returns null when nothing is close enough. An unnamed stop is honest; a stop
 * labelled with a customer half a mile away is not.
 */
export function nameStop(
  stop: Stop,
  places: Array<{ label: string; lat: number; lng: number }>,
  withinMi = 0.25,
): string | null {
  let best: { label: string; d: number } | null = null;
  for (const p of places) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const d = haversineMi(stop.at, p);
    if (!best || d < best.d) best = { label: p.label, d };
  }
  return best && best.d <= withinMi ? best.label : null;
}
