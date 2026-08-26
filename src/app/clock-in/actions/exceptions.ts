"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { canManageEmployee, type Me } from "@/lib/clockin/mgrScope";

export async function resolveException(id: string): Promise<{ ok: boolean; message?: string }> {
  if (!isSupabaseConfigured) return { ok: false, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const { data: me } = await supabase.from("profiles").select("role, company_id, store_id").eq("id", user.id).single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return { ok: false, message: "Managers only." };

  // Only resolve exceptions for employees in the manager's store (owner: any).
  const { data: ex } = await supabase.from("exceptions").select("employee_id").eq("id", id).maybeSingle();
  if (!ex) return { ok: false, message: "Exception not found." };
  const meScope: Me = { role: me.role, company_id: me.company_id, store_id: (me.store_id as string) ?? null };
  if (!(await canManageEmployee(supabase, meScope, ex.employee_id))) {
    return { ok: false, message: "That employee isn't in your store." };
  }

  const { error } = await supabase.from("exceptions").update({ resolved: true }).eq("id", id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
