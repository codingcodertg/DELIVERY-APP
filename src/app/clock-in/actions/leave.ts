"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { centralShiftMs } from "@/lib/clockin/tz";
import { pushToManagers } from "@/lib/clockin/notify";

// A few minutes of slack before a lunch counts as "over" (walking back, etc.).
const LUNCH_GRACE_MIN = 5;

export type ActiveLeave = {
  id: string;
  reason: string;
  leftAt: string;
  expectedReturnAt: string | null;
} | null;

export type LeaveResult =
  | { ok: true; leave: NonNullable<ActiveLeave> }
  | { ok: false; message: string };

async function authed() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Not signed in." };
  return { ok: true as const, supabase, user };
}

/** Record that a clocked-in employee is leaving the work location. */
export type PunchGeo = { lat?: number; lng?: number; photoPath?: string };

export async function startLeave(input: {
  reason: string;
  note?: string;
  expectedReturn?: string | null; // "HH:MM" (today, Central)
  geo?: PunchGeo;
}): Promise<LeaveResult> {
  const ctx = await authed();
  if (!ctx.ok) return ctx;
  const { supabase, user } = ctx;

  const { data: entry } = await supabase
    .from("time_entries")
    .select("id, company_id")
    .eq("employee_id", user.id)
    .eq("status", "open")
    .order("clock_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!entry) return { ok: false, message: "You're not clocked in." };

  // An open run has to be settled before a break. Two rules:
  //   1. A stop still open blocks lunch outright — otherwise the stop's duration
  //      would silently swallow the whole break.
  //   2. Otherwise the run is PAUSED automatically, so unpaid lunch miles never
  //      count as company miles and she doesn't have to think about it.
  const { data: openTrip } = await supabase
    .from("vehicle_trips")
    .select("id, paused_at")
    .eq("employee_id", user.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (openTrip) {
    const { data: openStop } = await supabase
      .from("trip_stops")
      .select("id")
      .eq("trip_id", openTrip.id)
      .is("departed_at", null)
      .limit(1)
      .maybeSingle();
    if (openStop) {
      const { data: p } = await supabase.from("profiles").select("language").eq("id", user.id).maybeSingle();
      return {
        ok: false,
        message:
          p?.language === "es"
            ? "Termina tu parada actual antes de empezar el almuerzo."
            : "Finish your current stop before starting lunch.",
      };
    }
  }

  let expectedIso: string | null = null;
  if (input.expectedReturn) {
    const shift = centralShiftMs(new Date());
    const dateStr = new Date(Date.now() - shift).toISOString().slice(0, 10);
    // interpret HH:MM as Central wall time -> real UTC instant
    const central = new Date(`${dateStr}T${input.expectedReturn}:00.000Z`).getTime();
    expectedIso = new Date(central + shift).toISOString();
  }

  const { data: ex, error } = await supabase
    .from("exceptions")
    .insert({
      company_id: entry.company_id,
      employee_id: user.id,
      time_entry_id: entry.id,
      type: "leaving_while_clocked_in",
      reason: input.reason,
      note: input.note ?? null,
      left_at: new Date().toISOString(),
      expected_return_at: expectedIso,
      // GPS + photo of the OUT punch (off-site lunch is normal — recorded, not blocked).
      latitude: input.geo?.lat ?? null,
      longitude: input.geo?.lng ?? null,
      photo_path: input.geo?.photoPath ?? null,
    })
    .select("id, reason, left_at, expected_return_at")
    .single();

  if (error || !ex) return { ok: false, message: error?.message ?? "Could not record." };

  // Break recorded — now pause the run. Best-effort on purpose: the punch is what
  // protects her, so a pause failure must never undo a recorded break.
  if (openTrip && !openTrip.paused_at) {
    await supabase.from("vehicle_trips").update({ paused_at: ex.left_at }).eq("id", openTrip.id);
  }

  return {
    ok: true,
    leave: { id: ex.id, reason: ex.reason, leftAt: ex.left_at, expectedReturnAt: ex.expected_return_at },
  };
}

/** Mark a leave as returned, stamping the BACK punch's GPS + photo. */
export async function endLeave(id: string, geo?: PunchGeo): Promise<{ ok: boolean; message?: string }> {
  const ctx = await authed();
  if (!ctx.ok) return ctx;
  // Grab the break first — we need its reason + start to spot a long lunch.
  const { data: lv } = await ctx.supabase
    .from("exceptions")
    .select("reason, left_at, company_id")
    .eq("id", id)
    .eq("employee_id", ctx.user.id)
    .maybeSingle();

  const returnedAt = new Date().toISOString();
  const { error } = await ctx.supabase
    .from("exceptions")
    .update({
      returned_at: returnedAt,
      returned_lat: geo?.lat ?? null,
      returned_lng: geo?.lng ?? null,
      returned_photo_path: geo?.photoPath ?? null,
    })
    .eq("id", id)
    .eq("employee_id", ctx.user.id)
    .is("returned_at", null);
  if (error) return { ok: false, message: error.message };

  // Back from the break — resume the run and bank the paused minutes, so the
  // run's duration reflects driving time rather than time spent eating.
  const { data: paused } = await ctx.supabase
    .from("vehicle_trips")
    .select("id, paused_at, paused_minutes")
    .eq("employee_id", ctx.user.id)
    .is("ended_at", null)
    .not("paused_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paused?.paused_at) {
    const mins = Math.max(0, Math.round((Date.parse(returnedAt) - Date.parse(paused.paused_at)) / 60000));
    await ctx.supabase
      .from("vehicle_trips")
      .update({ paused_at: null, paused_minutes: (paused.paused_minutes ?? 0) + mins })
      .eq("id", paused.id);
  }

  // Alert managers + the owner when a lunch runs past the scheduled break.
  if (lv?.reason === "lunch" && lv.left_at) {
    const mins = Math.round((Date.parse(returnedAt) - Date.parse(lv.left_at)) / 60000);
    const centralDate = new Date(Date.now() - centralShiftMs(new Date())).toISOString().slice(0, 10);
    const { data: shift } = await ctx.supabase
      .from("scheduled_shifts")
      .select("lunch_minutes")
      .eq("employee_id", ctx.user.id)
      .eq("shift_date", centralDate)
      .limit(1)
      .maybeSingle();
    const allowed = (shift?.lunch_minutes as number) ?? 0;
    if (allowed > 0 && mins > allowed + LUNCH_GRACE_MIN) {
      const { data: me } = await ctx.supabase
        .from("profiles")
        .select("full_name, company_id")
        .eq("id", ctx.user.id)
        .maybeSingle();
      if (me?.company_id) {
        await pushToManagers(me.company_id as string, "mgr_lunch_over", {
          name: me.full_name as string,
          n: mins,
          over: mins - allowed,
          allowed,
        });
      }
    }
  }
  return { ok: true };
}
