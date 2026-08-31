import type { Stage, UserRole } from "./types";
import type { Lang } from "./prefs";

// App version moved to src/lib/app-versions.ts (D-087) — one number per app
// (deliveries/recruiting/timetracker) instead of a single global constant.

// Feature flag: auto-cancel orders 2+ days late without reprogramming (runs on
// the board for admin/office/logistics/accounting). OFF for now — flip to true
// to activate the automation.
export const AUTO_CANCEL_LATE_ENABLED = false;

// Default recipient for the in-app Help button, used when Settings.help_email
// is unset. Admins can override it in Settings → app configuration.
// Set to careers@rdztilegroup.net because until the send.rdztilegroup.net
// sending domain is DNS-verified, Resend only delivers to the account's own
// address (careers@). Change this (and remove the NOTIFY_FROM_EMAIL override)
// to andresugarte000@gmail.com once the domain is verified.
export const DEFAULT_HELP_EMAIL = "careers@rdztilegroup.net";

// ---- Workflow stages (source of truth for labels, colors, order) ----------
export interface StageInfo {
  key: Stage;
  label: string;
  color: string;
  // Which board group a stage belongs to (for filtering chips).
  group: "sales" | "approval" | "warehouse" | "done";
}

export const STAGES: StageInfo[] = [
  { key: "draft",      label: "Draft",          color: "#6b7686", group: "sales" },
  { key: "pending",    label: "Pending Approval", color: "#e9a13b", group: "approval" },
  { key: "rejected",   label: "Rejected",       color: "#d64545", group: "approval" },
  { key: "approved",   label: "Programmed",     color: "#2456c9", group: "warehouse" },
  { key: "fulfilling", label: "Preparing",      color: "#7c4dbc", group: "warehouse" },
  { key: "ready",      label: "Ready",          color: "#0f8a8a", group: "warehouse" },
  { key: "picked_up",  label: "Picked Up",      color: "#d1782e", group: "warehouse" },
  { key: "delivered",  label: "Delivered",      color: "#1f9d61", group: "done" },
  { key: "canceled",   label: "Canceled",       color: "#9aa3b0", group: "done" },
];

export function stageInfo(key: string): StageInfo {
  return STAGES.find((s) => s.key === key) ?? STAGES[0];
}

// Which stage filter chips each role sees on the Orders page, in display order.
// The "All" chip is appended after these by the page. Roles not listed here
// (admin, logistics) get every stage in the canonical STAGES order.
export const ROLE_FILTER_STAGES: Partial<Record<UserRole, Stage[]>> = {
  warehouse: ["approved", "ready", "fulfilling", "picked_up", "delivered"],
  sales:     ["pending", "draft", "rejected", "approved", "fulfilling", "ready", "picked_up", "delivered", "canceled"],
  manager:   ["pending", "draft", "rejected", "approved", "fulfilling", "ready", "picked_up", "delivered", "canceled"],
  accounting: ["pending", "draft", "rejected", "approved", "fulfilling", "ready", "picked_up", "delivered", "canceled"],
  driver:    ["ready", "picked_up", "delivered", "pending", "fulfilling"],
};

export function filterStagesFor(role: UserRole): Stage[] {
  return ROLE_FILTER_STAGES[role] ?? STAGES.map((s) => s.key);
}

// Spanish stage labels + a language-aware lookup used across the UI.
export const STAGE_ES: Record<Stage, string> = {
  draft: "Borrador",
  pending: "Pendiente",
  rejected: "Rechazado",
  approved: "Programado",
  fulfilling: "Preparando",
  ready: "Listo",
  picked_up: "Recogido",
  delivered: "Entregado",
  canceled: "Cancelado",
};

export function stageLabel(key: string, lang: Lang): string {
  const info = stageInfo(key);
  return lang === "es" ? STAGE_ES[info.key] ?? info.label : info.label;
}

