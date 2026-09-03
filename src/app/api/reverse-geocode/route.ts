import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";

// ============================================================
// Resolve { lat, lng } -> a human-readable address — used right after
// dropping a manual pin on the map, so the Delivery Address field fills in
// automatically instead of staying blank. Same provider fallback as the
// other geocoding routes:
//   GOOGLE_MAPS_API_KEY → Google reverse geocoding
//   MAPBOX_TOKEN        → Mapbox reverse geocoding
//   (neither)           → OpenStreetMap Nominatim (free, no key)
// Returns { address: string } | { error }. Needs internet.
// ============================================================

export const runtime = "nodejs";

async function viaGoogle(lat: number, lng: number, key: string): Promise<string | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.results?.[0]?.formatted_address ?? null;
}

async function viaMapbox(lat: number, lng: number, token: string): Promise<string | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?limit=1&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.features?.[0]?.place_name ?? null;
}

async function viaOSM(lat: number, lng: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
  const res = await fetch(url, {
    headers: { "User-Agent": "RDZ-Deliveries/1.0 (internal logistics tool)" },
  });
  const data = await res.json();
  return data.display_name ?? null;
}

export async function POST(req: Request) {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: { lat?: number; lng?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const { lat, lng } = body;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  }

  const google = process.env.GOOGLE_MAPS_API_KEY;
  const mapbox = process.env.MAPBOX_TOKEN;

  // Try each configured provider in turn and fall through on failure/empty —
  // so if Google is set but its Geocoding API isn't enabled (REQUEST_DENIED →
  // no address), we still fall back to the free OSM lookup instead of 404ing.
  const tryProvider = async (fn: () => Promise<string | null>): Promise<string | null> => {
    try { return await fn(); } catch { return null; }
  };

  let address: string | null = null;
  if (google) address = await tryProvider(() => viaGoogle(lat, lng, google));
  if (!address && mapbox) address = await tryProvider(() => viaMapbox(lat, lng, mapbox));
  if (!address) address = await tryProvider(() => viaOSM(lat, lng));

  if (!address) return NextResponse.json({ error: "No address found" }, { status: 404 });
  return NextResponse.json({ address });
}
