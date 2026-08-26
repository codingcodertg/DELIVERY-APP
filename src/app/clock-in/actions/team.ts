"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { POSITIONS, roleForPosition, type Position } from "@/lib/clockin/positions";
import { currentAndNextPeriodDates } from "@/lib/clockin/schedule";
import { materializeForEmployee, clearFutureShifts } from "./schedule";

export type AddEmployeeResult =
  | { ok: true; tempPassword: string; email: string }
  | { ok: false; message: string };

function genPassword() {
  return `RTG${Math.floor(1000 + Math.random() * 9000)}!`;
}

async function managerCtx() {
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
  if (!me || (me.role !== "manager" && me.role !== "owner")) {
    return { ok: false as const, message: "Managers only." };
  }
  return { ok: true as const, supabase, user, companyId: me.company_id, role: me.role as string };
}

/**
 * Create a new employee: an auth user (via the GoTrue admin API with the
 * server-only service-role key) + a profile row scoped to the manager's company.
 * Returns a temporary password to hand off.
 */
export async function addEmployee(input: {
  name: string;
  email: string;
  role: "employee" | "manager";
  language: "en" | "es";
  storeId?: string | null;
  schedule?: string | null;
}): Promise<AddEmployeeResult> {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email) return { ok: false, message: "Name and email are required." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { ok: false, message: "Server is missing the admin key." };

  const tempPassword = genPassword();
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: tempPassword, email_confirm: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) {
    return {
      ok: false,
      message: data?.msg || data?.error_description || data?.error || "Could not create user (email may already exist).",
    };
  }

  // Profile insert via the manager's session — RLS allows managers to add to their company.
  const { error } = await ctx.supabase.from("profiles").insert({
    id: data.id,
    company_id: ctx.companyId,
    full_name: name,
    role: input.role,
    language: input.language,
    store_id: input.storeId || null,
    default_schedule: input.schedule || null,
  });
  if (error) return { ok: false, message: error.message };

  return { ok: true, tempPassword, email };
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

/** Permanently delete an employee (auth login + all their records). Manager/owner, not self. */
export async function deleteEmployee(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  if (id === ctx.user.id) return { ok: false, message: "You can't delete your own account." };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, message: "Server is missing the admin key." };
  const { data: target } = await ctx.supabase.from("profiles").select("id, company_id").eq("id", id).maybeSingle();
  if (!target || target.company_id !== ctx.companyId) return { ok: false, message: "Employee not found." };
  // Deleting the auth user cascades the profile and all their records.
  const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return { ok: false, message: "Could not delete this employee." };
  return { ok: true };
}

export async function setEmployeeActive(id: string, active: boolean) {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  const { error } = await ctx.supabase.from("profiles").update({ active }).eq("id", id);
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const };
}


/**
 * ONE control for "what is this person": Office / Sales / Warehouse / Manager /
 * Owner. There used to be two dropdowns (role + position) which confused
 * everyone. Now a single choice sets BOTH: the visible job function (position)
 * and the permission level (role) it implies.
 *
 *   office/sales/warehouse → role employee   (store crew)
 *   manager                → role manager    (can see the crew)
 *   owner                  → role owner       (can see all stores)
 *
 * Because this can change the ROLE — i.e. what someone is allowed to see — it is
 * OWNER-ONLY and can't be used on yourself (no self-demotion / self-promotion).
 */
export async function setEmployeePosition(id: string, position: Position) {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  if (ctx.role !== "owner") return { ok: false as const, message: "Only the owner can change this." };
  if (id === ctx.user.id) return { ok: false as const, message: "You can't change your own position." };
  if (!POSITIONS.includes(position)) return { ok: false as const, message: "Invalid position." };
  const role = roleForPosition(position);
  const { error } = await ctx.supabase.from("profiles").update({ position, role }).eq("id", id);
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
