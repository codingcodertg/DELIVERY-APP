// Framework-free module-access helpers (ADR 0010). No React / Next / Supabase imports, matching the
// rest of lib/domain (ADR 0006) so this stays unit-testable in isolation.
//
// Three merged modules share this deploy alongside the product catalog. Which ones a person sees is
// NOT their catalog role — a driver has no catalog duties and a buyer has no timesheet — so it is
// carried on profiles separately: `module_access` (text[]) plus the per-module role columns
// `recruiting_role` / `timetracker_role` (v4_69).

export const MODULES = ["deliveries", "recruiting", "timetracker"] as const;
export type ModuleKey = (typeof MODULES)[number];

export const MODULE_LABEL: Record<ModuleKey, string> = {
  deliveries: "Deliveries",
  recruiting: "HR Management", // D-145; este mapa duplica MODULES de lib/constants.ts (B-4)
  timetracker: "Time Tracker",
};

export interface ModuleProfile {
  moduleAccess?: string[] | null;
  recruitingRole?: string | null;
  timetrackerRole?: string | null;
}

/**
 * Which modules this person can open.
 *
 * Deliveries is granted by the catalog role itself rather than by `module_access`: every role that
 * came over from deliveries-app (driver, warehouse, logistics, sales, accounting) exists *because*
 * of that app, and the two office roles it shares with the catalog (admin, manager) ran it too. A
 * separate opt-in list would have to be populated for all 32 migrated staff to restore access they
 * already had — a migration that can silently lock people out is worse than one that reads the role.
 *
 * Recruiting and timetracker stay opt-in via their own role column being non-null, which is exactly
 * what the source app's has_recruiting_access() / has_timetracker_access() check (ported in v4_74),
 * so UI visibility and RLS agree instead of drifting apart.
 */
export function accessibleModules(role: string | null | undefined, p: ModuleProfile): ModuleKey[] {
  const out: ModuleKey[] = [];
  const access = p.moduleAccess ?? [];
  const deliveriesRoles = [
    "admin",
    "manager",
    "driver",
    "warehouse",
    "logistics",
    "sales",
    "accounting",
  ];
  if (role && deliveriesRoles.includes(role)) out.push("deliveries");
  if (p.recruitingRole || access.includes("recruiting")) out.push("recruiting");
  if (p.timetrackerRole || access.includes("timetracker")) out.push("timetracker");
  return out;
}

/**
 * Whether this person sees the catalog (the original ERP) at all.
 *
 * `staff` is the catalog's own baseline role and the three delivery-floor roles are not: a driver or
 * warehouse hand has no reason to browse the product master, and showing it to them would be a new
 * grant this merge never intended to make. Kept as an allow-list for the reason ADR 0010 already
 * records — a deny-list ("everyone except driver") silently admits whatever role is added next.
 */
export function hasCatalogAccess(role: string | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "staff";
}