// ---- Navigation tabs ------------------------------------------------------
// `roles` = who sees the tab by default. `cap` = the capability that also
// unlocks it, so an admin can grant one person access without changing role.
// `group: "general"` folds the tab into the "General" dropdown instead of
// giving it its own slot — these are the reference/back-office screens, kept
// out of the way of the day-to-day work tabs.
export const TABS: { id: string; label: string; label_es: string; href: string; roles?: UserRole[]; cap?: Capability; group?: "general" }[] = [
  // Warehouse works entirely inside its own queue — it doesn't get the
  // general Orders board, dashboard, accounts, or the driver view.
  // Driver doesn't get the Orders board either — they work entirely from
  // their own Driver view, which has its own "+ New order" button.
  { id: "board",     label: "📋 Orders",    label_es: "📋 Órdenes",   href: "/", roles: ["admin", "manager", "sales", "logistics", "accounting"] },
  { id: "dashboard", label: "📊 Dashboard", label_es: "📊 Panel",     href: "/dashboard", roles: ["manager", "admin"], cap: "dashboard" },
  { id: "accounts",  label: "🏢 Accounts",  label_es: "🏢 Cuentas",    href: "/accounts", roles: ["admin", "manager"], group: "general" },
  { id: "map",       label: "🗺 Map",       label_es: "🗺 Mapa",       href: "/map", roles: ["admin", "manager", "sales", "logistics"] },
  { id: "market",    label: "🏪 Market",    label_es: "🏪 Mercado",    href: "/market", roles: ["admin"], group: "general" },
  { id: "warehouse", label: "🏭 Warehouse", label_es: "🏭 Almacén",    href: "/warehouse", roles: ["warehouse", "admin"], cap: "fulfill" },
  { id: "driver",    label: "🚚 Driver",    label_es: "🚚 Chofer",     href: "/driver", roles: ["driver", "admin"], cap: "deliver" },
  // The driver's read-only view of the route logistics planned: the day in
  // sequence, grouped into the same truckloads, with the next stop up front.
  // Driver-only by default — NOT "admin" too, unlike most tabs. Admin's own
  // role capabilities already include "deliver" (so the /my-route page
  // itself still opens for an admin who navigates there directly), but that
  // alone shouldn't surface a chofer-specific tab in an office admin's own
  // bar — same principle the comment on visibleTabs below already states for
  // warehouse and the Driver tab. Reachable by anyone else only via an
  // explicit extra "deliver" grant (UserDialog), same as Driver itself.
  { id: "myroute",   label: "🧭 My route",  label_es: "🧭 Mi ruta",    href: "/my-route", roles: ["driver"], cap: "deliver" },
  // Logistics works entirely inside its own route-planning queue, same as
  // Warehouse/Driver — it doesn't get the general Orders board or dashboard.
  { id: "routes",    label: "🧭 Routes Manager", label_es: "🧭 Gestor de Rutas", href: "/routes", roles: ["logistics", "admin"], cap: "route_plan" },
  { id: "data",      label: "🗂 Data",      label_es: "🗂 Datos",      href: "/data", roles: ["admin"], cap: "settings", group: "general" },
  { id: "audit",     label: "🧾 Audit",     label_es: "🧾 Auditoría",  href: "/audit", roles: ["admin", "manager"], group: "general" },
  // Settings is reached from the account view (click your name → Open settings)
  // rather than a nav tab. Users is reached through the hub (/home) now, not
  // a tab here at all — see D-056 and HUB_TOOLS below.
  // Personal work summary — not shown to sales/manager (redundant with their
  // Orders default view) or warehouse (outside its restricted nav).
  { id: "summary",   label: "📈 Summary",   label_es: "📈 Resumen",    href: "/summary", roles: ["admin"], group: "general" },
  // After-the-fact view of where a truck actually went. Dispatch-side only —
  // it is a review tool, not something a driver needs mid-route.
  { id: "track",     label: "🛣 Track",     label_es: "🛣 Recorrido",  href: "/track", roles: ["admin", "manager", "logistics"], group: "general" },
  // Account is reached by clicking your own name/avatar in the top bar (see
  // TopBar) rather than a nav tab.
];

// ---- Role metadata --------------------------------------------------------
export const ROLE_INFO: Record<UserRole, { label: string; label_es: string; color: string; desc: string; desc_es: string }> = {
  admin:     { label: "Admin",          label_es: "Administrador",     color: "var(--red)",    desc: "Full access + manage users",               desc_es: "Acceso total + gestión de usuarios" },
  manager:   { label: "Office Manager", label_es: "Gerente de Oficina", color: "var(--purple)", desc: "Approves & rejects submitted orders",      desc_es: "Aprueba y rechaza órdenes enviadas" },
  sales:     { label: "Salesperson",    label_es: "Vendedor",          color: "var(--accent)", desc: "Creates orders and submits for approval",  desc_es: "Crea órdenes y las envía a aprobación" },
  warehouse: { label: "Warehouse",      label_es: "Almacén",           color: "var(--teal)",   desc: "Prepares approved orders",                 desc_es: "Prepara las órdenes aprobadas" },
  driver:    { label: "Driver",         label_es: "Chofer",            color: "var(--amber)",  desc: "Delivers orders and can log new ones",     desc_es: "Entrega órdenes y puede registrar nuevas" },
  logistics: { label: "Logistics Manager", label_es: "Gerente de Logística", color: "var(--green)", desc: "Assigns and optimizes driver routes",  desc_es: "Asigna y optimiza las rutas de los choferes" },
  accounting: { label: "Accounting",     label_es: "Contabilidad",      color: "var(--ink-soft)", desc: "Reviews and approves; doesn't create orders", desc_es: "Revisa y aprueba; no crea órdenes" },
};

