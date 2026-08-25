import { cache } from "react";
import { createClient } from "@/lib/erp/supabase/server";
import type { User } from "@supabase/supabase-js";
import { canSeeCost, type AppRole } from "@/lib/erp/domain/roles";

// Re-exported from the framework-free domain module (unit-tested there).
export { canSeeCost };
export type { AppRole };

export type SessionInfo = {
  user: User;
  role: AppRole;
  fullName: string | null;
  // Merged-module access (ADR 0010, v4_69). Null/empty for a catalog-only account, which is the
  // correct default — these are opt-in grants, not something every profile carries.
  moduleAccess: string[] | null;
  recruitingRole: string | null;
  timetrackerRole: string | null;
  /**
   * Branch this person physically works at (v4_76). The warehouse queue pins a worker to it.
   * Distinct from the catalog's user_store_assignments, which grants "may order for" — see the
   * migration header before reaching for either.
   */
  store: string | null;
};

/**
 * Resolve the signed-in user + their app role (from profiles). Null if not signed in.
 * Wrapped in React cache() so it dedupes across a single request (header + page).
 */
export const getSessionInfo = cache(async (): Promise<SessionInfo | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, module_access, recruiting_role, timetracker_role, store")
    .eq("id", user.id)
    .single();

  return {
    user,
    role: (profile?.role as AppRole) ?? "staff",
    fullName: profile?.full_name ?? null,
    moduleAccess: (profile?.module_access as string[] | null) ?? null,
    recruitingRole: (profile?.recruiting_role as string | null) ?? null,
    timetrackerRole: (profile?.timetracker_role as string | null) ?? null,
    store: (profile?.store as string | null) ?? null,
  };
});
