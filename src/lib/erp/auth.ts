import { cache } from "react";
import { createClient } from "@/lib/erp/supabase/server";
import type { User } from "@supabase/supabase-js";
import { canSeeCost, erpTier, type AppRole } from "@/lib/erp/domain/roles";
import type { UserRole } from "@/lib/types";

// Re-exported from the framework-free domain module (unit-tested there).
export { canSeeCost };
export type { AppRole };

export type SessionInfo = {
  user: User;
  /**
   * El nivel de esta persona **dentro del ERP**: `profiles.erp_role` (D-181), no el rol de
   * Entregas. Lo usan las ~20 guardas de coste, `hasCatalogAccess` y los `canEdit`/`isAdmin` de
   * las pantallas de producto y compras. Sin nivel asignado, `staff`.
   */
  role: AppRole;
  /**
   * El rol del HUB: `profiles.role`, sin el molde de `AppRole` (D-227).
   *
   * Son dos escalafones distintos y esta es la línea que lo dice. `role` decide autoridad dentro
   * del ERP; `hubRole` contesta preguntas del hub — hoy solo una, si hay selector de módulos al
   * que volver.
   *
   * Se expone con su tipo propio para no forzar un molde en cada sitio que quiera hacer una
   * pregunta de hub: un `as` oculta un cambio de tipo futuro y un campo con nombre no.
   */
  hubRole: UserRole;
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
    // profiles is the SHARED identity table in public — the erp-bound client would
    // otherwise look for erp.profiles, which does not exist.
    .schema("public")
    .from("profiles")
    .select("role, erp_role, full_name, module_access, recruiting_role, timetracker_role, store")
    .eq("id", user.id)
    .single();

  return {
    user,
    // ---------------------------------------------------------------------------
    // El rol del ERP sale de `erp_role`, NUNCA del rol de Entregas (D-228)
    // ---------------------------------------------------------------------------
    // Aquí ponía `profile?.role`, o sea el rol del HUB con otro molde. Consecuencia medida en
    // producción: una persona `manager` en Entregas y `staff` en el ERP entraba con autoridad de
    // manager — la pastilla del panel decía «manager · cost visible» y le abría las pantallas de
    // coste, compras y márgenes. D-181 creó el escalafón propio del ERP y la base ya lo usa
    // (`erp.current_app_role()` lee `erp_role`), pero esta línea nunca se enteró: `erp_role`
    // solo se escribía y nadie lo leía para decidir.
    //
    // **Falla cerrado a `staff`**, y eso es deliberado: sin nivel asignado, el mínimo. Caer al
    // rol de Entregas es exactamente el fallo que esto cierra, así que ese camino no existe.
    role: erpTier(profile),
    hubRole: (profile?.role as UserRole) ?? "sales",
    fullName: profile?.full_name ?? null,
    moduleAccess: (profile?.module_access as string[] | null) ?? null,
    recruitingRole: (profile?.recruiting_role as string | null) ?? null,
    timetrackerRole: (profile?.timetracker_role as string | null) ?? null,
    store: (profile?.store as string | null) ?? null,
  };
});