export function roleLabel(role: UserRole, lang: Lang): string {
  return lang === "es" ? ROLE_INFO[role].label_es : ROLE_INFO[role].label;
}

/** The landing page a role works from — where the admin "view as" switcher
 * jumps to so the preview lands on that role's actual view. */
export function roleHome(role: UserRole): string {
  switch (role) {
    case "warehouse": return "/warehouse";
    case "driver": return "/driver";
    case "logistics": return "/routes";
    default: return "/"; // admin / manager / sales work from the Orders board
  }
}

/** Where someone lands after login. Almost always the same as `roleHome` —
 * the one exception is a person with access to 2+ modules (deliveries plus
 * something else, e.g. recruiting), who gets the module selector instead.
 *
 * A driver ALWAYS goes straight to `/driver`, full stop — never the
 * selector, regardless of what `module_access` says. Driving is their whole
 * job; nothing about a module grant should ever put a choice in front of
 * them that isn't on their route. (See D-050/D-051.)
 */
export function landingRoute(me: { role: UserRole; module_access?: string[] | null }): string {
  const granted = normalizeModules(me.module_access);
  // Un chofer con Entregas va siempre a su ruta, sin pasar por el selector (D-050/051).
  // Si NO tiene Entregas, la ruta no existe para él y la condición de abajo decide.
  if (me.role === "driver" && granted.includes("deliveries")) return "/driver";
  if (granted.length > 1) return "/home";
  // Un solo módulo: directo a él. Ya no se da por hecho que ese módulo sea Entregas
  // (D-100) — alguien que solo ficha entra a fichar, no a un tablero de pedidos que
  // la base le va a devolver vacío.
  if (granted.length === 1) {
    if (granted[0] === "deliveries") return roleHome(me.role);
    const m = MODULES.find((x) => x.key === granted[0]);
    if (m) return m.href;
  }
  // Ninguno. Antes no podía pasar, porque Entregas se daba por sentada.
  return "/no-access";
}

export const ROLE_ORDER: UserRole[] = ["admin", "manager", "accounting", "logistics", "sales", "warehouse", "driver"];

// ---- Modules (D-050/D-053) --------------------------------------------------
// The container app's own modules besides deliveries itself. "deliveries" is
// implicit for everyone (see landingRoute above) and never appears in
// module_access — this list is only the OTHER modules an identity can be
// granted. Shared by HomeSelector (which module cards to offer) and
// UserDialog (which module toggles an admin can grant) so both read the same
// emoji/label/description — a third module only needs an entry here.
export interface ModuleInfo { key: string; href: string; emoji: string; label_en: string; label_es: string; desc_en: string; desc_es: string }
// Recruiting's own role tiers (admin|manager|recruiter — see
// src/lib/recruiting/constants.ts ROLE_INFO), relabeled here bilingually.
// Recruiting's copy is English-only; UserDialog is bilingual throughout, so
// this mirrors it rather than importing it half-translated.
export const RECRUITING_ROLE_LABELS: Record<string, { en: string; es: string }> = {
  admin: { en: "Admin", es: "Administrador" },
  manager: { en: "Office Manager", es: "Gerente de Oficina" },
  recruiter: { en: "Recruiter", es: "Reclutador" },
};

// Timetracker's own role tiers (admin|employee — see supabase/migrations/
// 058_timetracker_access.sql). Same bilingual-relabel treatment as
// RECRUITING_ROLE_LABELS above, for the same reason (D-064).
// Clock-in's own tiers (employee|manager|owner — see supabase/migrations/
// 071_clockin_access.sql). Same bilingual-relabel treatment as the two below.
export const CLOCKIN_ROLE_LABELS: Record<string, { en: string; es: string }> = {
  owner: { en: "Owner", es: "Dueño" },
  manager: { en: "Manager", es: "Gerente" },
  employee: { en: "Employee", es: "Empleado" },
};

// Tres niveles desde D-127. El intermedio no existía y por eso el acotado por tienda nunca
// llegaba a aplicarse: `clockin.profiles` solo emitía owner o employee.
export const TIMETRACKER_ROLE_LABELS: Record<string, { en: string; es: string }> = {
  admin: { en: "Admin — everything", es: "Administrador — todo" },
  manager: { en: "Store manager — their stores", es: "Gerente de tienda — sus tiendas" },
  employee: { en: "Employee — only themselves", es: "Empleado — solo lo suyo" },
};

