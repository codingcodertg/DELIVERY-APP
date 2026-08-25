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
