"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";

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
