import { NextResponse } from "next/server";
import { computeRoute, METERS_PER_MILE, type RoutePoint } from "@/lib/google-routes";

import { requireUser } from "@/lib/api-auth";

// ============================================================
// Best visiting order for a driver's stops on a given day, plus the real
// driving path between them.
//
// PRIMARY — Google Routes API (needs GOOGLE_MAPS_API_KEY + Routes API enabled):
// traffic-aware, respects turn restrictions and one-ways, and prices a route
// for the hour the truck actually departs. This is what makes a detour or a
// double-back down the highway show up in the numbers.
//
// FALLBACK — the free OSRM "trip" service, used when there's no key, Google
// errors, or the route has more stops than one optimized call may carry.
// Dispatch keeps working (just without traffic) instead of dying.
//
// Identical requests are cached briefly, so re-optimizing the same board
// doesn't pay for the same answer twice.
// ============================================================

export const runtime = "nodejs";

function fmtDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

interface Payload {
  order: string[];
  miles: number;
  duration_text: string;
  duration_seconds: number;
  legs: number[];
  geometry: [number, number][];
  provider: string;
  traffic: boolean;
}

// ---- Small in-process cache -------------------------------------------------
// Warm serverless instances reuse this; a cold start just re-asks. Enough to
// absorb the repeated calls a dispatcher makes while arranging one board.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; payload: Payload }>();

function cacheGet(key: string): Payload | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.payload;
}
function cacheSet(key: string, payload: Payload) {
  if (cache.size > 300) cache.clear();   // crude bound; this is a warm-path cache
  cache.set(key, { at: Date.now(), payload });
}

// ---- Free fallback router ---------------------------------------------------
async function viaOSRM(stops: RoutePoint[], roundtrip: boolean, optimize = true): Promise<Payload> {
  // The "trip" service SOLVES the order; "route" walks the stops as given.
  // Asking trip for a fixed-order path would quietly hand back a different
  // sequence than the caller asked to draw.
  if (!optimize) {
    const path = roundtrip ? [...stops, stops[0]] : stops;
    const coords = path.map((s) => `${s.lng},${s.lat}`).join(";");
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) throw new Error(data?.message || "Route failed");
    return {
      order: stops.map((s) => s.id),
      miles: Math.round((route.distance / METERS_PER_MILE) * 10) / 10,
      duration_text: fmtDuration(route.duration),
      duration_seconds: route.duration,
      legs: ((route.legs ?? []) as { duration: number }[]).map((l) => l.duration),
      geometry: (route.geometry?.coordinates ?? []) as [number, number][],
      provider: "osrm",
      traffic: false,
    };
  }
  const coords = stops.map((s) => `${s.lng},${s.lat}`).join(";");
  const url =
    `https://router.project-osrm.org/trip/v1/driving/${coords}` +
    `?overview=full&geometries=geojson&roundtrip=${roundtrip}&source=first${roundtrip ? "" : "&destination=any"}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok" || !data.trips?.[0] || !Array.isArray(data.waypoints)) {
    throw new Error(data.message || "Route optimization failed");
  }
  const order = stops
    .map((s, i) => ({ id: s.id, seq: data.waypoints[i].waypoint_index as number }))
    .sort((a, b) => a.seq - b.seq)
    .map((w) => w.id);
  const trip = data.trips[0];
  return {
    order,
    miles: Math.round((trip.distance / METERS_PER_MILE) * 10) / 10,
    duration_text: fmtDuration(trip.duration),
    duration_seconds: trip.duration,
    legs: ((trip.legs ?? []) as { duration: number }[]).map((l) => l.duration),
    geometry: (trip.geometry?.coordinates ?? []) as [number, number][],
    provider: "osrm",
    traffic: false,
  };
}

export async function POST(req: Request) {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: { stops?: RoutePoint[]; roundtrip?: boolean; date?: string | null; traffic_optimal?: boolean; optimize?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const stops = (body.stops ?? []).filter(
    (s): s is RoutePoint => typeof s?.id === "string" && Number.isFinite(s?.lat) && Number.isFinite(s?.lng),
  );
  const roundtrip = !!body.roundtrip;
  const dateISO = typeof body.date === "string" ? body.date : null;
  // Default true (dispatch solves the order). A driver drawing the route
  // they were ASSIGNED passes false, so the line follows their plan.
  const optimize = body.optimize !== false;

  if (stops.length < 2) {
    return NextResponse.json({ order: stops.map((s) => s.id), miles: 0, duration_text: "", duration_seconds: 0, geometry: [], legs: [], provider: "none", traffic: false });
  }

  const key = JSON.stringify([stops.map((s) => [s.id, s.lat.toFixed(5), s.lng.toFixed(5)]), roundtrip, dateISO, !!body.traffic_optimal, optimize]);
  const cached = cacheGet(key);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  let googleError: string | null = null;

  if (apiKey) {
    try {
      const r = await computeRoute({
        stops,
        roundtrip,
        dateISO,
        routingPreference: body.traffic_optimal ? "TRAFFIC_AWARE_OPTIMAL" : "TRAFFIC_AWARE",
        optimize,
        apiKey,
      });
      const payload: Payload = {
        order: r.order,
        miles: r.miles,
        duration_text: fmtDuration(r.seconds),
        duration_seconds: r.seconds,
        legs: r.legs,
        geometry: r.geometry,
        provider: r.provider,
        traffic: r.traffic,
      };
      cacheSet(key, payload);
      return NextResponse.json(payload);
    } catch (e) {
      // Fall through to the free router rather than leaving dispatch stuck.
      googleError = e instanceof Error ? e.message : "Google Routes failed";
      console.warn("[optimize-route] Google Routes unavailable, using OSRM:", googleError);
    }
  }

  try {
    const payload = await viaOSRM(stops, roundtrip, optimize);
    cacheSet(key, payload);
    // Surfaced so the UI can say the numbers aren't traffic-aware yet.
    return NextResponse.json(googleError ? { ...payload, google_error: googleError } : payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Route optimization failed";
    return NextResponse.json({ error: googleError ? `${msg} (Google: ${googleError})` : msg }, { status: 502 });
  }
}