export const MODULES: ModuleInfo[] = [
  {
    key: "recruiting",
    href: "/recruiting",
    emoji: "🧑‍💼",
    // El módulo se llama RR. HH. desde D-145; la clave sigue siendo "recruiting" a
    // propósito: es la columna `module_access` de todo el mundo y el prefijo de todas
    // las rutas. Renombrar la clave sería una migración de datos por un cambio de
    // rótulo. Reclutamiento pasa a ser una pestaña dentro, no el módulo entero.
    label_en: "HR Management",
    label_es: "Gestión de RR. HH.",
    desc_en: "Employees, files and hiring",
    desc_es: "Empleados, expedientes y contratación",
  },
  // Fichaje NO tiene tarjeta propia (D-111). La tuvo mientras fue una app aparte; desde
  // la fusión es la otra mitad de Time Tracker, y dibujar dos tarjetas para una sola app
  // hacía elegir entre dos puertas de la misma casa. Se entra por Time Tracker.
  {
    key: "erp",
    href: "/erp/catalog",
    emoji: "🧱",
    label_en: "ERP",
    label_es: "ERP",
    desc_en: "Catalog, purchasing and inventory",
    desc_es: "Catálogo, compras e inventario",
  },
  {
    key: "timetracker",
    href: "/timetracker",
    emoji: "⏱️",
    label_en: "Time Tracker",
    label_es: "Control de Horas",
    desc_en: "Time tracking and payroll",
    desc_es: "Registro de horas y nómina",
  },
];

// "Deliveries" itself is implicit for everyone (never in module_access, see
// landingRoute above) so it's kept out of MODULES — but HomeSelector and the
// app switcher both need to draw it as the always-first card/entry, so it's
// exported here rather than redeclared in each (D-054).
export const DELIVERIES_CARD: ModuleInfo = {
  key: "deliveries",
  href: "/",
  emoji: "📦",
  label_en: "Deliveries",
  label_es: "Entregas",
  desc_en: "Orders, routes and drivers",
  desc_es: "Órdenes, rutas y choferes",
};

/** The modules a given `module_access` grants, deliveries prepended. The
 * single place that answers "what can this person switch to" — HomeSelector
 * and ModuleSwitcher both call this instead of each filtering MODULES on
 * their own, so a third module only ever needs an entry in MODULES above. */
export function accessibleModules(moduleAccess: string[] | null | undefined): ModuleInfo[] {
  // Deliveries se antepone SOLO si se otorgó. Antes iba siempre, porque era implícita
  // para todo el mundo (D-054); desde 083 se concede como cualquier otro módulo, y
  // dibujar su tarjeta a alguien que no la tiene sería ofrecerle una pantalla que la
  // base le va a devolver vacía.
  const granted = normalizeModules(moduleAccess);
  const own = MODULES.filter((m) => granted.includes(m.key));
  return granted.includes(DELIVERIES_CARD.key) ? [DELIVERIES_CARD, ...own] : own;
}

/**
 * 'clockin' en module_access cuenta como 'timetracker'.
 *
 * Fichaje dejó de ser un módulo propio (D-111), pero la palabra sigue escrita en las filas
 * de quien la tenía. Sin esta traducción, alguien cuyo único módulo fuera 'clockin' se
 * quedaría sin ninguna tarjeta y aterrizaría en /no-access — echado de una app a la que sí
 * tiene derecho, por un cambio de nombre. La migración 088 limpia las filas; esto cubre a
 * quien la lea antes, y a cualquier fila vieja que reaparezca.
 */
export function normalizeModules(moduleAccess: string[] | null | undefined): string[] {
  const granted = moduleAccess ?? [];
  if (!granted.includes("clockin")) return granted;
  const sin = granted.filter((m) => m !== "clockin");
  return sin.includes("timetracker") ? sin : [...sin, "timetracker"];
}

// ---- Hub tools (D-056) ------------------------------------------------------
// Sibling of MODULES, but a different kind of thing: a module is something a
// person is GRANTED (module_access, opt-in per person); a hub tool is
// something that comes with a ROLE — nobody "grants" you Users, you have it
// because you're a deliveries admin. That's why this is a predicate
// (`visible`) instead of a membership list. Both HomeSelector (which cards to
// draw) and ModuleSwitcher (whether the "back to hub" button has anything to
// go back FOR) read from this same list — a second shared tool moving here
// tomorrow is one entry, not a change to either of those files.
export interface HubTool {
  key: string; href: string; emoji: string;
  label_en: string; label_es: string; desc_en: string; desc_es: string;
  visible: (me: { role: UserRole }) => boolean;
}

