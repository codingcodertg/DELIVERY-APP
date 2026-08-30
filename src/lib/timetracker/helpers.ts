// Time / money / week helpers, ported verbatim (behavior-wise) from
// timetracker-clean/web/src/lib/helpers.js — see D-066. computePay and the
// week-start logic are reused exactly, unchanged, per CLAUDE.md's original
// build brief for that app ("reuse verbatim").

export const LOCALE = "en-US";
export const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const TZ_LIST = [
  "America/Tegucigalpa", "America/Guatemala", "America/El_Salvador", "America/Managua",
  "America/Costa_Rica", "America/Panama", "America/Mexico_City", "America/Chicago",
  "America/New_York", "America/Denver", "America/Los_Angeles", "America/Bogota",
  "America/Lima", "America/Santiago", "America/Sao_Paulo", "America/Argentina/Buenos_Aires",
  "UTC", "Europe/London", "Europe/Madrid", "Europe/Berlin", "Asia/Manila", "Asia/Kolkata",
];

export interface Location { name: string; weekStartDay?: number | null }

export interface AppSettings {
  appName: string;
  currency: string;
  timeZone: string;
  weekStartDay: number;
  payPeriod: "weekly" | "biweekly" | "monthly";
  defaultWorkerType: "remote" | "inhouse";
  defaultTrackMode: "activity" | "inout";
  defaultBreaksEnabled: boolean;
  idleLimitMin: number;
  locations: Location[];
  smartIdle: boolean;
  workApps: string[];
  paymentMethods: string[];
  adjustmentTypes: string[];
  screenshotIntervalMin: number;
  companyName: string; companyAddress: string; companyTaxId: string;
  companyPhone: string; companyEmail: string;
}

// Global mutable settings, mirrored from the settings subscription (see
// syncAppSettings). Helpers read currency/weekStartDay/timeZone from here —
// same shape as the original: most of these helpers are plain functions
// called far from any React tree (formatting, sorting), not hooks, so they
// can't read from a context.
export let APP_SETTINGS: AppSettings = {
  appName: "TimeTracker",
  currency: "$",
  timeZone: BROWSER_TZ,
  // 0=Dom … 5=Vie. Viernes, que es cuando empieza el periodo de pago (D-133). Estaba en 6
  // (sábado) y la base ya guardaba 5: el valor por defecto contradecía al real, así que
  // cualquier instalación nueva —o cualquier lectura antes de que carguen los ajustes—
  // contaba una semana que no es la de esta empresa.
  weekStartDay: 5,
  payPeriod: "weekly",
  defaultWorkerType: "remote",
  defaultTrackMode: "activity",
  defaultBreaksEnabled: true,
  idleLimitMin: 5,
  locations: [{ name: "Remote", weekStartDay: 5 }],
  smartIdle: true,
  workApps: ["Meet", "Zoom", "Teams", "Webex", "Skype", "RingCentral", "Slack", "Claude", "ChatGPT",
    "Docs", "Sheets", "Slides", "Word", "Excel", "PowerPoint", "Outlook", "Gmail",
    "Visual Studio Code", "VS Code", "Figma", "Notion", "Loom", "Jira", "Linear"],
  paymentMethods: ["Cash", "Bank transfer", "PayPal"],
  adjustmentTypes: ["Bonus", "Advance", "Deduction"],
  screenshotIntervalMin: 10,
  companyName: "", companyAddress: "", companyTaxId: "",
  companyPhone: "", companyEmail: "",
};

export function syncAppSettings(s: Partial<AppSettings>): void {
  APP_SETTINGS = { ...APP_SETTINGS, ...s, timeZone: s.timeZone || APP_SETTINGS.timeZone || BROWSER_TZ };
}

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad(n: number): string { return String(n).padStart(2, "0"); }

