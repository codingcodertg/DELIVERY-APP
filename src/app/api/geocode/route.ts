import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { esDeTexasGoogle, esDeTexasMapbox, esDeTexasOSM, sugerenciasDePlaces, urlDeGoogleGeocode, urlDeMapbox, urlDeOSM } from "@/lib/busqueda-de-direccion";

// ============================================================
// Address autocomplete (real-time search suggestions).
//
// Provider is chosen automatically by which env var is present, matching
// /api/distance so suggestions and routing agree:
//   GOOGLE_MAPS_API_KEY → Google Places Autocomplete
//   MAPBOX_TOKEN        → Mapbox geocoding (autocomplete)
//   (neither)           → OpenStreetMap Nominatim search (free, no key)
//
// Dónde se busca —Texas como límite, la zona verde como sesgo— lo decide `lib/busqueda-de-direccion` (D-NEXT): aquí
// solo se llama a la red. Cada proveedor filtra SU respuesta a Texas; si no queda nada se pasa al siguiente, que filtra igual.
//
// Returns { suggestions: string[] }. Needs internet; degrades to [] on error.
// ============================================================

export const runtime = "nodejs";

// Google Places Autocomplete (NEW API) — best for as-you-type suggestions.
// Uses the current places.googleapis.com endpoint (the legacy
// maps/api/place/autocomplete one is off for projects on the new Places API).
// Una o dos llamadas: primero la zona verde, y Texas solo si lo local escasea. Lo decide `sugerenciasDePlaces`.
async function viaGoogle(q: string, key: string): Promise<string[]> {
  return sugerenciasDePlaces(q, async (cuerpo) => {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify(cuerpo),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || "Google autocomplete failed");
    return (data.suggestions || [])
      .map((s: { placePrediction?: { text?: { text?: string } } }) => s.placePrediction?.text?.text)
      .filter((t: string | undefined): t is string => !!t);
  });
}

// Google Geocoding fallback — used when the Places API isn't enabled. Not true
// autocomplete, but Google-accurate: it resolves the typed text to real,
// formatted addresses, so suggestions match how routing geocodes them.
async function viaGoogleGeocode(q: string, key: string): Promise<string[]> {
  const res = await fetch(urlDeGoogleGeocode(q, key));
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(data.error_message || data.status || "Google geocode failed");
  }
  return (data.results || []).filter(esDeTexasGoogle).map((r: { formatted_address: string }) => r.formatted_address);
}

async function viaMapbox(q: string, token: string): Promise<string[]> {
  const res = await fetch(urlDeMapbox(q, token));
  const data = await res.json();
  return (data.features || []).filter(esDeTexasMapbox).map((f: { place_name: string }) => f.place_name);
}

async function viaOSM(q: string): Promise<string[]> {
  const res = await fetch(urlDeOSM(q), {
    headers: { "User-Agent": "RDZ-Deliveries/1.0 (internal logistics tool)" },
  });
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.filter(esDeTexasOSM).map((d: { display_name: string }) => d.display_name);
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
