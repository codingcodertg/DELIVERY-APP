// The hub registry — what a person can open from the landing page. Framework-free (ADR 0006).
//
// Ported from the deliveries app's own hub (ADR 0010) with one structural change the merge forces:
// there, Deliveries was the implicit always-present app and the ERP did not exist. Here the ERP
// CATALOG is a peer app alongside the three merged ones, so nothing is implicit — every card is
// decided by the same rule.
//
// Two different kinds of thing live here, deliberately kept apart:
//   APPS  — something a person is granted (a module role / module_access), opt-in per person.
//   TOOLS — something that comes with a ROLE. Nobody "grants" you Users; you have it because you
//           are an admin. That is why tools use a predicate rather than a membership list.
// A fourth app later is one entry in APPS, not a change to the hub page or the sidebar.

import { accessibleModules, hasCatalogAccess, type ModuleKey } from "./modules";

export interface HubApp {
  key: ModuleKey | "catalog";
  href: string;
  emoji: string;
  label: string;
  desc: string;
}

export interface HubTool {
  key: string;
  href: string;
  emoji: string;
  label: string;
  desc: string;
  visible: (role: string | null | undefined) => boolean;
}

const CATALOG_APP: HubApp = {
  key: "catalog",
  href: "/catalog",
  emoji: "🧱",
  label: "Product Portal",
  desc: "Catalog, purchasing, inventory",
};

const MODULE_APPS: Record<ModuleKey, HubApp> = {
  deliveries: {
    key: "deliveries",
    href: "/deliveries",
    emoji: "📦",
    label: "Deliveries",
    desc: "Orders, routes and drivers",
  },
  recruiting: {
    key: "recruiting",
    href: "/recruiting",
    emoji: "🧑‍💼",
    label: "Recruiting",
    desc: "Candidates and interviews",
  },
  timetracker: {
    key: "timetracker",
    href: "/timetracker",
    emoji: "⏱️",
    label: "Time Tracker",
    desc: "Time tracking and payroll",
  },
};

export const HUB_TOOLS: HubTool[] = [
  {
    key: "users",
    href: "/hub/users",
    emoji: "🛡",
    label: "Users",
    desc: "Manage team access across apps",
    visible: (role) => role === "admin",
  },
];

export interface HubProfile {
  moduleAccess?: string[] | null;
  recruitingRole?: string | null;
  timetrackerRole?: string | null;
}

/**
 * Every app this person can open, catalog first.
 *
 * Catalog leads because it is the system that was already here and the one most staff use; the
 * merged modules follow in a fixed order so the hub does not reshuffle between visits.
 */
export function accessibleApps(role: string | null | undefined, p: HubProfile): HubApp[] {
  const apps: HubApp[] = [];
  if (hasCatalogAccess(role)) apps.push(CATALOG_APP);
  for (const key of accessibleModules(role, p)) apps.push(MODULE_APPS[key]);
  return apps;
}

/** The hub tools visible to this role. */
export function visibleTools(role: string | null | undefined): HubTool[] {
  return HUB_TOOLS.filter((t) => t.visible(role));
}

/**
 * Where to send someone who lands on the hub.
 *
 * One app and no tools means the hub is a door with nothing to choose — go straight through to that
 * app instead of making them click a single card every time. With more than one app, or with a tool
 * worth showing, the hub earns its place.
 */
export function hubLandingRoute(role: string | null | undefined, p: HubProfile): string | null {
  const apps = accessibleApps(role, p);
  const tools = visibleTools(role);
  if (apps.length === 1 && tools.length === 0) return apps[0].href;
  return null;
}
