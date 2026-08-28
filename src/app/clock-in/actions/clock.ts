"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { firstMatch, type GeoSite } from "@/lib/clockin/geofence";
import { pushToManagers, pushToUser } from "@/lib/clockin/notify";
import { canManageEmployee, type Me } from "@/lib/clockin/mgrScope";
import { centralShiftMs } from "@/lib/clockin/tz";

// Local dev only: when set in .env.local, every punch is treated as on-site so
// the flow can be tested from a laptop that isn't inside a real geofence. Double
// -guarded — the NODE_ENV check means it can NEVER activate in a production build
// even if the env var somehow leaked to Netlify.
const DEV_BYPASS_GEOFENCE =
  process.env.DEV_BYPASS_GEOFENCE === "1" && process.env.NODE_ENV !== "production";

export type ClockInResult =
  | { ok: true; entryId: string; clockInAt: string; onSite: boolean; earlyMin?: number }
  | { ok: false; code: "needs_reason"; context: "offsite" | "unscheduled" | "other_site" }
  | { ok: false; code: "already_open"; entryId: string; clockInAt: string }
  | { ok: false; code: "not_configured" | "not_signed_in" | "error"; message: string };

export type ClockOutResult = { ok: true; onSite: boolean } | { ok: false; message: string };

type ClockOutInput = {
  // Required: location is recorded on the way OUT as well as IN. The client's
  // whole reason for this system is knowing where each punch happened.
  lat: number;
  lng: number;
  accuracy?: number;
  photoPath?: string;
  deviceId?: string;
};

type ClockInput = {
  lat: number;
  lng: number;
  accuracy?: number;
  reason?: string;
  note?: string;
  photoPath?: string;
  deviceId?: string;
};

async function getAuthed() {
  if (!isSupabaseConfigured) return { ok: false as const, code: "not_configured" as const };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, code: "not_signed_in" as const };
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id, full_name, store_id, role")
    .eq("id", user.id)
    .single();
  if (!profile) return { ok: false as const, code: "error" as const };
  return { ok: true as const, supabase, user, profile };
}

/**
 * Clock in with a server-side geofence check. Refuses if the user already has an
 * open shift. The browser only REPORTS coordinates — the server decides on-site.
 */
