"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { pushToManagers, pushToUser } from "@/lib/clockin/notify";

export type TimeOffResult = { ok: true } | { ok: false; message: string };

const TYPES = ["vacation", "sick", "schedule_change", "shift_swap"];

async function authed() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, company_id, full_name")
    .eq("id", user.id)
    .single();
  if (!profile) return { ok: false as const, message: "No profile." };
  return { ok: true as const, supabase, user, profile };
}

export async function submitTimeOff(input: {
  type: string;
  startDate: string;
  endDate: string;
  note?: string;
}): Promise<TimeOffResult> {
  const ctx = await authed();
  if (!ctx.ok) return ctx;
  if (!TYPES.includes(input.type)) return { ok: false, message: "Invalid type." };
  if (!input.startDate || !input.endDate) return { ok: false, message: "Pick start and end dates." };
  if (input.endDate < input.startDate) return { ok: false, message: "End date is before start date." };

  const { error } = await ctx.supabase.from("time_off_requests").insert({
    company_id: ctx.profile.company_id,
    employee_id: ctx.user.id,
    type: input.type,
    start_date: input.startDate,
    end_date: input.endDate,
    note: input.note ?? null,
  });
  if (error) return { ok: false, message: error.message };
  // Notify the managers that a request came in.
  await pushToManagers(ctx.profile.company_id, "mgr_timeoff_request", { name: ctx.profile.full_name }, "/clock-in/time-off");
  return { ok: true };
}

export async function reviewTimeOff(input: {
  id: string;
  decision: "approved" | "denied";
  comment?: string;
}): Promise<TimeOffResult> {
  const ctx = await authed();
  if (!ctx.ok) return ctx;
  if (ctx.profile.role !== "manager" && ctx.profile.role !== "owner") {
    return { ok: false, message: "Managers only." };
  }
  const { data: updated, error } = await ctx.supabase
    .from("time_off_requests")
    .update({
      status: input.decision,
      manager_comment: input.comment ?? null,
      reviewed_by: ctx.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select("employee_id, company_id")
    .single();
  if (error) return { ok: false, message: error.message };
  // Notify the employee of the decision.
  if (updated) {
    await pushToUser(
      updated.employee_id,
      updated.company_id,
      input.decision === "approved" ? "timeoff_approved" : "timeoff_denied",
    );
  }
  return { ok: true };
}