export function fmtClock(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h + ":" + pad(m) + ":" + pad(s);
}
export function fmtHrs(sec: number): string { return (sec / 3600).toFixed(2) + " h"; }
export function fmtHM(sec: number): string {
  const m = Math.round((sec || 0) / 60), h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? h + "h " + mm + "m" : mm + "m";
}
export function money(n: number | null | undefined): string {
  return APP_SETTINGS.currency + " " + (n || 0).toLocaleString(LOCALE, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

// --- time-zone aware date helpers ---
type DateLike = Date | number | string;
function tzMs(x: DateLike): number { return x instanceof Date ? x.getTime() : typeof x === "number" ? x : Date.now(); }
function dateISOInTz(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}
function weekdayOfISO(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function dateISO(x: DateLike): string { return dateISOInTz(tzMs(x), APP_SETTINGS.timeZone); }

export function weekStartISO(x: DateLike, weekStartDay?: number | null): string {
  const wsd = weekStartDay == null ? APP_SETTINGS.weekStartDay : Number(weekStartDay);
  const iso = typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)
    ? x : dateISOInTz(tzMs(x), APP_SETTINGS.timeZone);
  const diff = (weekdayOfISO(iso) - wsd + 7) % 7;
  return shiftISO(iso, -diff);
}
export function weekEndISO(startISO: string): string { return shiftISO(startISO, 6); }
export function addWeeks(startISO: string, n: number): string { return shiftISO(startISO, n * 7); }
export function addDaysISO(iso: string, n: number): string { return shiftISO(iso, n); }
export function thisWeekStart(): string { return weekStartISO(new Date()); }

// "Sat, Jul 4, 2026" for a YYYY-MM-DD string
export function fmtDayLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// "3 min ago" / "2 hrs ago" / "1 day ago"
export function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " min ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " hr" + (h > 1 ? "s" : "") + " ago";
  const d = Math.floor(h / 24);
  return d + " day" + (d > 1 ? "s" : "") + " ago";
}

export function fmtISOday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE, {
    day: "2-digit", month: "short", timeZone: "UTC",
  });
}
export function weekLabel(startISO: string): string {
  const end = weekEndISO(startISO);
  const [ey] = end.split("-");
  return fmtISOday(startISO) + " – " + fmtISOday(end) + ", " + ey;
}

