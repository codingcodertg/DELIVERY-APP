/**
 * Builds one chronological timeline per employee per day, merging every source
 * of truth about a shift: punches, breaks, runs and stops.
 *
 * Kept apart from the page so the ordering rules can be tested on their own —
 * this is the part that silently goes wrong (a stop landing before the clock-in,
 * a lunch divider in the wrong place) and it is not obvious by eye.
 */
import { centralShiftMs } from "@/lib/clockin/tz";

export type EventKind =
  | "clock_in"
  | "run_start"
  | "stop"
  | "lunch"
  | "leave"
  | "run_end"
  | "clock_out";

export type CrewEvent = {
  kind: EventKind;
  at: string; // ISO, sorts the timeline
  endAt?: string | null; // stops and lunches are ranges
  label?: string | null;
  address?: string | null;
  photo?: string | null;
  miles?: number | null;
  note?: string | null;
  tripId?: string | null;
  /** true when the thing is still open (out to lunch, at a stop, run running) */
  openEnded?: boolean;
};

export type Punch = {
  clock_in_at: string;
  clock_out_at: string | null;
  clock_in_photo_path: string | null;
  clock_out_photo_path: string | null;
  clock_in_in_radius: boolean | null;
  clock_out_in_radius: boolean | null;
  auto_closed?: boolean | null;
};

export type Leave = {
  reason: string | null;
  left_at: string;
  returned_at: string | null;
};

export type Trip = {
  id: string;
  started_at: string;
  ended_at: string | null;
  start_address: string | null;
  end_address: string | null;
  start_photo_path: string | null;
  end_photo_path: string | null;
  reason: string | null;
  note: string | null;
  vehicle_id: string | null;
  start_odometer: number | null;
  end_odometer: number | null;
};

export type TripStop = {
  trip_id: string;
  label: string | null;
  address: string | null;
  arrived_at: string;
  departed_at: string | null;
  photo_path: string | null;
  miles_from_prev: number | null;
};

/** The Central-time calendar date (YYYY-MM-DD) an instant falls on. */
export function centralDateOf(iso: string): string {
  const t = new Date(iso);
  return new Date(t.getTime() - centralShiftMs(t)).toISOString().slice(0, 10);
}

/**
 * Merge one person's day into a single ordered list.
 *
 * Everything is bucketed by the Central date of when it STARTED. A run begun at
 * 11pm that closes after midnight stays on the day it began, which is how a
 * manager reads a shift — otherwise half a run would vanish from the day.
 */
export function buildTimeline(input: {
  punches: Punch[];
  leaves: Leave[];
  trips: Trip[];
  stops: TripStop[];
}): CrewEvent[] {
  const events: CrewEvent[] = [];

  for (const p of input.punches) {
    events.push({
      kind: "clock_in",
      at: p.clock_in_at,
      photo: p.clock_in_photo_path,
      // in_radius null means "we couldn't check", which is not the same as off-site.
      note: p.clock_in_in_radius === false ? "offsite" : null,
    });
    if (p.clock_out_at) {
      events.push({
        kind: "clock_out",
        at: p.clock_out_at,
        photo: p.clock_out_photo_path,
        note: p.auto_closed ? "auto" : p.clock_out_in_radius === false ? "offsite" : null,
      });
    }
  }

  for (const l of input.leaves) {
    events.push({
      kind: l.reason === "lunch" ? "lunch" : "leave",
      at: l.left_at,
      endAt: l.returned_at,
      label: l.reason,
      openEnded: !l.returned_at,
    });
  }

  const stopsByTrip = new Map<string, TripStop[]>();
  for (const s of input.stops) {
    const arr = stopsByTrip.get(s.trip_id) ?? [];
    arr.push(s);
    stopsByTrip.set(s.trip_id, arr);
  }

  for (const t of input.trips) {
    events.push({
      kind: "run_start",
      at: t.started_at,
      address: t.start_address,
      photo: t.start_photo_path,
      label: t.reason,
      note: t.note,
      tripId: t.id,
    });
    for (const s of stopsByTrip.get(t.id) ?? []) {
      events.push({
        kind: "stop",
        at: s.arrived_at,
        endAt: s.departed_at,
        label: s.label,
        address: s.address,
        photo: s.photo_path,
        miles: s.miles_from_prev,
        tripId: t.id,
        openEnded: !s.departed_at,
      });
    }
    if (t.ended_at) {
      events.push({
        kind: "run_end",
        at: t.ended_at,
        address: t.end_address,
        photo: t.end_photo_path,
        tripId: t.id,
      });
    }
  }

  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// NOTE: there is deliberately no per-event date bucketing. An overnight run
// ends after midnight, so bucketing each event by its own timestamp would split
// one run across two days. The PAGE selects a day and fetches everything that
// STARTED that day (clock-in, run, lunch); buildTimeline only orders it. The
// run-end at 1am correctly stays in the day the shift began.

/** Store label -> the 3-letter code used as the dropdown heading. */
export function storeCode(name: string): string {
  const n = name.toLowerCase();
  if (n.startsWith("brownsville")) return "BRO";
  if (n.startsWith("weslaco")) return "WES";
  if (n.startsWith("pharr")) return "PHR";
  if (n.startsWith("mcallen")) return "MCA";
  if (n.startsWith("palmhurst") || n.includes("mission")) return "MIS";
  if (n.startsWith("edinburg")) return "EDG";
  return name.slice(0, 3).toUpperCase();
}

/** Display order for the position groups inside a day. */
export const POSITION_ORDER = ["manager", "office", "sales", "warehouse", "owner"] as const;
