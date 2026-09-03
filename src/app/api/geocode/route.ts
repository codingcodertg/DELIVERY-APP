import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";

// ============================================================
// Address autocomplete (real-time search suggestions).
//
// Provider is chosen automatically by which env var is present, matching
// /api/distance so suggestions and routing agree:
//   GOOGLE_MAPS_API_KEY → Google Places Autocomplete
//   MAPBOX_TOKEN        → Mapbox geocoding (autocomplete)
//   (neither)           → OpenStreetMap Nominatim search (free, no key)
//
// Returns { suggestions: string[] }. Needs internet; degrades to [] on error.
// ============================================================

export const runtime = "nodejs";

// Google Places Autocomplete (NEW API) — best for as-you-type suggestions.
// Uses the current places.googleapis.com endpoint (the legacy
// maps/api/place/autocomplete one is off for projects on the new Places API).
async function viaGoogle(q: string, key: string): Promise<string[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({ input: q, includedRegionCodes: ["us"] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Google autocomplete failed");
  return (data.suggestions || [])
    .map((s: { placePrediction?: { text?: { text?: string } } }) => s.placePrediction?.text?.text)
    .filter((t: string | undefined): t is string => !!t);
}

// Google Geocoding fallback — used when the Places API isn't enabled. Not true
// autocomplete, but Google-accurate: it resolves the typed text to real,
// formatted addresses, so suggestions match how routing geocodes them.
async function viaGoogleGeocode(q: string, key: string): Promise<string[]> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=us&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(data.error_message || data.status || "Google geocode failed");
  }
  return (data.results || []).map((r: { formatted_address: string }) => r.formatted_address);
}

async function viaMapbox(q: string, token: string): Promise<string[]> {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
    `?autocomplete=true&limit=5&country=us&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.features || []).map((f: { place_name: string }) => f.place_name);
}

async function viaOSM(q: string): Promise<string[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=us`;
  const res = await fetch(url, {
    headers: { "User-Agent": "RDZ-Deliveries/1.0 (internal logistics tool)" },
  });
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((d: { display_name: string }) => d.display_name);
}

export async function POST(req: Request) {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: { q?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
  const q = (body.q || "").trim();
  if (q.length < 3) return NextResponse.json({ suggestions: [] });

  const google = process.env.GOOGLE_MAPS_API_KEY;
  const mapbox = process.env.MAPBOX_TOKEN;

  // Try each configured provider and fall through on failure/empty, so if
  // Google is disabled/uncredited we still get free OSM results.
  const safe = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => { try { return await fn(); } catch { return []; } };
  let suggestions: string[] = [];
  if (google) suggestions = await safe(() => viaGoogle(q, google));                 // Places Autocomplete
  if (!suggestions.length && google) suggestions = await safe(() => viaGoogleGeocode(q, google)); // Google Geocoding
  if (!suggestions.length && mapbox) suggestions = await safe(() => viaMapbox(q, mapbox));
  if (!suggestions.length) suggestions = await safe(() => viaOSM(q));               // last resort: OSM
  return NextResponse.json({ suggestions: suggestions.slice(0, 6) });
}
