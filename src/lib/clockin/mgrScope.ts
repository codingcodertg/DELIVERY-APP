import type { AnySupabase } from "@/lib/clockin/supabase/types";
import { payPeriodDates } from "@/lib/clockin/schedule";

// Server-side guards for manager/owner mutations. The screens already filter by
// store, but the server actions behind them must ALSO enforce it — otherwise a
// direct action/fetch call can reach another store's crew or a locked period.

export type Me = { role: string; company_id: string; store_id: string | null };

/**
 * May this manager act on this employee?
 *   owner (or a manager with no home store) → anyone in the company
 *   a store-assigned manager                → only their own store's crew
 */
export async function canManageEmployee(
  supabase: AnySupabase,
  me: Me,
  employeeId: string,
): Promise<boolean> {
  const { data: emp } = await supabase
    .from("profiles")
    .select("company_id, store_id")
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp || emp.company_id !== me.company_id) return false;
  if (me.role === "owner" || !me.store_id) return true;
  return emp.store_id === me.store_id;
}

/** Pay-period start (Friday, YYYY-MM-DD Central) that a clock-in instant falls in. */
export function periodStartOf(clockInAtIso: string): string {
  return payPeriodDates(new Date(clockInAtIso))[0];
}

/** Has the owner signed off (locked) this company's pay period? */
export async function isPeriodLocked(
  supabase: AnySupabase,
  companyId: string,
  periodStart: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("pay_period_signoffs")
    .select("period_start")
    .eq("company_id", companyId)
    .eq("period_start", periodStart)
    .maybeSingle();
  return !!data;
}
