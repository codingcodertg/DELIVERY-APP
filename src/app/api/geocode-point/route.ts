import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";

// ============================================================
// Resolve a single address to { lat, lng } — used by the dispatch map to
// place a pin for an order that only has a text address (no coordinates
// captured yet). Same provider fallback as /api/geocode and /api/distance:
//   GOOGLE_MAPS_API_KEY → Google Geocoding
//   MAPBOX_TOKEN        → Mapbox geocoding
//   (neither)           → OpenStreetMap Nominatim (free, no key)
// Returns { lat, lng } | { error }. Needs internet.
// ============================================================

export const runtime = "nodejs";

async function viaGoogle(q: string, key: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  const loc = data.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

async function viaMapbox(q: string, token: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=1&country=us&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  const center = data.features?.[0]?.center; // [lng, lat]
  return center ? { lat: center[1], lng: center[0] } : null;
}

async function viaOSM(q: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`;
  const res = await fetch(url, {
    headers: { "User-Agent": "RDZ-Deliveries/1.0 (internal logistics tool)" },
  });
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

export async function POST(req: Request) {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const address = (body.address || "").trim();
  if (!address) return NextResponse.json({ error: "No address" }, { status: 400 });

  const google = process.env.GOOGLE_MAPS_API_KEY;
  const mapbox = process.env.MAPBOX_TOKEN;

  // Try each configured provider and fall through on failure/empty — so a
  // disabled/uncredited Google key still falls back to free OSM.
  const safe = async (fn: () => Promise<{ lat: number; lng: number } | null>) => { try { return await fn(); } catch { return null; } };
  let point: { lat: number; lng: number } | null = null;
  if (google) point = await safe(() => viaGoogle(address, google));
  if (!point && mapbox) point = await safe(() => viaMapbox(address, mapbox));
  if (!point) point = await safe(() => viaOSM(address));
  if (!point) return NextResponse.json({ error: "Address not found" }, { status: 404 });
  return NextResponse.json(point);
}