export async function clockIn(input: ClockInput): Promise<ClockInResult> {
  const ctx = await getAuthed();
  if (!ctx.ok) {
    const msg =
      ctx.code === "not_configured"
        ? "Supabase is not configured yet."
        : ctx.code === "not_signed_in"
          ? "Please sign in to clock in."
          : "No profile found for this user.";
    return { ok: false, code: ctx.code, message: msg };
  }
  const { supabase, user, profile } = ctx;

  // Already clocked in? Don't create a duplicate open shift.
  const { data: existing } = await supabase
    .from("time_entries")
    .select("id, clock_in_at")
    .eq("employee_id", user.id)
    .eq("status", "open")
    .order("clock_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { ok: false, code: "already_open", entryId: existing.id, clockInAt: existing.clock_in_at };
  }

  // Server-side geofence: which (if any) active site is this within?
  // Supports polygon (property outline + padding) and circle sites.
  const { data: sites } = await supabase
    .from("job_sites")
    .select("id, latitude, longitude, radius_meters, boundary, padding_meters")
    .eq("company_id", profile.company_id)
    .eq("active", true);
  const siteId = firstMatch(input.lat, input.lng, (sites ?? []) as GeoSite[]);
  const onSite = !!siteId || DEV_BYPASS_GEOFENCE;

  // Off-site punches always need a reason (existing rule).
  if (!onSite && !input.reason) {
    return { ok: false, code: "needs_reason", context: "offsite" };
  }

  // On a site, but not the one they're assigned to? Ask why (e.g. "visiting
  // another store"). Not a block — it's flagged for the manager, like off-site.
  //
  // Estar atado es TENER SITIO ASIGNADO, y ya no "no ser dueño" (fase 1 de la fusión,
  // migración 084). Con dos niveles de rol, colgarlo del rol habría desatado a todo
  // admin — Patricia incluida, que hoy sí está atada a Brownsville. Quien debe roamear
  // simplemente no tiene sitio, que es lo que esa columna quiso decir siempre; a los
  // dueños se les quitó el suyo en 084 para que el resultado fuese idéntico al de hoy.
  const homeBound = !!profile.store_id;
  const atWrongSite = homeBound && !!siteId && siteId !== profile.store_id;
  if (atWrongSite && !input.reason) {
    return { ok: false, code: "needs_reason", context: "other_site" };
  }

  // Link to today's scheduled shift (if any) so we can later compute late/early.
  const centralDate = new Date(Date.now() - centralShiftMs(new Date())).toISOString().slice(0, 10);
  const { data: todayShift } = await supabase
    .from("scheduled_shifts")
    .select("id, start_time")
    .eq("employee_id", user.id)
    .eq("shift_date", centralDate)
    .limit(1)
    .maybeSingle();

  // Unscheduled clock-in: on-site but no shift today. Only enforce a reason once
  // scheduling is actually in use company-wide today — otherwise early rollout
  // (before any schedules exist) would nag on every single punch.
  if (onSite && !todayShift && !input.reason) {
    const { count: scheduledToday } = await supabase
      .from("scheduled_shifts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", profile.company_id)
      .eq("shift_date", centralDate);
    if ((scheduledToday ?? 0) > 0) {
      return { ok: false, code: "needs_reason", context: "unscheduled" };
    }
  }
  const isUnscheduled = onSite && !todayShift && !!input.reason;

  const { data: entry, error } = await supabase
    .from("time_entries")
    .insert({
      company_id: profile.company_id,
      employee_id: user.id,
      scheduled_shift_id: todayShift?.id ?? null,
      clock_in_lat: input.lat,
      clock_in_lng: input.lng,
      clock_in_site_id: siteId ?? null,
      clock_in_in_radius: onSite,
      clock_in_photo_path: input.photoPath ?? null,
      device_id: input.deviceId ?? null,
      status: "open",
    })
    .select("id, clock_in_at")
    .single();

  if (error || !entry) {
    return { ok: false, code: "error", message: error?.message ?? "Could not record entry." };
  }

  if (!onSite) {
    await supabase.from("exceptions").insert({
      company_id: profile.company_id,
      employee_id: user.id,
      time_entry_id: entry.id,
      type: "out_of_radius",
      reason: input.reason,
      note: input.note ?? null,
      photo_path: input.photoPath ?? null,
      latitude: input.lat,
      longitude: input.lng,
    });
    // Real-time alert to managers about the off-site clock-in.
    await pushToManagers(profile.company_id, "mgr_offsite", { name: profile.full_name });
  } else if (isUnscheduled) {
    // On-site but not on the schedule — log it so a manager can review, and ping them.
    await supabase.from("exceptions").insert({
      company_id: profile.company_id,
      employee_id: user.id,
      time_entry_id: entry.id,
      type: "other",
      reason: input.reason,
      note: input.note ?? null,
      photo_path: input.photoPath ?? null,
      latitude: input.lat,
      longitude: input.lng,
    });
    await pushToManagers(profile.company_id, "mgr_unscheduled", { name: profile.full_name });
  } else if (atWrongSite) {
    // On site — just not THEIR site. Record where they actually are + why.
    await supabase.from("exceptions").insert({
      company_id: profile.company_id,
      employee_id: user.id,
      time_entry_id: entry.id,
      type: "other",
      reason: input.reason,
      note: input.note ?? null,
      photo_path: input.photoPath ?? null,
      latitude: input.lat,
      longitude: input.lng,
    });
    await pushToManagers(profile.company_id, "mgr_other_site", { name: profile.full_name });
  }

  // Early-arrival rule: how many minutes before the scheduled start (if on site)?
  let earlyMin: number | undefined;
  if (onSite && todayShift?.start_time) {
    const nowCentral = new Date(Date.now() - centralShiftMs(new Date()));
    const nowMin = nowCentral.getUTCHours() * 60 + nowCentral.getUTCMinutes();
    const [sh, sm] = todayShift.start_time.split(":").map(Number);
    const diff = sh * 60 + sm - nowMin;
    if (diff > 0) earlyMin = diff;
  }

  return { ok: true, entryId: entry.id, clockInAt: entry.clock_in_at, onSite, earlyMin };
}

/**
 * Close an open shift WITH the same verification as clock-in: GPS + photo, a
 * server-side geofence check, and — if the punch is off-site — a flagged
 * exception plus a manager alert. This is what stops "clock in on-site, drive
 * home, clock out from the couch."
 */
