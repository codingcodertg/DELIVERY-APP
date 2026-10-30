import { BUSINESS_TZ } from "@/lib/utils";
import { formateadorDeFecha } from "@/lib/formateador";

// ============================================================
// Google Routes API (routes.googleapis.com) — server-side only.
//
// This is the real road router: live/predictive traffic, turn restrictions,
// one-way streets, U-turn rules, and the highway detours-and-doubling-back a
// truck actually has to drive. It replaces the free OSRM router, whose
// straight "shortest path" ignores all of that.
//
// `computeRoutes` with optimizeWaypointOrder solves BOTH problems in one call:
// the best visiting order for the stops AND the traffic-aware path between
// them. The legacy Directions / Distance Matrix APIs are not an option — Google
// no longer enables them on new projects.
// ============================================================

const ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
export const METERS_PER_MILE = 1609.344;

/** Google caps how many intermediate stops one optimized call may carry.
 * Longer routes fall back to the free router rather than failing. */
export const MAX_OPTIMIZED_WAYPOINTS = 25;

export interface RoutePoint { id: string; lat: number; lng: number }

export interface ComputedRoute {
  /** Stop ids in the best visiting order (includes the origin/destination). */
  order: string[];
  miles: number;
  seconds: number;
  /** Per-leg drive seconds, in visiting order (leg k = drive INTO stop k+1). */
  legs: number[];
  /** The traced path as [lng, lat] pairs — same shape the OSRM path returned,
   * so the map layer is unchanged. */
  geometry: [number, number][];
  provider: "google" | "osrm";
  /** True when the estimate accounts for traffic. */
  traffic: boolean;
}

/** Decode a Google encoded polyline into [lng, lat] pairs. */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let result = 0, shift = 0, b: number;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    result = 0; shift = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}

/** "123.4s" → 123.4 seconds. */
function parseSeconds(v: unknown): number {
  if (typeof v === "number") return v;
  const m = String(v ?? "").match(/([\d.]+)s/);
  return m ? parseFloat(m[1]) : 0;
}

/**
 * The instant to depart for a route being planned for `dateISO` (YYYY-MM-DD),
 * as RFC3339. Routes are planned the day before, so pricing them at "now"
 * would use tonight's empty roads for tomorrow's morning run — this asks
 * Google for PREDICTIVE traffic at the hour the truck actually rolls.
 *
 * Google rejects a departure time in the past, so a date that has already
 * started (or passed) falls back to now.
 */
