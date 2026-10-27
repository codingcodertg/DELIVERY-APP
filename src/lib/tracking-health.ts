import type { DriverLocation, DriverShift, Profile } from "@/lib/types";

// ============================================================
// Which on-shift drivers have gone quiet.
//
// A foreground service plus a battery-optimisation exemption covers most
// phones, but no combination is bulletproof: an OEM battery manager, a dead
// battery, or no signal will still stop the reports. Rather than pretend that
// can't happen, this makes it VISIBLE — logistics sees "not reporting" the
// moment it starts instead of discovering a blank map hours later.
// ============================================================

/** Minutes without a fix before a clocked-in driver counts as gone quiet.
 * Comfortably above the ~25s reporting interval, so a dead zone or a phone
 * catching up after a tunnel doesn't raise a false alarm. */
export const STALE_AFTER_MIN = 15;

/** A driver counts as LIVE when they're clocked in AND their phone reported a
 * position within this many minutes. Same threshold as the stale warning, so
 * the two can never disagree — a driver is either live or flagged, not both. */
export const LIVE_WITHIN_MIN = STALE_AFTER_MIN;

/**
 * Driver names currently on shift and reporting, for the "LIVE" tag on the
 * dispatcher's driver list. Keyed by name because that's what an order's
 * assigned_driver holds.
 */
export function liveDriverNames(
  users: Profile[],
  shifts: DriverShift[],
  locations: DriverLocation[],
  now: number = Date.now(),
  withinMin: number = LIVE_WITHIN_MIN,
): Set<string> {
  const onShift = new Set(shifts.filter((s) => !s.ended_at).map((s) => s.driver_id));
  const nameById = new Map(users.map((u) => [u.id, u.full_name]));
  const live = new Set<string>();
  for (const loc of locations) {
    if (!onShift.has(loc.driver_id)) continue;
    if ((now - new Date(loc.recorded_at).getTime()) / 60000 > withinMin) continue;
    const name = nameById.get(loc.driver_id);
    if (name) live.add(name);
  }
  return live;
}

export interface TrackingGap {
  driverId: string;
  driver: string;
  /** Minutes since their last fix, or null if they never reported this shift. */
  quietForMin: number | null;
  /** D-713: desde qué app se marcó el turno y su último estado de GPS, si el turno lo dice (migración 206). */
  app: string | null;
  gps: string | null;
}

/**
 * On-shift drivers whose position has gone stale (or never arrived).
 *
 * Only drivers with an OPEN shift are considered — someone who clocked out is
 * supposed to stop reporting, and flagging them would train everyone to ignore
 * the warning.
 */
export function trackingGaps(
  users: Profile[],
  shifts: DriverShift[],
  locations: DriverLocation[],
  now: number = Date.now(),
  staleAfterMin: number = STALE_AFTER_MIN,
): TrackingGap[] {
  const nameById = new Map(users.map((u) => [u.id, u.full_name]));
  const lastFixById = new Map<string, number>();
  for (const loc of locations) {
    const at = new Date(loc.recorded_at).getTime();
    const prev = lastFixById.get(loc.driver_id);
    if (prev == null || at > prev) lastFixById.set(loc.driver_id, at);
  }

  const out: TrackingGap[] = [];
  const seen = new Set<string>();
  for (const s of shifts) {
    if (s.ended_at) continue;                 // clocked out — silence expected
    if (seen.has(s.driver_id)) continue;      // one row per driver
    seen.add(s.driver_id);
    const name = nameById.get(s.driver_id);
    if (!name) continue;

    const startedAt = new Date(s.started_at).getTime();
    const last = lastFixById.get(s.driver_id);
    // Ignore fixes from before this shift — a leftover from yesterday says
    // nothing about whether the phone is reporting now.
    const lastThisShift = last != null && last >= startedAt ? last : null;

    if (lastThisShift == null) {
      // Give a driver who just clocked in time to get their first fix.
      const onShiftMin = (now - startedAt) / 60000;
      if (onShiftMin >= staleAfterMin) out.push({ driverId: s.driver_id, driver: name, quietForMin: null, app: s.app ?? null, gps: s.gps ?? null });
      continue;
    }
    const quietForMin = (now - lastThisShift) / 60000;
    if (quietForMin >= staleAfterMin) {
      out.push({ driverId: s.driver_id, driver: name, quietForMin: Math.round(quietForMin), app: s.app ?? null, gps: s.gps ?? null });
    }
  }
  return out.sort((a, b) => (b.quietForMin ?? Infinity) - (a.quietForMin ?? Infinity));
}
