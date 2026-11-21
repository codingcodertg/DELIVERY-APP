import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { limita, respuesta429 } from "@/lib/rate-limit";
import { claveDeDireccion } from "@/lib/cache-google";
import { guardaGeocode, leeGeocode } from "@/lib/cache-google-servidor";
import { urlDeGoogleGeocode } from "@/lib/busqueda-de-direccion";
import { puntoEnElValle } from "@/lib/distancia-plausible";

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

// Lo que contesta Google, con la dirección formateada para la caché (`geocode_cache`).
async function viaGoogle(q: string, key: string): Promise<{ lat: number; lng: number; formatted: string | null } | null> {
  // Solo Texas, con sesgo al Valle (21 nov: «2124 West Olympia, Alton» caía en Alton, Illinois y la ruta subía por Texas).
  const res = await fetch(urlDeGoogleGeocode(q, key));
  const data = await res.json();
  const primero = (data.results ?? []).find((r: { geometry?: { location?: { lat: number; lng: number } } }) =>
    r.geometry?.location && puntoEnElValle(r.geometry.location.lat, r.geometry.location.lng));
  const loc = primero?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng, formatted: (primero.formatted_address as string | undefined) ?? null } : null;
}

async function viaMapbox(q: string, token: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=1&country=us&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  const center = data.features?.[0]?.center; // [lng, lat]
  return center && puntoEnElValle(center[1], center[0]) ? { lat: center[1], lng: center[0] } : null;
}

async function viaOSM(q: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`;
  const res = await fetch(url, {
    headers: { "User-Agent": "RDZ-Deliveries/1.0 (internal logistics tool)" },
  });
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  const p = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  return puntoEnElValle(p.lat, p.lng) ? p : null;
}

export async function POST(req: Request) {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const lim = await limita(req, { clave: "geocode-point", max: 120, ventanaSeg: 60 });
  if (!lim.ok) return respuesta429(lim.reset);

  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const address = (body.address || "").trim();
  if (!address) return NextResponse.json({ error: "No address" }, { status: 400 });

  // Primero la caché (clave = dirección normalizada): lo que Google ya contestó no vuelve a pagarse.
  const clave = claveDeDireccion(address);
  const guardada = await leeGeocode(clave);
  if (guardada && puntoEnElValle(guardada.lat, guardada.lng)) return NextResponse.json({ lat: guardada.lat, lng: guardada.lng });

  const google = process.env.GOOGLE_MAPS_API_KEY;
  const mapbox = process.env.MAPBOX_TOKEN;

  // Try each configured provider and fall through on failure/empty — so a
  // disabled/uncredited Google key still falls back to free OSM.
  const safe = async <T,>(fn: () => Promise<T | null>): Promise<T | null> => { try { return await fn(); } catch { return null; } };
  let point: { lat: number; lng: number } | null = null;
  if (google) {
    const deGoogle = await safe(() => viaGoogle(address, google));
    if (deGoogle) {
      // Solo se guarda lo que contestó Google: lo de Mapbox/OSM se vuelve a pedir, como antes.
      await guardaGeocode(clave, deGoogle);
      point = { lat: deGoogle.lat, lng: deGoogle.lng };
    }
  }
  if (!point && mapbox) point = await safe(() => viaMapbox(address, mapbox));
  if (!point) point = await safe(() => viaOSM(address));
  if (!point) return NextResponse.json({ error: "Address not found" }, { status: 404 });
  return NextResponse.json(point);
}