export function departureTimeFor(dateISO: string | null | undefined, hour = 8): string | undefined {
  const soon = Date.now() + 60_000;
  if (!dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return undefined;
  // Find the UTC instant whose BUSINESS_TZ local time is `hour`:00 on that date.
  // Start from the same wall time in UTC, then correct by the zone's offset —
  // which also lands DST correctly, since the offset is read at that instant.
  const guess = Date.parse(`${dateISO}T${String(hour).padStart(2, "0")}:00:00Z`);
  if (Number.isNaN(guess)) return undefined;
  const parts = formateadorDeFecha("en-US", {
    timeZone: BUSINESS_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  const offset = asUTC - guess;          // how far the zone is from UTC at that moment
  const departure = guess - offset;
  return departure > soon ? new Date(departure).toISOString() : undefined;
}

interface ComputeArgs {
  /** Visiting order is solved for the middle stops; the first is the start. */
  stops: RoutePoint[];
  /** True = start and end at stops[0] (the depot), for a reload loop. */
  roundtrip: boolean;
  /** YYYY-MM-DD the route runs on, for predictive traffic. */
  dateISO?: string | null;
  /** TRAFFIC_AWARE is the balanced default; OPTIMAL is slower + pricier. */
  routingPreference?: "TRAFFIC_AWARE" | "TRAFFIC_AWARE_OPTIMAL";
  /**
   * Solve the visiting order, or keep the one given?
   *
   * Dispatch wants it solved. A driver looking at the route they were ASSIGNED
   * does not — re-solving would draw a different order than the plan they're
   * following, which is worse than no map at all.
   */
  optimize?: boolean;
  apiKey: string;
}

/**
 * Turn Google's `optimizedIntermediateWaypointIndex` into a usable visiting
 * order for `count` intermediate stops.
 *
 * Google doesn't always hand back a real permutation: with a single
 * intermediate there is nothing to solve and it answers `[-1]`. Anything that
 * isn't a complete, in-range permutation is ignored in favour of the order the
 * stops were sent in — the caller already sorted those by delivery window, so
 * it's a sane answer rather than a crash.
 */
export function resolveOptimizedOrder(raw: unknown, count: number): number[] {
  const natural = Array.from({ length: count }, (_, i) => i);
  if (!Array.isArray(raw) || raw.length !== count) return natural;
  const seen = new Set<number>();
  for (const v of raw) {
    if (!Number.isInteger(v) || v < 0 || v >= count || seen.has(v)) return natural;
    seen.add(v);
  }
  return raw as number[];
}

/** Great-circle distance, only used to pick a sensible end for an open route. */
function roughDistance(a: RoutePoint, b: RoutePoint): number {
  const dLat = a.lat - b.lat, dLng = (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180);
  return dLat * dLat + dLng * dLng;
}

/**
 * Solve one truckload: the order to visit the stops in, and the real driving
 * path between them.
 *
 * Round trip — the driver loads at the depot, runs the stops, and comes back to
 * reload: origin and destination are both stops[0].
 *
 * Open route (no depot we could geocode) — Google always needs an explicit end,
 * unlike OSRM's "end anywhere". The farthest stop from the start is used as the
 * destination and everything between is optimised, which is the closest honest
 * equivalent.
 */
export async function computeRoute({
  stops, roundtrip, dateISO, routingPreference = "TRAFFIC_AWARE", optimize = true, apiKey,
}: ComputeArgs): Promise<ComputedRoute> {
  if (stops.length < 2) {
    return { order: stops.map((s) => s.id), miles: 0, seconds: 0, legs: [], geometry: [], provider: "google", traffic: false };
  }

  const start = stops[0];
  let end: RoutePoint;
  let middle: RoutePoint[];
  if (roundtrip) {
    end = start;
    middle = stops.slice(1);
  } else if (!optimize) {
    // Order is fixed: the drive simply ends where the list ends.
    end = stops[stops.length - 1];
    middle = stops.slice(1, -1);
  } else {
    const rest = stops.slice(1);
    let far = rest[0];
    for (const s of rest) if (roughDistance(start, s) > roughDistance(start, far)) far = s;
    end = far;
    middle = rest.filter((s) => s.id !== far.id);
  }

  if (middle.length > MAX_OPTIMIZED_WAYPOINTS) {
    throw new Error(`Too many stops for one optimized call (${middle.length} > ${MAX_OPTIMIZED_WAYPOINTS})`);
  }

  const departureTime = departureTimeFor(dateISO);
  const point = (p: RoutePoint) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const body: Record<string, unknown> = {
    origin: point(start),
    destination: point(end),
    travelMode: "DRIVE",
    routingPreference,
    polylineQuality: "HIGH_QUALITY",
    // Trucks can't legally U-turn across a median everywhere; letting Google
    // route around is the whole point of moving off the free router.
    computeAlternativeRoutes: false,
    languageCode: "en-US",
    units: "IMPERIAL",
  };
  if (middle.length) {
    body.intermediates = middle.map(point);
    if (optimize) body.optimizeWaypointOrder = true;
  }
  if (departureTime) body.departureTime = departureTime;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "routes.duration",
        "routes.distanceMeters",
        "routes.polyline.encodedPolyline",
        "routes.legs.duration",
        "routes.legs.distanceMeters",
        "routes.optimizedIntermediateWaypointIndex",
      ].join(","),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok || !data?.routes?.[0]) {
    throw new Error(data?.error?.message || `Google Routes failed (${res.status})`);
  }
  const route = data.routes[0];

  // Rebuild the visiting order. optimizedIntermediateWaypointIndex[k] is the
  // position (in the ORIGINAL intermediates array) of the k-th stop actually
  // visited — so it maps the solved order back onto our stop ids.
  // With optimisation off Google echoes the order we sent, so keep ours.
  const optimized = optimize
    ? resolveOptimizedOrder(route.optimizedIntermediateWaypointIndex, middle.length)
    : middle.map((_, i) => i);
  const order = [start.id, ...optimized.map((i) => middle[i].id)];
  if (!roundtrip) order.push(end.id);

  const legs = (route.legs ?? []).map((l: { duration?: unknown }) => parseSeconds(l.duration));
  return {
    order,
    miles: Math.round((Number(route.distanceMeters ?? 0) / METERS_PER_MILE) * 10) / 10,
    seconds: parseSeconds(route.duration),
    legs,
    geometry: route.polyline?.encodedPolyline ? decodePolyline(route.polyline.encodedPolyline) : [],
    provider: "google",
    traffic: true,
  };
}
