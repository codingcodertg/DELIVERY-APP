import { cache } from "react";
import { createClient } from "@/lib/erp/supabase/server";
import type { User } from "@supabase/supabase-js";
import { canSeeCost, erpTier, type AppRole } from "@/lib/erp/domain/roles";
import type { UserRole } from "@/lib/types";
import { PerfilNoLeido, esSinFila, referenciaDeFallo } from "@/lib/profile-read";

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

  const { data: profile, error } = await supabase
    // profiles is the SHARED identity table in public — the erp-bound client would
    // otherwise look for erp.profiles, which does not exist.
    .schema("public")
    .from("profiles")
    .select("role, erp_role, full_name, module_access, recruiting_role, timetracker_role, store")
    .eq("id", user.id)
    .single();

  // ---------------------------------------------------------------------------
  // Un fallo de lectura NO se parece a un rol (D-NEXT)
  // ---------------------------------------------------------------------------
  // Aqui se descartaba el `error` y se seguia con los valores por defecto de abajo:
  // `erpTier(null)` da `staff` y `hubRole` daba `sales`. O sea que cuando la consulta
  // fallaba —una columna que no existe, una politica, la red— el ERP decidia permisos
  // con un perfil que nunca leyo, y nadie se enteraba. Falla cerrado, asi que el dano
  // es «ves menos de lo que te toca», pero es mudo: la persona cree que ese es su rol.
  //
  // Es el mismo `const { data } = …` que en los layouts producia el bucle de D-234. La
  // regla es la misma y la consecuencia no: **descartar el error no falla, sigue con
  // datos incompletos**, y lo que pasa despues lo decide el camino ya escrito para el
  // caso nulo. Alli era `redirect`; aqui, un rol.
  //
  // `single()` convierte «no hay fila» en un error (PGRST116), y eso NO es un fallo de
  // lectura: es la sesion degradada de D-081. Se devuelve null, que es lo que las
  // paginas ya traducen a «vuelve a entrar».
  if (error && !esSinFila(error)) {
    // Al log del servidor, entero: la frontera de error del ERP no puede ensenarlo
    // (Next borra el mensaje de un error de servidor y solo deja su digest).
    console.error(`[erp] perfil ilegible ${referenciaDeFallo(error)}:`, error.message, error.code ?? "");
    throw new PerfilNoLeido(error);
  }
  if (!profile) return null;

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
    // Los respaldos de aqui abajo ya no tapan una lectura fallida —si la hubo, esto no
    // se ejecuta—: son para una COLUMNA nula en una fila que si se leyo.
    hubRole: (profile.role as UserRole) ?? "sales",
    fullName: profile.full_name ?? null,
    moduleAccess: (profile.module_access as string[] | null) ?? null,
    recruitingRole: (profile.recruiting_role as string | null) ?? null,
    timetrackerRole: (profile.timetracker_role as string | null) ?? null,
    store: (profile.store as string | null) ?? null,
  };
});
