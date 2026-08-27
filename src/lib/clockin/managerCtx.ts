import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import type { Me } from "@/lib/clockin/mgrScope";

/**
 * Who is allowed to configure clock-in, and on whose behalf.
 *
 * This used to be two identical private copies, one in actions/team.ts and one in
 * actions/schedule.ts, each checking `role in (manager, owner)` against clock-in's own tier. That
 * was right when clock-in was the whole application. In this container it is wrong twice over:
 *
 *  1. **A hub admin was locked out of a module they administer.** Every other module's layout lets
 *     an admin in (`role === "admin" || …`), and `public.has_clockin_access()` says the same. These
 *     actions did not, so with the crew screens moved into Users on the hub (D-095) an admin could
 *     see the controls and every save would answer "Managers only."
 *
 *  2. **Asking clockin.profiles about an admin answers the wrong question.** That view is an INNER
 *     JOIN onto clockin.employee_settings (077), so someone with no clock-in row is not "denied",
 *     they are *absent* — `.single()` errors and the ctx reads it as a failed permission check. So
 *     the hub identity is consulted first, in `public`, where an admin always exists.
 *
 * A hub admin is treated as an owner INSIDE clock-in. That is the strongest tier and it is
 * deliberate: `setEmployeePosition` is owner-only because it changes what someone may see, and the
 * person configuring roles from the hub is exactly who should hold that. It does not travel the
 * other way — a clock-in owner gains nothing in the hub.
 */
export type ClockinCtx =
  | { ok: false; message: string }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      user: { id: string };
      companyId: string;
      role: string;
      storeId: string | null;
      /** Scope object for canManageEmployee() / isPeriodLocked(). */
      me: Me;
      /** True when the caller got in as a deliveries admin rather than a clock-in tier. */
      viaHubAdmin: boolean;
    };

export async function clockinManagerCtx(): Promise<ClockinCtx> {
  if (!isSupabaseConfigured) return { ok: false, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  // The shared identity first — see (2) above.
  const { data: hub } = await supabase
    .schema("public")
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const viaHubAdmin = hub?.role === "admin";

  // maybeSingle, not single: no clock-in row is a normal state here, not an error.
  const { data: mine } = await supabase
    .from("profiles")
    .select("role, company_id, store_id")
    .eq("id", user.id)
    .maybeSingle();

  const role = (mine?.role as string | undefined) ?? (viaHubAdmin ? "owner" : undefined);
  if (!viaHubAdmin && role !== "manager" && role !== "owner") {
    return { ok: false, message: "Managers only." };
  }

  let companyId = (mine?.company_id as string | undefined) ?? null;
  if (!companyId) {
    // An admin configuring from the hub may have no clock-in row of their own. One company is
    // unambiguous; several would not be, and guessing would scope them to the wrong crew.
    const { data: companies } = await supabase.from("companies").select("id").limit(2);
    if (companies?.length === 1) companyId = companies[0].id as string;
  }
  if (!companyId) {
    return { ok: false, message: "No clock-in company for this account — ask an owner to set one up." };
  }

  const storeId = (mine?.store_id as string | undefined) ?? null;
  const effectiveRole = viaHubAdmin ? "owner" : (role as string);
  // store_id null means "every store", which is what an owner gets anyway.
  const me: Me = { role: effectiveRole, company_id: companyId, store_id: viaHubAdmin ? null : storeId };

  return { ok: true, supabase, user, companyId, role: effectiveRole, storeId: me.store_id, me, viaHubAdmin };
}
