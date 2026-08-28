"use server";

import { clockinManagerCtx } from "@/lib/clockin/managerCtx";
import { POSITIONS, roleForPosition, type Position } from "@/lib/clockin/positions";
import { currentAndNextPeriodDates, type WeekPattern } from "@/lib/clockin/schedule";
import { materializeForEmployee, clearFutureShifts } from "./schedule";

function genPassword() {
  return `RTG${Math.floor(1000 + Math.random() * 9000)}!`;
}

const managerCtx = clockinManagerCtx;

// addEmployee() was here and is deliberately gone (D-095).
//
// It created an auth user and a profile row. In rtg-clock-in that was the only way anyone ever
// joined. Here creating an auth user creates a HUB identity — someone who can sign in to
// deliveries — from a screen whose author was only thinking about clock-in, with a password this
// file invented and no module_access decided by anybody. People are created in Users on the hub,
// which is also where their access to each module is granted, and 078's trigger lays down their
// clock-in row the moment their Time Tracker role is set.

/** Everything the hub's Users dialog needs to show one person's clock-in setup, in one round trip. */
export async function getClockinEmployeeSettings(id: string): Promise<
  | {
      ok: true;
      settings: {
        position: string | null;
        default_schedule: string | null;
        custom_schedule: WeekPattern | null;
        store_id: string | null;
        is_runner: boolean;
        vehicle_id: string | null;
        active: boolean;
      } | null;
      sites: { id: string; name: string }[];
      vehicles: { id: string; name: string; plate: string | null; active: boolean }[];
    }
  | { ok: false; message: string }
> {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;

  const [{ data: person }, { data: sites }, { data: vehicles }] = await Promise.all([
    ctx.supabase
      .from("profiles")
      .select("position, default_schedule, custom_schedule, store_id, is_runner, vehicle_id, active")
      .eq("id", id)
      .maybeSingle(),
    ctx.supabase.from("job_sites").select("id, name").eq("company_id", ctx.companyId).eq("active", true).order("name"),
    ctx.supabase.from("vehicles").select("id, name, plate, active").eq("company_id", ctx.companyId).order("name"),
  ]);

  return {
    ok: true,
    // null is a real answer, not a failure: access was just granted and the row exists but is
    // empty, or the dialog is open on someone who has no clock-in access at all.
    settings: (person as never) ?? null,
    sites: sites ?? [],
    vehicles: vehicles ?? [],
  };
}

/** Assign an employee's default schedule type (A / B / C / custom, or null). Manager/owner. */
export async function setEmployeeSchedule(id: string, schedule: string | null) {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  const value = schedule && ["A", "B", "C", "custom"].includes(schedule) ? schedule : null;
  const { error } = await ctx.supabase.from("profiles").update({ default_schedule: value }).eq("id", id);
  if (error) return { ok: false as const, message: error.message };

  // Assigning an A/B/C pattern immediately lays out this week + next week so it
  // shows on My Schedule right away and keeps recurring (the daily roll job extends it).
  if (value === "A" || value === "B" || value === "C") {
    try {
      const { data: emp } = await ctx.supabase.from("profiles").select("store_id").eq("id", id).maybeSingle();
      // Replace, don't stack: clear upcoming shifts before laying out the new pattern.
      await clearFutureShifts(ctx.supabase, id);
      const shiftsCreated = await materializeForEmployee(ctx.supabase, {
        companyId: ctx.companyId as string,
        employeeId: id,
        siteId: (emp?.store_id as string) ?? null,
        presetType: value,
        createdBy: ctx.user.id,
        dates: currentAndNextPeriodDates(),
      });
      return { ok: true as const, shiftsCreated };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "Could not lay out the schedule." };
    }
  }
  return { ok: true as const, shiftsCreated: 0 };
}

/**
 * Reset a person's password (for a forgotten one). Manager/owner only. Generates
 * a new temporary password via the admin API and returns it to hand off — works
 * without email, which suits a crew that may not have reliable inboxes.
 */
