"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { clockinManagerCtx } from "@/lib/clockin/managerCtx";

export type SiteResult = { ok: true } | { ok: false; message: string };

// Job sites (geofences) are OWNER-ONLY — managers can't add, edit, or toggle them.
async function ownerCtx() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Not signed in." };
  const { data: me } = await supabase
    .from("profiles")
    .select("role, company_id")
    .eq("id", user.id)
    .single();
  if (!me || me.role !== "owner") {
    return { ok: false as const, message: "Only the owner can manage job sites." };
  }
  return { ok: true as const, supabase, companyId: me.company_id };
}

export async function addSite(input: {
  name: string;
  lat: number;
  lng: number;
  radius: number;
  boundary?: { lat: number; lng: number }[] | null;
  padding?: number;
}): Promise<SiteResult> {
  const ctx = await ownerCtx();
  if (!ctx.ok) return ctx;
  if (!input.name.trim()) return { ok: false, message: "Site name is required." };

  const poly = input.boundary && input.boundary.length >= 3 ? input.boundary : null;
  let lat = input.lat;
  let lng = input.lng;

  if (poly) {
    // store the centroid as lat/lng (NOT NULL) — the polygon drives the check
    lat = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
    lng = poly.reduce((s, p) => s + p.lng, 0) / poly.length;
  } else if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: "Draw the property outline or enter coordinates." };
  }

  const radius = Number.isFinite(input.radius) && input.radius > 0 ? Math.round(input.radius) : 100;
  const padding = Number.isFinite(input.padding ?? NaN) && (input.padding ?? 0) >= 0 ? Math.round(input.padding!) : 25;

  const { error } = await ctx.supabase.from("job_sites").insert({
    company_id: ctx.companyId,
    name: input.name.trim(),
    latitude: lat,
    longitude: lng,
    radius_meters: radius,
    boundary: poly,
    padding_meters: padding,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function updateSite(
  id: string,
  input: { name: string; lat: number; lng: number; radius: number; boundary?: { lat: number; lng: number }[] | null; padding?: number },
): Promise<SiteResult> {
  const ctx = await ownerCtx();
  if (!ctx.ok) return ctx;
  if (!input.name.trim()) return { ok: false, message: "Site name is required." };

  const poly = input.boundary && input.boundary.length >= 3 ? input.boundary : null;
  let lat = input.lat;
  let lng = input.lng;
  if (poly) {
    lat = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
    lng = poly.reduce((s, p) => s + p.lng, 0) / poly.length;
  } else if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: "Draw the property outline or enter coordinates." };
  }
  const radius = Number.isFinite(input.radius) && input.radius > 0 ? Math.round(input.radius) : 100;
  const padding = Number.isFinite(input.padding ?? NaN) && (input.padding ?? 0) >= 0 ? Math.round(input.padding!) : 25;

  const { error } = await ctx.supabase
    .from("job_sites")
    .update({ name: input.name.trim(), latitude: lat, longitude: lng, radius_meters: radius, boundary: poly, padding_meters: padding })
    .eq("id", id)
    .eq("company_id", ctx.companyId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function setSiteActive(id: string, active: boolean): Promise<SiteResult> {
  const ctx = await ownerCtx();
  if (!ctx.ok) return ctx;
  const { error } = await ctx.supabase.from("job_sites").update({ active }).eq("id", id).eq("company_id", ctx.companyId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * Las geocercas de la empresa, para la sección de Ajustes de Time Tracker.
 *
 * Se lee desde aquí y no desde la pantalla porque el permiso ya está resuelto en
 * `clockinManagerCtx`: escribir otra vez "solo admin" en el componente sería la segunda
 * copia de una regla de acceso.
 */
export async function getGeofences(): Promise<
  | { ok: true; sites: {
      id: string; name: string; active: boolean;
      latitude: number | null; longitude: number | null;
      radius_meters: number | null; padding_meters: number | null;
      boundary: { lat: number; lng: number }[] | null;
    }[] }
  | { ok: false; message: string }
> {
  const ctx = await clockinManagerCtx();
  if (!ctx.ok) return ctx;
  const { data, error } = await ctx.supabase
    .from("job_sites")
    .select("id, name, active, latitude, longitude, radius_meters, padding_meters, boundary")
    .eq("company_id", ctx.companyId)
    .order("name");
  if (error) return { ok: false, message: error.message };
  return { ok: true, sites: (data ?? []) as never };
}

/**
 * Una dirección a coordenadas, para centrar el mapa del editor de geocercas.
 *
 * Con la clave de SERVIDOR, no la del navegador. `/api/geocode` ya existe pero devuelve
 * texto —está hecho para autocompletar direcciones de entrega— y aquí hace falta el punto.
 * Reusar la clave de servidor mantiene la separación que documenta google-maps-loader: la
 * del navegador es visible y solo dibuja mapas; la de servidor es la que paga geocoding y
 * rutas, y nunca sale del servidor.
 *
 * Devuelve null en vez de lanzar: no encontrar una dirección es un resultado normal de
 * escribir mal una calle, no un fallo del que haya que enterarse con una traza.
 */
export async function geocodeForMap(q: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const query = q.trim();
  if (query.length < 3) return null;
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(query) +
      "&region=us&key=" +
      key;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[];
    };
    const hit = data.results?.[0];
    if (!hit) return null;
    return { lat: hit.geometry.location.lat, lng: hit.geometry.location.lng, label: hit.formatted_address };
  } catch {
    return null;
  }
}
