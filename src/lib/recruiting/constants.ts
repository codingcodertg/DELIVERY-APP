import type { Stage } from "./types";

// App version shown in the footer on every screen. Keep in sync with package.json.
export const APP_VERSION = "0.0.47";

// Fallback stages, used before the DB stages load or if the migration
// hasn't run yet. The DB `stages` table (see supabase/06_stages.sql) is the
// source of truth at runtime and can be edited by an admin in Settings.
export const DEFAULT_STAGES: Stage[] = [
  { id: "d0", key: "registered", label: "Registered", color: "#6b7686", type: "active", sort: 0, max_days: null },
  { id: "d1", key: "phone", label: "Phone Interview", color: "#2456c9", type: "active", sort: 1, max_days: 3 },
  { id: "d2", key: "standby", label: "Standby", color: "#e9a13b", type: "active", sort: 2, max_days: 7 },
  { id: "d3", key: "inperson", label: "In Person Interview", color: "#7c4dbc", type: "active", sort: 3, max_days: 5 },
  { id: "d4", key: "hired", label: "Hired", color: "#1f9d61", type: "won", sort: 4, max_days: null },
  { id: "d5", key: "discarded", label: "Discarded", color: "#d64545", type: "lost", sort: 5, max_days: null },
];

export function stageOf(stages: Stage[], key: string): Stage {
  return stages.find((s) => s.key === key) ?? stages[0] ?? DEFAULT_STAGES[0];
}

// Tag auto-added when a call attempt fails (voicemail / no answer / call back
// later) and auto-removed when an interview is saved.
export const CALL_AGAIN_TAG = "call again";

// Store / branch locations candidates can be assigned to.
export const LOCATIONS: string[] = [
  "Brownsville",
  "Weslaco",
  "Pharr",
  "McAllen",
  "Mission",
  "Edinburg",
  "TBD",
];

import type { UserRole, RecruiterRecommendation } from "./types";

// adminOnly tabs are only shown to admins. Hrefs are prefixed /recruiting —
// this module lives under that prefix now, not at the site root (D-050).
// "Today" (D-061) is a derived dashboard, not a data source of its own — it
// reads phone_date/inperson_date/follow_up/status off `candidates`, the same
// fields Calendar/Outcomes/Candidates already read. The module root stays
// bare /recruiting → Candidates (D-052 is not reopened by this).
// No "Users" tab (D-062): user management moved to the hub (D-056) — every
// module reaches it through ModuleSwitcher/HUB_TOOLS, not its own tab. This
// module's TABS kept one anyway, which just clicked through to /home/users —
// a tab whose only behavior was leaving. /recruiting/users itself still
// redirects there, for old bookmarks (see that file).
// D-145: el módulo pasa a ser RR. HH. y la contratación es una parte de él, no el todo.
// Por eso Empleados va primero: la plantilla es lo permanente, los candidatos son de paso.
export const TABS: { id: string; label: string; href: string; adminOnly?: boolean; roles?: string[] }[] = [
  { id: "today", label: "🏠 Today", href: "/recruiting/today" },
  // Ni el reclutador ni la pestaña: el expediente lleva dirección, amonestaciones y antidoping,
  // y quien entra a mover candidatos no necesita nada de eso. Quien manda es la 094 (RLS); esto
  // solo evita enseñar una puerta que se abriría vacía.
  { id: "employees", label: "👤 Employees", href: "/recruiting/employees", roles: ["admin", "manager"] },
  { id: "candidates", label: "👥 Candidates", href: "/recruiting" },
  { id: "board", label: "🗂 Board", href: "/recruiting/board" },
  { id: "outcomes", label: "🤝 Outcomes", href: "/recruiting/outcomes" },
  { id: "questions", label: "❓ Questions", href: "/recruiting/questions" },
  { id: "metrics", label: "📊 Metrics", href: "/recruiting/metrics" },
  { id: "calendar", label: "📅 Calendar", href: "/recruiting/calendar" },
  { id: "settings", label: "⚙️ Settings", href: "/recruiting/settings" },
];

// Recruiter's verdict at the end of the phone interview. Separate from the
// question scoring: this is the human call, not the computed average.
export const RECRUITER_MAX_SCORE = 5;

export const RECOMMENDATIONS: {
  id: RecruiterRecommendation; icon: string; en: string; es: string; color: string;
}[] = [
  { id: "advance", icon: "✅", en: "Recommend moving forward", es: "Recomiendo seguir", color: "var(--green)" },
  { id: "second_opinion", icon: "🤔", en: "Need a second opinion", es: "Necesito segunda opinión", color: "var(--amber)" },
  { id: "reject", icon: "❌", en: "Do not recommend", es: "No recomiendo", color: "var(--red)" },
];

export function recommendationOf(id: string | null | undefined) {
  return RECOMMENDATIONS.find((r) => r.id === id) ?? null;
}

export const ROLE_INFO: Record<UserRole, { label: string; color: string; desc: string }> = {
  admin: { label: "Admin", color: "var(--red)", desc: "Full access + manage users" },
  manager: { label: "Office Manager", color: "var(--purple)", desc: "Sees all candidates and their process" },
  recruiter: { label: "Recruiter", color: "var(--accent)", desc: "Registers and works candidates" },
};