export async function resetEmployeePassword(
  id: string,
): Promise<{ ok: true; tempPassword: string } | { ok: false; message: string }> {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;

  // Being a clock-in manager is not enough here, and this is the one place where that matters.
  // The password this resets is not clock-in's — there is no such thing in this container. It is
  // the single hub login, the same one that opens deliveries, recruiting, timetracker and the ERP.
  // Upstream that distinction did not exist. Here it means a clock-in owner could have set a
  // temporary password for a deliveries ADMIN and then signed in as them.
  //
  // The hub already offers this at /api/reset-password, gated on role = 'admin'. Same gate.
  const { data: caller } = await ctx.supabase
    .schema("public")
    .from("profiles")
    .select("role")
    .eq("id", ctx.user.id)
    .maybeSingle();
  if (caller?.role !== "admin") {
    return { ok: false, message: "Only an administrator can reset a password — ask one to do it from Users on the hub." };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { ok: false, message: "Server is missing the admin key." };

  // Scope check: the target must be in the manager's company.
  const { data: target } = await ctx.supabase.from("profiles").select("id").eq("id", id).maybeSingle();
  if (!target) return { ok: false, message: "Employee not found." };

  const tempPassword = genPassword();
  const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: "PUT",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: tempPassword }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, message: data?.msg || data?.error_description || "Could not reset password." };
  }
  return { ok: true, tempPassword };
}

// deleteEmployee() was here and is deliberately gone.
//
// It called the Auth admin API to delete the user, on the reasoning that this cascades the profile
// and all their records — true in rtg-clock-in, where clock-in WAS the whole application. In this
// container `public.profiles` is the shared identity behind deliveries, recruiting, timetracker and
// the ERP, so a clock-in manager pressing 🗑️ would have erased someone from every one of them,
// along with their delivery history. The Spanish copy even promised it: "borra su acceso y todos
// sus registros".
//
// Nor could a safer version live here. Removing someone from clock-in alone means clearing
// their role, and 071's guard lets only a deliveries admin do that — access is granted and
// revoked from the hub (D-091), on purpose. What a clock-in manager legitimately needs is to stop
// counting someone's time, and setEmployeeActive() below already does exactly that, reversibly and
// without touching anyone else's app.
//
// Deleting the person from the company remains possible, in Users on the hub, where it is
// admin-only and written to the security log (/api/delete-user).

export async function setEmployeeActive(id: string, active: boolean) {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  const { error } = await ctx.supabase.from("profiles").update({ active }).eq("id", id);
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const };
}


/**
 * The person's job function: Office / Sales / Warehouse / Manager / Owner.
 *
 * Upstream this ONE control set both the position and the clock-in role it implies, because there
 * were two dropdowns and everyone confused them. That merge no longer holds here, for two reasons
 * (D-095):
 *
 *  - The role now lives in `public.profiles.timetracker_role` (084/087), and 071's guard lets only a deliveries
 *    admin change it. A clock-in owner picking "Manager" here would have hit "Only an admin can
 *    change clock-in access or role" — the write failing on the half nobody could see.
 *  - In the hub's Users dialog the clock-in role is its own select, two fields above this one, in
 *    the same shape every other module uses. Two controls writing the same column is the confusion
 *    upstream was avoiding, just pointed the other way.
 *
 * So this writes `position` and nothing else. `position` is a grouping label — the Coverage board
 * is the only screen that reads it — and it no longer decides what anyone may see, which is also
 * why it is no longer owner-only or forbidden on yourself.
 */
export async function setEmployeePosition(id: string, position: Position) {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  if (!POSITIONS.includes(position)) return { ok: false as const, message: "Invalid position." };
  const { error } = await ctx.supabase.from("profiles").update({ position }).eq("id", id);
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const };
}

/** Assign an employee/manager to a store (or clear it with null). */
export async function setEmployeeStore(id: string, storeId: string | null) {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  const { error } = await ctx.supabase.from("profiles").update({ store_id: storeId }).eq("id", id);
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const };
}

/** Mark a person as a Runner (drives a company vehicle + logs stops). Manager/owner. */
export async function setEmployeeRunner(id: string, isRunner: boolean) {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  const { error } = await ctx.supabase.from("profiles").update({ is_runner: isRunner }).eq("id", id);
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const };
}

/** Set the vehicle a runner is currently driving (or clear with null). Manager/owner. */
export async function setEmployeeVehicle(id: string, vehicleId: string | null) {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  const { error } = await ctx.supabase.from("profiles").update({ vehicle_id: vehicleId }).eq("id", id);
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const };
}