export async function clockOut(entryId: string, input: ClockOutInput): Promise<ClockOutResult> {
  const ctx = await getAuthed();
  if (!ctx.ok) return { ok: false, message: "Not signed in." };
  const { supabase, user, profile } = ctx;

  // Still on a break? End it first. The client used to close the break as part of
  // clocking out, which meant a refused clock-out silently ate the lunch.
  const { data: openLeave } = await supabase
    .from("exceptions")
    .select("id")
    .eq("employee_id", user.id)
    .eq("type", "leaving_while_clocked_in")
    .is("returned_at", null)
    .limit(1)
    .maybeSingle();
  if (openLeave) {
    const { data: l } = await supabase.from("profiles").select("language").eq("id", user.id).maybeSingle();
    return {
      ok: false,
      message:
        l?.language === "es"
          ? "Termina tu almuerzo antes de marcar salida."
          : "End your lunch before clocking out.",
    };
  }

  // A run must not outlive the shift. Closing the shift while a run is open is
  // how trips ended up spanning overnight and collecting the next day's stops —
  // so end the run first, which also captures the real ending odometer instead
  // of the system guessing one later.
  const { data: openRun } = await supabase
    .from("vehicle_trips")
    .select("id")
    .eq("employee_id", user.id)
    .is("ended_at", null)
    .limit(1)
    .maybeSingle();
  if (openRun) {
    const { data: lang } = await supabase.from("profiles").select("language").eq("id", user.id).maybeSingle();
    return {
      ok: false,
      message:
        lang?.language === "es"
          ? "Termina tu recorrido antes de marcar salida."
          : "End your run before clocking out.",
    };
  }

  // Server-side geofence (never trust the client's verdict).
  const { data: sites } = await supabase
    .from("job_sites")
    .select("id, latitude, longitude, radius_meters, boundary, padding_meters")
    .eq("company_id", profile.company_id)
    .eq("active", true);
  const siteId = firstMatch(input.lat, input.lng, (sites ?? []) as GeoSite[]);
  const onSite = !!siteId || DEV_BYPASS_GEOFENCE;

  const { data: closed, error } = await supabase
    .from("time_entries")
    .update({
      clock_out_at: new Date().toISOString(),
      clock_out_lat: input.lat,
      clock_out_lng: input.lng,
      clock_out_site_id: siteId ?? null,
      clock_out_in_radius: onSite,
      clock_out_photo_path: input.photoPath ?? null,
      status: "closed",
    })
    .eq("id", entryId)
    .eq("employee_id", user.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!closed) return { ok: false, message: "This shift is already closed." };

  // Off-site clock-out is the classic fraud signal — flag it for the manager.
  // Clocking out at ANOTHER store (not their own) is flagged too, but labelled
  // as such rather than as off-site. Mismo criterio que en la entrada: atado es
  // tener sitio, no el rol (084).
  const homeBound = !!profile.store_id;
  const atWrongSite = homeBound && !!siteId && siteId !== profile.store_id;
  if (!onSite) {
    await supabase.from("exceptions").insert({
      company_id: profile.company_id,
      employee_id: user.id,
      time_entry_id: entryId,
      type: "out_of_radius",
      reason: "other",
      note: "Clocked out away from a job site",
      photo_path: input.photoPath ?? null,
      latitude: input.lat,
      longitude: input.lng,
    });
    await pushToManagers(profile.company_id, "mgr_offsite_out", { name: profile.full_name });
  } else if (atWrongSite) {
    await supabase.from("exceptions").insert({
      company_id: profile.company_id,
      employee_id: user.id,
      time_entry_id: entryId,
      type: "other",
      reason: "other",
      note: "Clocked out at another store",
      photo_path: input.photoPath ?? null,
      latitude: input.lat,
      longitude: input.lng,
    });
    await pushToManagers(profile.company_id, "mgr_other_site_out", { name: profile.full_name });
  }

  // Scheduled a lunch but never punched one? Managers + owner should know — the
  // punch is what protects the company, so a missing one is worth a look.
  const centralDate = new Date(Date.now() - centralShiftMs(new Date())).toISOString().slice(0, 10);
  const { data: todayShift } = await supabase
    .from("scheduled_shifts")
    .select("lunch_minutes")
    .eq("employee_id", user.id)
    .eq("shift_date", centralDate)
    .limit(1)
    .maybeSingle();
  const allowed = (todayShift?.lunch_minutes as number) ?? 0;
  if (allowed > 0) {
    const { count: lunchCount } = await supabase
      .from("exceptions")
      .select("id", { count: "exact", head: true })
      .eq("time_entry_id", entryId)
      .eq("reason", "lunch");
    if (!lunchCount) {
      await pushToManagers(profile.company_id, "mgr_no_lunch", { name: profile.full_name, allowed });
    }
  }

  return { ok: true, onSite };
}

