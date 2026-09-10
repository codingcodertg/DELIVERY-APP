// Framework-free role helpers. The DB is the real cost gate (#29); this mirrors
// public.can_see_cost() for UI hints and is unit-tested in isolation.

// Mirrors the public.app_role enum. The last five came in with the deliveries/recruiting/timetracker
// merge (v4_68, ADR 0010) — the type was still three-valued after the enum was extended, which meant
// TypeScript believed a driver session was impossible while the database could produce one.
export const APP_ROLES = [
  "admin",
  "manager",
  "staff",
  "driver",
  "warehouse",
  "logistics",
  "sales",
  "accounting",
] as const;

// Derived from the list above rather than declared separately, so a role can never exist in the
// type and be missing from the picker that assigns it — which is precisely how the enum and the
// type drifted apart after v4_68.
export type AppRole = (typeof APP_ROLES)[number];

/**
 * Cost/margin/GM are visible only to admin/manager. Fails closed for null/unknown.
 *
 * Deliberately an allow-list, not `role !== "staff"`: with eight roles in the enum, a deny-list
 * would have silently granted cost visibility to every delivery-floor role the merge added. That
 * exact bug shipped in 20 page guards and is written up in ADR 0010.
 */
export function canSeeCost(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

/**
 * Los tres niveles que el ERP reconoce, y los únicos que la base acepta en `profiles.erp_role`
 * (`profiles_erp_role_known`, migración 101).
 */
export const ERP_TIERS = ["staff", "manager", "admin"] as const;

/**
 * El nivel de una persona DENTRO del ERP, a partir de su perfil (D-228).
 *
 * Existe porque durante un año el ERP decidió con el rol de **Entregas**: `getSessionInfo` hacía
 * `profile.role as AppRole`, así que un `manager` de Entregas entraba al ERP como manager aunque
 * su `erp_role` fuera `staff`. D-181 creó el escalafón propio y la base ya lo usa
 * (`erp.current_app_role()` lee `erp_role`); el cliente no se había enterado.
 *
 * **Falla cerrado, y con lista blanca.** Sin valor, o con uno que no está en `ERP_TIERS`, el
 * resultado es `staff`. Un `as AppRole` —lo que había— acepta cualquier cadena que haya en la
 * columna y la convierte en autoridad; aquí un valor inesperado no concede nada. Es el mismo
 * criterio de `canSeeCost`: lista blanca y no lista negra, porque con ocho roles en el enum una
 * lista negra concede por omisión.
 */
export function erpTier(perfil: { erp_role?: string | null } | null | undefined): AppRole {
  const nivel = perfil?.erp_role;
  return (ERP_TIERS as readonly string[]).includes(nivel ?? "") ? (nivel as AppRole) : "staff";
}