// --- pay-period helpers (weekly | biweekly | monthly) ---
// Biweekly blocks are anchored to a fixed Saturday so they stay consistent.
const BIWEEK_ANCHOR = "1970-01-03"; // a Saturday
function daysBetween(isoA: string, isoB: string): number {
  const [ay, am, ad] = isoA.split("-").map(Number);
  const [by, bm, bd] = isoB.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
function monthStartISO(iso: string): string { return iso.slice(0, 7) + "-01"; }
function monthEndISO(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  return d.toISOString().slice(0, 10);
}
function addMonthsISO(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

export function periodStartISO(x: DateLike, payPeriod?: string): string {
  const p = payPeriod || APP_SETTINGS.payPeriod || "weekly";
  if (p === "monthly") {
    const iso = typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : dateISO(x);
    return monthStartISO(iso);
  }
  const wStart = weekStartISO(x);
  if (p === "biweekly") {
    const weeks = Math.floor(daysBetween(BIWEEK_ANCHOR, wStart) / 7);
    return ((weeks % 2) + 2) % 2 === 0 ? wStart : shiftISO(wStart, -7);
  }
  return wStart; // weekly
}
export function periodEndISO(periodStart: string, payPeriod?: string): string {
  const p = payPeriod || APP_SETTINGS.payPeriod || "weekly";
  if (p === "monthly") return monthEndISO(periodStart);
  if (p === "biweekly") return shiftISO(periodStart, 13);
  return shiftISO(periodStart, 6);
}
export function addPeriod(periodStart: string, n: number, payPeriod?: string): string {
  const p = payPeriod || APP_SETTINGS.payPeriod || "weekly";
  if (p === "monthly") return addMonthsISO(periodStart, n);
  if (p === "biweekly") return shiftISO(periodStart, n * 14);
  return shiftISO(periodStart, n * 7);
}
export function thisPeriodStart(payPeriod?: string): string { return periodStartISO(new Date(), payPeriod); }

// True if the pay week (given its start ISO) has fully ended — its last day is
// before today in the app timezone. A finished week is a locked timesheet that
// goes "in review" until a manager marks it paid.
export function weekIsFinished(weekStart: string, payPeriod?: string): boolean {
  const end = periodEndISO(weekStart, payPeriod || APP_SETTINGS.payPeriod || "weekly");
  return end < dateISO(new Date());
}

// A project's pay-week start day: explicit project override → its location's
// configured start day → the company default (undefined lets weekStartISO use it).
export function projectWeekStart(project: { weekStartDay?: number | string | null; location?: string | null } | null | undefined): number | undefined {
  if (project && project.weekStartDay != null && project.weekStartDay !== "") return Number(project.weekStartDay);
  const locs = APP_SETTINGS.locations || [];
  const loc = locs.find((l) => (l.name || "").toLowerCase() === ((project && project.location) || "").toLowerCase());
  if (loc && loc.weekStartDay != null && loc.weekStartDay !== ("" as unknown)) return Number(loc.weekStartDay);
  return undefined;
}
export function periodLabel(periodStart: string, payPeriod?: string): string {
  const p = payPeriod || APP_SETTINGS.payPeriod || "weekly";
  if (p === "weekly") return weekLabel(periodStart);
  const end = periodEndISO(periodStart, p);
  if (p === "monthly") {
    const [y, m] = periodStart.split("-").map(Number);
    const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(LOCALE, { month: "long", timeZone: "UTC" });
    return name + " " + y;
  }
  return fmtISOday(periodStart) + " – " + fmtISOday(end) + ", " + end.split("-")[0];
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(LOCALE, {
    hour: "2-digit", minute: "2-digit", timeZone: APP_SETTINGS.timeZone,
  });
}
export function fmtDT(ms: number, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(ms).toLocaleString(LOCALE, { ...(opts || {}), timeZone: APP_SETTINGS.timeZone });
}
export function breaksText(s: { breakEvents?: { kind: string; start: number; end: number | null }[] | null } | null | undefined): string | null {
  if (!s || !s.breakEvents || !s.breakEvents.length) return null;
  return s.breakEvents
    .map((ev) => (ev.kind === "lunch" ? "🍽" : "☕") + " " + fmtTime(ev.start) + "–" + (ev.end ? fmtTime(ev.end) : "ongoing"))
    .join("   ");
}

// --- effective per-user settings (inherit global default) ---
export function effWorkerType(u: { workerType?: string | null } | null | undefined): string { return (u && u.workerType) || APP_SETTINGS.defaultWorkerType || "remote"; }
export function effTrackMode(u: { trackMode?: string | null } | null | undefined): string { return (u && u.trackMode) || APP_SETTINGS.defaultTrackMode || "activity"; }
export function effBreaks(u: { breaksEnabled?: boolean | string | null } | null | undefined): boolean {
  return u && u.breaksEnabled != null ? u.breaksEnabled === true || u.breaksEnabled === "yes" : !!APP_SETTINGS.defaultBreaksEnabled;
}

export interface PayInputs {
  hourlyRate?: number | string | null;
  overtimeRate?: number | string | null;
  overtimeThreshold?: number | string | null;
  weeklyLimit?: number | string | null;
}
export function computePay(hoursWorked: number, a: PayInputs) {
  const rate = Number(a.hourlyRate) || 0;
  const otRate = Number(a.overtimeRate) || rate;
  const otThresh = a.overtimeThreshold === "" || a.overtimeThreshold == null ? Infinity : Number(a.overtimeThreshold);
  const wLimit = a.weeklyLimit === "" || a.weeklyLimit == null ? Infinity : Number(a.weeklyLimit);
  const billable = Math.min(hoursWorked, wLimit);
  const overLimit = Math.max(0, hoursWorked - wLimit);
  const reg = Math.min(billable, otThresh);
  const ot = Math.max(0, billable - otThresh);
  return { billable, overLimit, reg, ot, pay: reg * rate + ot * otRate, rate, otRate };
}
