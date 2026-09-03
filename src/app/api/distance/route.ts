import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";

// ============================================================
// Distance + travel-time between two addresses.
//
// Provider is chosen automatically by which env var is present:
//   GOOGLE_MAPS_API_KEY → Google (live traffic)
//   MAPBOX_TOKEN        → Mapbox (live traffic)
//   (neither)           → OpenStreetMap: Nominatim geocode + OSRM route
//                         (real road miles + typical time, NO live traffic)
//
// Runs server-side so any API key stays secret. Works in local mode too,
// as long as the machine has internet access.
// ============================================================

export const runtime = "nodejs";

const METERS_PER_MILE = 1609.344;

function fmtDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

interface Result {
  miles: number;
  duration_text: string;
  duration_min: number;
  provider: string;
  traffic: boolean;
}

// ---------- Google Routes API (traffic-aware) ----------
// The current API. Takes the addresses directly, so there's no separate
// geocode step, and prices the drive with live traffic. Distance Matrix below
// is the legacy service Google no longer enables on new projects — it stays
// only for older projects that still have it switched on.
async function viaGoogleRoutes(origin: string, destination: string, key: string): Promise<Result> {
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: { address: origin },
      destination: { address: destination },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      units: "IMPERIAL",
    }),
  });
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!res.ok || !route) throw new Error(data?.error?.message || `Google Routes failed (${res.status})`);
  const secs = (v: unknown) => { const m = String(v ?? "").match(/([\d.]+)s/); return m ? parseFloat(m[1]) : 0; };
  const seconds = secs(route.duration);
  return {
    miles: Number(route.distanceMeters ?? 0) / METERS_PER_MILE,
    duration_text: fmtDuration(seconds),
    duration_min: Math.round(seconds / 60),
    provider: "Google Maps",
    // `duration` includes traffic; staticDuration is the free-flow time. When
    // they differ, traffic actually moved the number.
    traffic: Math.abs(seconds - secs(route.staticDuration)) > 1,
  };
}

// ---------- Google (Distance Matrix, legacy) ----------
async function viaGoogle(origin: string, destination: string, key: string): Promise<Result> {
  const url =
    "https://maps.googleapis.com/maps/api/distancematrix/json" +
    `?origins=${encodeURIComponent(origin)}` +
    `&destinations=${encodeURIComponent(destination)}` +
    `&departure_time=now&units=imperial&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  const el = data?.rows?.[0]?.elements?.[0];
  if (data.status !== "OK" || !el || el.status !== "OK") {
    throw new Error(el?.status || data?.error_message || data?.status || "Google routing failed");
  }
  const seconds = (el.duration_in_traffic ?? el.duration).value as number;
  return {
    miles: (el.distance.value as number) / METERS_PER_MILE,
    duration_text: fmtDuration(seconds),
    duration_min: Math.round(seconds / 60),
    provider: "Google Maps",
    traffic: !!el.duration_in_traffic,
  };
}

// ---------- Mapbox (geocode + driving-traffic) ----------
async function mapboxGeocode(q: string, token: string): Promise<[number, number]> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=1&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  const c = data?.features?.[0]?.center;
  if (!c) throw new Error(`Could not find location: "${q}"`);
  return [c[0], c[1]]; // [lon, lat]
}

async function viaMapbox(origin: string, destination: string, token: string): Promise<Result> {
  const [o, d] = await Promise.all([mapboxGeocode(origin, token), mapboxGeocode(destination, token)]);
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${o[0]},${o[1]};${d[0]},${d[1]}` +
    `?overview=false&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route) throw new Error(data?.message || "Mapbox routing failed");
  return {
    miles: route.distance / METERS_PER_MILE,
    duration_text: fmtDuration(route.duration),
    duration_min: Math.round(route.duration / 60),
    provider: "Mapbox",
    traffic: true,
  };
}

// ---------- Accurate geocode + free OSRM routing ----------
// Geocode each endpoint with the BEST available geocoder — Google Geocoding
// (accurate, and usually enabled even when Distance Matrix isn't), then Mapbox,
// then Nominatim as a last resort — and route between the resulting coordinates
// with the free OSRM road router. This is what fixes wildly wrong distances
// (e.g. a Brownsville→Brownsville pair coming back as 1600 mi) caused by
// Nominatim mis-locating a street address.
async function googleGeocode(q: string, key: string): Promise<[number, number] | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=us&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  const loc = data.results?.[0]?.geometry?.location;
  return loc ? [loc.lng, loc.lat] : null; // [lon, lat]
}

async function osmGeocode(q: string): Promise<[number, number] | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`;
  const res = await fetch(url, { headers: { "User-Agent": "RDZ-Deliveries/1.0 (internal logistics tool)" } });
  const data = await res.json();
  if (!Array.isArray(data) || !data[0]) return null;
  return [parseFloat(data[0].lon), parseFloat(data[0].lat)]; // [lon, lat]
}

async function geocodeBest(q: string, google?: string, mapbox?: string): Promise<[number, number]> {
  const safe = async (fn: () => Promise<[number, number] | null>) => { try { return await fn(); } catch { return null; } };
  let p: [number, number] | null = null;
  if (google) p = await safe(() => googleGeocode(q, google));
  if (!p && mapbox) p = await safe(() => mapboxGeocode(q, mapbox));
  if (!p) p = await safe(() => osmGeocode(q));
  if (!p) throw new Error(`Could not find location: "${q}"`);
  return p;
}

async function viaGeocodeOSRM(origin: string, destination: string, google?: string, mapbox?: string): Promise<Result> {
  const [o, d] = await Promise.all([geocodeBest(origin, google, mapbox), geocodeBest(destination, google, mapbox)]);
  const url = `https://router.project-osrm.org/route/v1/driving/${o[0]},${o[1]};${d[0]},${d[1]}?overview=false`;
  const res = await fetch(url);
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route) throw new Error(data?.message || "OSRM routing failed");
  return {
    miles: route.distance / METERS_PER_MILE,
    duration_text: fmtDuration(route.duration),
    duration_min: Math.round(route.duration / 60),
    provider: google ? "Google + OSRM" : "OpenStreetMap",
    traffic: false,
  };
}

export async function POST(req: Request) {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: { origin?: string; destination?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const origin = (body.origin || "").trim();
  const destination = (body.destination || "").trim();
  if (!origin || !destination) {
    return NextResponse.json({ error: "Both a pickup and a delivery address are required." }, { status: 400 });
  }

  const google = process.env.GOOGLE_MAPS_API_KEY;
  const mapbox = process.env.MAPBOX_TOKEN;

  // Try each configured provider and fall through on failure — so a
  // disabled/uncredited Google key still falls back to free OSRM routing.
  const safe = async (fn: () => Promise<Result>) => { try { return await fn(); } catch { return null; } };
  try {
    let result: Result | null = null;
    if (google) result = await safe(() => viaGoogleRoutes(origin, destination, google));
    if (!result && google) result = await safe(() => viaGoogle(origin, destination, google));
    if (!result && mapbox) result = await safe(() => viaMapbox(origin, destination, mapbox));
    // Fallback: accurate geocode (Google/Mapbox/OSM) + free OSRM routing.
    if (!result) result = await viaGeocodeOSRM(origin, destination, google, mapbox);
    return NextResponse.json({
      ...result,
      miles: Math.round(result.miles * 10) / 10,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Routing failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