/**
 * "Yes, I'm still working" — the answer to the 7:55 PM prompt. Stamping this
 * pushes the automatic clock-out back an hour (see /api/cron), so someone
 * genuinely working late doesn't get closed out from under them. It does NOT
 * turn the rule off: an hour later they get asked again.
 */
export async function stillWorking(): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await getAuthed();
  if (!ctx.ok) return { ok: false, message: "Not signed in." };
  const { supabase, user } = ctx;

  const { data: updated, error } = await supabase
    .from("time_entries")
    .update({ still_working_at: new Date().toISOString() })
    .eq("employee_id", user.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!updated) return { ok: false, message: "You're not clocked in." };
  return { ok: true };
}

export type AdminClockResult = { ok: true; action: "in" | "out" } | { ok: false; message: string };

/**
 * A manager/owner clocks an employee in or out on their behalf — e.g. the crew
 * has no signal at the site. Records who did it + the reason, and notifies the
 * employee. No GPS/photo (it's an admin action, not a self-punch).
 */
export async function adminClock(input: {
  employeeId: string;
  action: "in" | "out";
  reason: string;
}): Promise<AdminClockResult> {
  const ctx = await getAuthed();
  if (!ctx.ok) return { ok: false, message: "Not signed in." };
  const { supabase, user, profile } = ctx;

  const { data: meRow } = await supabase.from("profiles").select("role, store_id").eq("id", user.id).maybeSingle();
  if (!meRow || (meRow.role !== "manager" && meRow.role !== "owner")) return { ok: false, message: "Managers only." };
  const me: Me = { role: meRow.role, company_id: profile.company_id, store_id: (meRow.store_id as string) ?? null };
  if (!(await canManageEmployee(supabase, me, input.employeeId))) {
    return { ok: false, message: "That employee isn't in your store." };
  }
  const reason = input.reason?.trim();
  if (!reason) return { ok: false, message: "Please add a reason." };

  const { data: open } = await supabase
    .from("time_entries")
    .select("id")
    .eq("employee_id", input.employeeId)
    .eq("status", "open")
    .order("clock_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (input.action === "in") {
    if (open) return { ok: false, message: "They're already clocked in." };
    const centralDate = new Date(Date.now() - centralShiftMs(new Date())).toISOString().slice(0, 10);
    const { data: todayShift } = await supabase
      .from("scheduled_shifts")
      .select("id, site_id")
      .eq("employee_id", input.employeeId)
      .eq("shift_date", centralDate)
      .limit(1)
      .maybeSingle();
    const { error } = await supabase.from("time_entries").insert({
      company_id: profile.company_id,
      employee_id: input.employeeId,
      scheduled_shift_id: todayShift?.id ?? null,
      clock_in_site_id: todayShift?.site_id ?? null,
      clock_in_in_radius: null,
      status: "open",
      manual: true,
      edited_by: user.id,
      edited_at: new Date().toISOString(),
      edit_note: `Clocked in by ${profile.full_name}: ${reason}`,
    });
    if (error) return { ok: false, message: error.message };
    await pushToUser(input.employeeId, profile.company_id, "admin_clocked_in", { name: profile.full_name });
    return { ok: true, action: "in" };
  }

  if (!open) return { ok: false, message: "They're not clocked in." };
  const { error } = await supabase
    .from("time_entries")
    .update({
      clock_out_at: new Date().toISOString(),
      status: "closed",
      edited_by: user.id,
      edited_at: new Date().toISOString(),
      edit_note: `Clocked out by ${profile.full_name}: ${reason}`,
    })
    .eq("id", open.id);
  if (error) return { ok: false, message: error.message };
  await pushToUser(input.employeeId, profile.company_id, "admin_clocked_out", { name: profile.full_name });
  return { ok: true, action: "out" };
}
