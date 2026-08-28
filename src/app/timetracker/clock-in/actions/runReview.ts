"use server";

import { revalidatePath } from "next/cache";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { canManageEmployee, type Me } from "@/lib/clockin/mgrScope";

type Result = { ok: true } | { ok: false; message: string };

/** Manager/owner marks (or un-marks) a runner's pay-week of trips as reviewed. */
export async function setRunReviewed(input: {
  employeeId: string;
  periodStart: string; // YYYY-MM-DD (Friday of the Fri–Thu week)
  reviewed: boolean;
}): Promise<Result> {
  if (!isSupabaseConfigured) return { ok: false, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { data: me } = await supabase.from("profiles").select("role, company_id, store_id").eq("id", user.id).single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return { ok: false, message: "Managers only." };
  const meCtx: Me = { role: me.role, company_id: me.company_id, store_id: (me.store_id as string) ?? null };
  if (!(await canManageEmployee(supabase, meCtx, input.employeeId))) {
    return { ok: false, message: "That employee isn't in your store." };
  }

  if (input.reviewed) {
    const { error } = await supabase.from("run_reviews").upsert(
      {
        company_id: me.company_id,
        employee_id: input.employeeId,
        period_start: input.periodStart,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,period_start" },
    );
    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await supabase
      .from("run_reviews")
      .delete()
      .eq("employee_id", input.employeeId)
      .eq("period_start", input.periodStart);
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath("/timetracker/clock-in/coverage"); // runs live under Today's Crew now
  return { ok: true };
}
