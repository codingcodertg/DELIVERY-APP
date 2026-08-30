import type { AnySupabase } from "@/lib/clockin/supabase/types";
import { visibleStores } from "@/lib/clockin/scope";
import { payPeriodDates } from "@/lib/clockin/schedule";

// Server-side guards for manager/owner mutations. The screens already filter by
// store, but the server actions behind them must ALSO enforce it — otherwise a
// direct action/fetch call can reach another store's crew or a locked period.

export type Me = {
  role: string;
  company_id: string;
  store_id: string | null;
  /** Tiendas concedidas además de la propia (089). Vacío = solo la suya. */
  extra_store_ids?: string[] | null;
};

/**
 * ¿Puede este gerente actuar sobre esta persona?
 *   dueño (o gerente sin tienda)  → cualquiera de la empresa
 *   gerente con tienda            → su tienda **y las que se le hayan concedido** (089)
 *
 * Va de la mano de `visibleStores`: si aquí se olvidaran las tiendas extra, un gerente vería a
 * alguien en su lista y no podría tocarlo — el peor de los dos fallos, porque parece un error
 * de la app y no un permiso.
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
  const suyas = visibleStores(me.role, me.store_id, me.extra_store_ids);
  if (!suyas) return true;
  return !!emp.store_id && suyas.includes(emp.store_id as string);
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