export const HUB_TOOLS: HubTool[] = [
  {
    key: "users",
    href: "/home/users",
    emoji: "🛡",
    label_en: "Users",
    label_es: "Usuarios",
    desc_en: "Manage team access across modules",
    desc_es: "Gestiona el acceso del equipo entre módulos",
    visible: (me) => me.role === "admin",
  },
];

// ---- Delivery time window presets ------------------------------------------
// Same "HHMM-HHMM" string format the rest of the app already parses
// (scheduling conflicts, driver routing) — only the picker is a fixed list
// now instead of free text.
export interface WindowPreset { key: string; en: string; es: string; value: string }
export const DELIVERY_WINDOW_PRESETS: WindowPreset[] = [
  { key: "early_morning", en: "Early Morning (8:30-10)", es: "Madrugada (8:30-10)", value: "0830-1000" },
  { key: "morning",       en: "Morning (8:30-12)",       es: "Mañana (8:30-12)",   value: "0830-1200" },
  { key: "afternoon",     en: "Afternoon (12-5:30)",      es: "Tarde (12-5:30)",    value: "1200-1730" },
  { key: "all_day",       en: "All Day (8:30-5:30)",         es: "Todo el día (8:30-5:30)", value: "0830-1730" },
  { key: "saturday",      en: "Saturday all day (8:30-3:30)", es: "Sábado todo el día (8:30-3:30)", value: "0830-1530" },
];

// Saturday's shorter all-day window (8:30–3:30), used in every location and
// auto-selected when a delivery date lands on a Saturday.
export const SATURDAY_WINDOW = "0830-1530";
export const WEEKDAY_ALL_DAY_WINDOW = "0830-1730";

// ---- Per-role default Orders-table columns ---------------------------------
// Falls back to OrdersTable's own DEFAULT_COLUMNS for any role not listed
// here. Sales sees invoice # instead of the internal SO #, and no driver
// column on the main view (still available via the Columns picker).
export const ROLE_DEFAULT_COLUMNS: Partial<Record<UserRole, string[]>> = {
  sales: ["type", "store", "invoice", "date", "windows", "account"],
  // Drivers work off the customer invoice, never the internal SO #.
  driver: ["stage", "type", "store", "account", "invoice", "date", "windows", "pallets"],
  // Warehouse works off the customer invoice too (Invoice # instead of SO #).
  warehouse: ["stage", "type", "store", "account", "invoice", "date", "windows", "pallets", "driver"],
};

/** Drivers come from the Users list — anyone with the "driver" role. They're
 * people, so they're managed in Users (one source of truth), not Settings. */
export function driverNames(users: { full_name: string; role: UserRole }[]): string[] {
  return users
    .filter((u) => u.role === "driver")
    .map((u) => u.full_name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

// ---- "What I can do" — per-role capability list -------------------------
// Shown on each user's Account page. These are the defaults; an admin can
// edit / add to them in Settings, which stores overrides in
// settings.role_permissions. Bilingual until customized (custom entries are
// free text, shown verbatim in both languages).
export const DEFAULT_PERMISSIONS: Record<UserRole, { en: string; es: string }[]> = {
  admin: [
    { en: "Everything", es: "Todo" },
    { en: "Manage users", es: "Gestionar usuarios" },
    { en: "Settings", es: "Ajustes" },
    { en: "Override any status", es: "Cambiar cualquier estado" },
  ],
  manager: [
    { en: "Create orders", es: "Crear órdenes" },
    { en: "Approve orders", es: "Aprobar órdenes" },
    { en: "Reject with a reason", es: "Rechazar con motivo" },
    { en: "See every order", es: "Ver todas las órdenes" },
    { en: "Dashboard", es: "Panel" },
  ],
  sales: [
    { en: "Create orders", es: "Crear órdenes" },
    { en: "Submit for approval", es: "Enviar a aprobación" },
    { en: "Resubmit rejected", es: "Reenviar rechazadas" },
    { en: "Send tracking links", es: "Enviar enlaces de seguimiento" },
  ],
  warehouse: [
    { en: "Fulfill approved orders", es: "Preparar órdenes aprobadas" },
    { en: "Set prepared status", es: "Marcar preparación" },
    { en: "Confirm pallets", es: "Confirmar pallets" },
    { en: "Mark ready", es: "Marcar listo" },
  ],
  driver: [
    { en: "Pick up & deliver", es: "Recoger y entregar" },
    { en: "Capture signatures", es: "Capturar firmas" },
    { en: "Navigate to stops", es: "Navegar a las paradas" },
    { en: "See only their assigned deliveries", es: "Ver solo sus entregas asignadas" },
  ],
  logistics: [
    { en: "Assign orders to drivers", es: "Asignar órdenes a choferes" },
    { en: "Optimize a driver's route", es: "Optimizar la ruta de un chofer" },
    { en: "View the dispatch map", es: "Ver el mapa de despacho" },
  ],
  accounting: [
    { en: "Approve orders", es: "Aprobar órdenes" },
    { en: "Reject with a reason", es: "Rechazar con motivo" },
    { en: "See every order", es: "Ver todas las órdenes" },
  ],
};

/** The default capability list for a role, in the given language. */
export const defaultPermissions = (role: UserRole, lang: Lang): string[] =>
  (DEFAULT_PERMISSIONS[role] ?? []).map((p) => (lang === "es" ? p.es : p.en));

/** Every distinct capability across all roles (deduped), for the "add" picker. */
export const allDefaultPermissions = (lang: Lang): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const role of ROLE_ORDER) {
    for (const s of defaultPermissions(role, lang)) {
      if (!seen.has(s)) { seen.add(s); out.push(s); }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
};

/** The capability list to display: admin overrides win, else the defaults. */
export function permissionsFor(
  role: UserRole,
  lang: Lang,
  overrides?: Partial<Record<UserRole, string[]>> | null,
): string[] {
  const custom = overrides?.[role];
  return custom && custom.length ? custom : defaultPermissions(role, lang);
}

// ---- Capabilities ---------------------------------------------------------
// What someone is allowed to DO. Each role grants a default set; an admin can
// additionally grant capabilities to an INDIVIDUAL user (Profile.permissions),
// e.g. a salesperson who is also allowed to approve. Grants only ever add —
// they never take away what the role already allows.
// "users" was retired here (D-056): it never granted real access — the
// Users screen has always required role==='admin' outright, so toggling this
// on a non-admin only showed them a tab that led to "Admins only." With
// Users moved to the hub (no longer a tab at all, see TABS above), keeping a
// checkbox that never did anything would be actively misleading.
export type Capability = "create" | "approve" | "fulfill" | "deliver" | "dashboard" | "settings" | "route_plan";

export const CAPABILITIES: { key: Capability; en: string; es: string; desc_en: string; desc_es: string }[] = [
  { key: "create",    en: "Create orders",    es: "Crear órdenes",       desc_en: "Log new orders and submit them for approval", desc_es: "Registrar órdenes y enviarlas a aprobación" },
  { key: "approve",   en: "Approve orders",   es: "Aprobar órdenes",     desc_en: "Approve or reject pending orders",            desc_es: "Aprobar o rechazar órdenes pendientes" },
  { key: "fulfill",   en: "Fulfill orders",   es: "Preparar órdenes",    desc_en: "Warehouse queue: prepare and mark ready",     desc_es: "Cola de almacén: preparar y marcar listo" },
  { key: "deliver",   en: "Deliver orders",   es: "Entregar órdenes",    desc_en: "Pick up, deliver and capture signatures",     desc_es: "Recoger, entregar y capturar firmas" },
  { key: "dashboard", en: "View dashboard",   es: "Ver panel",           desc_en: "See company-wide KPIs and reports",           desc_es: "Ver KPIs y reportes de la empresa" },
  { key: "settings",  en: "Change settings",  es: "Cambiar ajustes",     desc_en: "Edit workspace settings and pick-lists",      desc_es: "Editar ajustes y listas del espacio" },
  { key: "route_plan", en: "Plan routes",     es: "Planificar rutas",    desc_en: "Assign orders to drivers and optimize their route", desc_es: "Asignar órdenes a choferes y optimizar su ruta" },
];

/** The capabilities each role gets automatically. */
export const ROLE_CAPS: Record<UserRole, Capability[]> = {
  admin:     ["create", "approve", "fulfill", "deliver", "dashboard", "settings", "route_plan"],
  manager:   ["create", "approve", "dashboard"],
  sales:     ["create"],
  warehouse: ["fulfill", "deliver"],
  // Drivers do NOT create orders — orders must be programmed by sales/office and
  // dispatched by the logistics manager. A driver only delivers what's assigned.
  driver:    ["deliver"],
  logistics: ["route_plan", "approve"],
  // Accounting: same as Office Manager but WITHOUT the dashboard (and no
  // Accounts / Audit tabs — see TABS). Can create, approve and see every order.
  // Accounting reviews and approves; it does not open orders. Creating one
  // means committing the company to a delivery, which is a sales/office call.
  accounting: ["approve"],
};

// ---- Module access descriptors (D-057) -------------------------------------
// The permissions-dialog counterpart to MODULES/HUB_TOOLS above (same idea —
// N modules described data-first instead of N hand-written UI blocks — but a
// different shape: those two are about NAVIGATION cards, this is about which
// PROFILE COLUMN a block edits). Declared here, after ROLE_ORDER/
// RECRUITING_ROLE_LABELS/CAPABILITIES/ROLE_CAPS, because it references all
// four — module-eval order matters for a top-level const, unlike a function.
//
// `roleColumn`/`accessColumn` are executable documentation, not just a
// comment: UserDialog.tsx's own test (module-access.test.ts) asserts no two
// entries share a roleColumn, so two modules ever aiming at the same
// database column fails a build, not just a code review — the exact class
// of confusion (role vs recruiting_role) that produced two of D-052's three
// bugs.
// A closed union, not `string` — deliberately less generic than MODULES/
// HUB_TOOLS. UserDialog's write-dispatch switches on this exhaustively (a
// missing case fails `tsc`, not a UPDATE against the wrong column at
// runtime), which only works against a closed set of literals. Adding a
// module costs one line here plus its MODULE_ACCESS entry — a small,
// deliberate price for a compiler-checked guarantee on the sensitive half
// (writes), while the rendering half stays fully data-driven.
export type ModuleAccessKey = "deliveries" | "recruiting" | "timetracker" | "erp";

export interface ModuleAccessConfig {
  key: ModuleAccessKey;
  label_en: string; label_es: string;
  /** Deliveries only. Not a checkbox — see D-057's "always-on" note: role is
   * NOT NULL, there is no "no module" state anywhere in the schema. */
  alwaysOn: boolean;
  /** Absent for a module with no role tier of its own. The ERP is the case:
   * its only distinction is admin/manager (cost visibility, rtg-erp decision
   * #29) and those are values `role` already carries — a second column would
   * be a duplicate of the same fact, free to drift. Access is the checkbox
   * alone. The uniqueness rule this field encodes still holds: no two modules
   * may aim at the same column, and absent is not the same as "role". */
  roleColumn?: "recruiting_role" | "timetracker_role" | "role";
  roleKeys: readonly string[];
  roleLabel: (key: string, lang: Lang) => string;
  /** Present only for an opt-in module — deliveries has none, everyone
   * already has it. */
  accessColumn?: "module_access";
  /** Qué decir cuando el módulo no tiene escalafón propio. Sin esto, el diálogo
   *  enseñaba el texto del ERP —"el costo y el margen…"— también en fichaje, que no
   *  tiene ni costo ni margen: una explicación de otro módulo es peor que ninguna. */
  roleNote?: { en: string; es: string };
  /** Absent = this module has no fine-grained extra permissions (today:
   * recruiting). Present = the catalog to render, same shape CAPABILITIES
   * already uses. */
  capabilities?: { key: string; en: string; es: string; desc_en: string; desc_es: string }[];
  capabilitiesFromRole?: (roleKey: string) => string[];
}

export const MODULE_ACCESS: ModuleAccessConfig[] = [
  {
    // Ya no es implícita (D-100, migración 083). Lo era porque todo el mundo entraba
    // por aquí; con cuatro módulos y diez personas que solo fichan, dejó de ser cierto.
    // Ahora se otorga como los demás, y la base lo comprueba de verdad: sin ella,
    // has_deliveries_access() dice que no y las entregas ni se leen ni se escriben.
    //
    // `role` sigue siendo el rol de deliveries y sigue mandando sobre QUÉ ve dentro
    // quien entra — un chofer solo lo suyo. La casilla decide SI entra. Son dos cosas
    // distintas, y por eso el rol se sigue enseñando aunque la casilla esté apagada.
    key: "deliveries", label_en: "Deliveries", label_es: "Entregas",
    alwaysOn: false,
    roleColumn: "role",
    roleKeys: ROLE_ORDER,
    roleLabel: (key, lang) => roleLabel(key as UserRole, lang),
    accessColumn: "module_access",
    capabilities: CAPABILITIES,
    capabilitiesFromRole: (key) => ROLE_CAPS[key as UserRole] ?? [],
  },
  {
    key: "recruiting", label_en: "HR Management", label_es: "Gestión de RR. HH.",
    alwaysOn: false,
    roleColumn: "recruiting_role",
    roleKeys: Object.keys(RECRUITING_ROLE_LABELS),
    roleLabel: (key, lang) => (lang === "es" ? RECRUITING_ROLE_LABELS[key].es : RECRUITING_ROLE_LABELS[key].en),
    accessColumn: "module_access",
    // No capabilities — recruiting has no fine-grained extra-permissions
    // concept today (its only dial is the role tier). Nothing to render.
  },
  {
    // Incluye fichaje (D-111). Era un módulo aparte con su propia casilla; dos casillas
    // para una sola app dejaban conceder media — alguien con fichaje y sin Time Tracker
    // tenía las pantallas pero no la puerta.
    key: "timetracker", label_en: "Time Tracker", label_es: "Control de Horas",
    alwaysOn: false,
    roleColumn: "timetracker_role",
    roleKeys: Object.keys(TIMETRACKER_ROLE_LABELS),
    roleLabel: (key, lang) => (lang === "es" ? TIMETRACKER_ROLE_LABELS[key].es : TIMETRACKER_ROLE_LABELS[key].en),
    accessColumn: "module_access",
    // No capabilities yet — same as recruiting, only dial is the role tier.
  },
  {
    key: "erp", label_en: "ERP", label_es: "ERP",
    alwaysOn: false,
    // No roleColumn, and no roleKeys: this module has no role tier of its own.
    // Who may see cost is decided by `role` being admin/manager, which the
    // Deliveries block above already edits — the ERP reads the same column
    // rather than keeping a second copy of the same fact.
    roleKeys: [],
    roleLabel: (key) => key,
    accessColumn: "module_access",
    roleNote: {
      en: "The ERP has no role of its own. Cost and margin are visible to Admin and Office Manager — set above, under Deliveries.",
      es: "El ERP no tiene rol propio. El costo y el margen los ven Administrador y Gerente de Oficina — se define arriba, en Entregas.",
    },
  },
];

/** Minimal shape needed to test a capability. */
export interface CapUser { role: UserRole; permissions?: string[] | null }

/** Does this user have the capability — via their role, or an admin grant? */
export function hasCap(u: CapUser | null | undefined, cap: Capability): boolean {
  if (!u) return false;
  if (ROLE_CAPS[u.role]?.includes(cap)) return true;
  return !!u.permissions?.includes(cap);
}

/** Extra capabilities granted to this user beyond what their role already gives. */
export function extraCaps(u: CapUser): Capability[] {
  const base = ROLE_CAPS[u.role] ?? [];
  return (u.permissions ?? []).filter((p): p is Capability => !base.includes(p as Capability));
}

// ---- Permissions helpers --------------------------------------------------
export const canCreate = (u: CapUser) => hasCap(u, "create");
export const canApprove = (u: CapUser) => hasCap(u, "approve");
export const canFulfill = (u: CapUser) => hasCap(u, "fulfill");
export const canDeliver = (u: CapUser) => hasCap(u, "deliver");
export const canPlanRoutes = (u: CapUser) => hasCap(u, "route_plan");

// ---- Workflow transition guard -------------------------------------------
// The only legal stage moves. Enforced in BOTH data providers so an order can
// never reach the warehouse (fulfilling/ready/delivered) without first being
// approved by a manager — no matter how setStage is called.
const LEGAL_TRANSITIONS: Record<Stage, Stage[]> = {
  draft:      ["pending", "canceled"],
  pending:    ["approved", "rejected"],
  rejected:   ["pending", "canceled"],
  approved:   ["fulfilling", "pending"],   // pending = manager "unlock"
  fulfilling: ["ready"],
  ready:      ["picked_up"],               // driver collects the order
  picked_up:  ["delivered", "ready"],      // driver delivers (or reverts if not taken)
  delivered:  [],
  canceled:   [],
};

export function canTransition(from: Stage, to: Stage): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Can this role edit the order's data fields while it sits in `stage`? */
export function canEditFields(r: UserRole, stage: Stage): boolean {
  if (r === "admin") return true;
  // Sales can only edit while an order is Pending Approval or Rejected —
  // NOT Draft. A brand-new order is still editable (isNew bypasses this
  // check entirely in OrderModal), but once a draft is saved, a sales rep
  // must submit it for approval before touching it again.
  if (r === "sales") return stage === "pending" || stage === "rejected";
  if (r === "warehouse") return ["approved", "fulfilling", "ready", "picked_up", "delivered"].includes(stage);
  if (r === "driver") return stage === "draft" || stage === "pending" || stage === "rejected";
  if (r === "manager") return true;
  return false;
}
