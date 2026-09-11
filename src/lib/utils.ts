import type { Delivery } from "./types";
import { parseWindow } from "./dispatch";

/** Deterministic fallback color for a driver with no assigned color yet, so
 * map pins/route markers are still distinguishable before a manager sets
 * real colors in Settings. Shared by the Map and Routes pages. */
export function fallbackDriverColor(name: string): string {
  const palette = ["#2456c9", "#0f8a8a", "#d1782e", "#7c4dbc", "#1f9d61", "#d64545", "#e9a13b"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/** A date as local YYYY-MM-DD.
 * NOT toISOString() — that converts to UTC, so anywhere west of Greenwich the
 * date rolls forward late in the evening (7pm CDT is already tomorrow in UTC).
 * Delivery dates are calendar days in the user's timezone, so they must be
 * derived from local parts to stay consistent with isOverdue()/isToday(). */
export function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The business runs in South Texas (US Central). "Today" is computed in that
// fixed timezone so the SAME calendar day is used on the server (UTC) and in
// the browser — otherwise the server-rendered HTML and the client's first
// render disagree in the evening (UTC has already rolled to tomorrow), which
// is exactly what triggers React hydration errors. It's also what the RGV
// operation means by "today", regardless of a device's own clock/timezone.
export const BUSINESS_TZ = "America/Chicago";
const isoInTZ = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const todayISO = () => isoInTZ(new Date());

// The company's own short codes for each branch — the ones used on the
// onboarding sheet and spoken on the radio. A tiny "BRO" tag fits on a phone
// where "RDZ Brownsville" would wrap and push everything else off the row.
const STORE_TAGS: Record<string, string> = {
  "rdz mcallen": "MCA",
  "rdz pharr": "PHR",
  "rdz edinburg": "EDG",
  "rdz brownsville": "BRO",
  "rdz weslaco": "WES",
  "rdz mission": "MIS",
  "bodega azul": "AZUL",
};

/** Short tag for the store an order ships out of. Falls back to the first
 * letters of the last word, so a branch added later still gets a sane tag
 * instead of nothing. */
export function storeTag(store: string | null | undefined): string {
  const name = (store ?? "").trim();
  if (!name) return "";
  const known = STORE_TAGS[name.toLowerCase()];
  if (known) return known;
  const last = name.split(/\s+/).pop() ?? name;
  return last.slice(0, 3).toUpperCase();
}

/** Compact delivery date for a cramped row: "Aug 13" / "13 ago". The year is
 * dropped — a driver's list only ever holds the days around today. */
export function fmtDateShort(iso: string | null | undefined, lang: "en" | "es" = "en"): string {
  if (!iso) return "";
  // Noon anchors the parse away from the midnight boundary, so a date-only
  // value can't slip a day when it's read back in another zone.
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "es" ? "es-MX" : "en-US", {
    timeZone: BUSINESS_TZ, month: "short", day: "numeric",
  }).format(d).replace(".", "");
}

/** Human-facing order id incl. the split-load letter: "FA100", "FA100a".
 * Uses the order_code; falls back to the internal number for legacy rows. */
export const orderLabel = (d: { order_code?: string | null; order_no: number; order_suffix?: string | null }) =>
  `${d.order_code || d.order_no}${d.order_suffix ?? ""}`;

/** Default base for teaching-mode (sandbox) order numbers. */
export const TRAINING_ORDER_BASE = 900000;

/** Next order number for a teaching-mode order: it draws from its own high
 * range (>= base) so a practice order never consumes a real order number.
 * `deliveries` is the current (training-scoped) set. */
export function nextTrainingOrderNo(
  deliveries: { order_no?: number | null }[],
  base: number = TRAINING_ORDER_BASE,
): number {
  const maxTraining = deliveries.reduce((m, x) => Math.max(m, Number(x.order_no ?? 0)), 0);
  return Math.max(maxTraining, base) + 1;
}

/** Yesterday as local YYYY-MM-DD — the floor of what a salesperson sees by
 * default on the Orders table (yesterday / today / future only). */
export const yesterdayISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localISO(d);
};

/** A YYYY-MM-DD shifted by N days (negative goes back) — e.g. stepping the
 * date picker on the delivery map with prev/next-day arrows. */
export function shiftDateISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return localISO(dt);
}

/** A YYYY-MM-DD shifted by N calendar months (negative goes back), clamped to
 * the last day of the target month if the original day doesn't exist there
 * (e.g. Jan 31 - 1 month lands on Feb 28, not Mar 3). */
export function shiftMonthISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1 + months, 1);
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(d || 1, lastDay));
  return localISO(dt);
}

/** Monday of the week containing this date (or today). */
export function startOfWeekISO(d: Date = new Date()): string {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return localISO(monday);
}

/** Sunday of the week containing this date (or today). */
export function endOfWeekISO(d: Date = new Date()): string {
  const monday = new Date(startOfWeekISO(d) + "T12:00:00");
  monday.setDate(monday.getDate() + 6);
  return localISO(monday);
}

/** First day of the month containing this date (or today). */
export function startOfMonthISO(d: Date = new Date()): string {
  return localISO(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Last day of the month containing this date (or today). */
export function endOfMonthISO(d: Date = new Date()): string {
  return localISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Current business-timezone time as "HH:MM", for comparing against a
 * configured cutoff. Uses the fixed business timezone (not the runtime clock)
 * so it's identical on server and client and can't desync SSR from hydration. */
export const nowHHMM = () => {
  const n = new Date();
  return new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(n);
};

/** The sales rep this order belongs to, for anything that scopes by "whose
 * order is this" — own-orders visibility, notifications, dashboard/export
 * credit. An office/admin/driver creator can assign it to a rep (see
 * OrderModal's Sales Rep picker); that pick wins over `created_by`, which
 * always stays the person who actually logged the order. */
export function orderOwner(d: Pick<Delivery, "created_by" | "assigned_sales_rep">): string | null {
  return d.assigned_sales_rep ?? d.created_by;
}

/** An order still sitting in "pending" past today's end-of-day cutoff (e.g.
 * 4pm for managers, a bit later for the sales rep who submitted it) — flagged
 * red and escalated, since it's blocking a delivery that may be due soon. */
export function isPendingUrgent(d: Delivery, cutoffHHMM: string | null | undefined): boolean {
  if (!cutoffHHMM || d.stage !== "pending") return false;
  return nowHHMM() >= cutoffHHMM;
}

/** Current local time as a 4-digit military string, e.g. "1430". */
export const nowMilitary = () => {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, "0")}${String(n.getMinutes()).padStart(2, "0")}`;
};

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { day: "2-digit", month: "short" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  );
}

/** Display a free-typed military time as HH:MM, e.g. "1000" → "10:00",
 * "830" → "08:30", "10" → "10:00". "—" if empty. A 1–2 digit value is read as
 * a bare hour (so "10" is 10:00, not 00:10); 3–4 digits are HMM/HHMM. */
export function fmtMilitary(t: string | null): string {
  const s = (t || "").replace(/[^0-9]/g, "");
  if (!s) return "—";
  const four = (s.length <= 2 ? s.padStart(2, "0") + "00" : s.padStart(4, "0")).slice(0, 4);
  return `${four.slice(0, 2)}:${four.slice(2)}`;
}

/** Delivery time window "0830-1730" → "08:30-17:30" for display (inserts the
 * colon into each HHMM). Handles multiple comma-separated ranges. "—" if empty. */
export function fmtWindows(w: string | null | undefined): string {
  const s = String(w ?? "").trim();
  if (!s) return "—";
  return s.replace(/\b(\d{2})(\d{2})\b/g, "$1:$2");
}

export const telClean = (t: string | null) => (t || "").replace(/[^0-9+]/g, "");

/** Best-effort city name pulled from a free-text address — matched against a
 * list of known city names (the stores list) first since that's exact, then
 * falls back to the address's second-to-last comma segment (where the city
 * usually lands in both a typed "123 Main St, McAllen TX" address and a
 * geocoded "…, McAllen, Hidalgo County, Texas, 78501, …" one). */
export function cityFromAddress(address: string | null | undefined, knownCities: string[] = []): string {
  const a = (address || "").trim();
  if (!a) return "—";
  const lower = a.toLowerCase();
  for (const city of knownCities) {
    if (city && lower.includes(city.toLowerCase())) return city;
  }
  const parts = a.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || a;
}

/** Auto-calculated duration from pallet count × minutes-per-pallet, e.g. "20 min".
 * Returns "" when there are no pallets so the field stays blank. */
export function palletDuration(pallets: number | null | undefined, minPerPallet: number): string {
  const n = Number(pallets);
  if (!n || n <= 0 || !minPerPallet) return "";
  return `${Math.round(n * minPerPallet)} min`;
}

/** Format a USD amount, e.g. 75 → "$75.00". "—" when unset. */
export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !isFinite(Number(v))) return "—";
  return "$" + Number(v).toFixed(2);
}

export function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

const AVATAR_COLORS = ["#2456c9", "#7c4dbc", "#0f8a8a", "#e9a13b", "#1f9d61", "#d64545", "#3d4d68"];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** An order is overdue when its delivery date is in the past and it hasn't
 * reached a terminal stage (delivered/canceled). Used for SLA flagging. */
export function isOverdue(d: Delivery): boolean {
  if (!d.delivery_date) return false;
  if (d.stage === "delivered" || d.stage === "canceled") return false;
  // Overdue once its calendar day has fully passed. Compared as YYYY-MM-DD
  // strings against the business-timezone "today" so the result is identical on
  // the server (UTC) and in the browser — a Date.now() comparison flips across
  // timezones and would desync SSR from hydration.
  return d.delivery_date.slice(0, 10) < todayISO();
}

/** How far the warehouse's actual pallet count landed from the sales estimate.
 * Returns null unless BOTH are set and the gap is material (≥2 pallets), so a
 * 1-off rounding never flags. `diff` is actual − estimate (positive = more than
 * estimated). Feeds the warehouse variance flag so sales can calibrate. */
export function palletVariance(d: { est_pallets?: number | null; actual_pallets?: number | null }): { diff: number; est: number; actual: number } | null {
  if (d.est_pallets == null || d.actual_pallets == null) return null;
  const est = Number(d.est_pallets), actual = Number(d.actual_pallets);
  const diff = actual - est;
  return Math.abs(diff) >= 2 ? { diff, est, actual } : null;
}

export type DeliveryRisk = "overdue" | "at_risk" | null;

/** Minutes before a delivery window closes that an undelivered order becomes
 * "at risk" of being late. */
export const RISK_MINUTES = 60;

/** Finer-grained SLA state than isOverdue: an order is "overdue" if its day has
 * passed OR today's delivery window has already closed with no delivery; it is
 * "at_risk" if today's window is closing within RISK_MINUTES. delivered/
 * canceled/rejected orders carry no risk. */
export function deliveryRisk(d: Delivery, now: Date = new Date()): DeliveryRisk {
  if (d.stage === "delivered" || d.stage === "canceled" || d.stage === "rejected") return null;
  if (!d.delivery_date) return null;
  if (isOverdue(d)) return "overdue";                 // a past day, still open
  if (!isToday(d.delivery_date)) return null;         // future day — not yet a concern
  const win = parseWindow(d.delivery_windows);
  if (!win) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin > win[1]) return "overdue";              // today's window already closed
  if (win[1] - nowMin <= RISK_MINUTES) return "at_risk";
  return null;
}

/**
 * Is this order actually waiting for a driver?
 *
 * "No driver assigned" is not the same question. A draft has no driver either,
 * but nobody has committed to it — it hasn't been submitted, approved or
 * promised to anyone — so counting it as work awaiting dispatch puts orders on
 * the "unscheduled" list that nobody is supposed to schedule yet.
 *
 * Finished and abandoned orders are excluded for the same reason: they are not
 * waiting for anything.
 *
 * NOTE: Routes Manager deliberately DOES show drafts, so a dispatcher can
 * pre-plan work the warehouse hasn't prepared (D-004). This is about the
 * "unscheduled" views, not about what can be planned.
 */
export function awaitingDriver(d: { assigned_driver?: string | null; stage?: string | null }): boolean {
  if (d.assigned_driver) return false;
  return !["draft", "delivered", "canceled", "rejected"].includes(d.stage ?? "");
}

/** Whole days between two ISO timestamps (a - b), floored. */
export function daysBetween(aISO: string, bISO: string): number {
  return Math.floor((new Date(aISO).getTime() - new Date(bISO).getTime()) / 86_400_000);
}

/** How long a late order lingers on the queues after its delivery date before
 * it drops off (unless it's reprogrammed to a future date). */
export const LATE_GRACE_DAYS = 2;

/** How far back the working queues reach: yesterday. */
export const RETENTION_DAYS_BACK = 1;

/**
 * What the working queues (sales board, warehouse, driver) show by default:
 * yesterday, today, and everything still to come.
 *
 * The floor is what matters. These roles work the near term, and a list that
 * reaches weeks back buries today's work under finished business — which is
 * exactly what it was doing. Yesterday stays because a stop that slipped past
 * midnight is still live work.
 *
 * There is deliberately NO ceiling. It used to stop at tomorrow, on the
 * reasoning that anything further out wasn't theirs to act on yet; in practice
 * a driver wanting to see what's coming had no way to, and a warehouse
 * preparing ahead couldn't either.
 *
 * QUIÉN queda fuera de la ventana lo dice `seesAllHistory` (abajo), no una lista
 * escrita en cada pantalla.
 *
 * Undated orders always stay visible — they're still being scheduled, and
 * hiding one nobody has dated yet would strand it.
 *
 * Two ways past the floor: reprogramming a slipped order forward brings it
 * straight back, and every one of these screens lets an invoice search reach
 * into older history.
 */
export function withinRetention(
  d: { delivery_date?: string | null; stage?: string | null },
  today: string = todayISO(),
): boolean {
  if (!d.delivery_date) return true;            // undated — still being scheduled
  return d.delivery_date.slice(0, 10) >= shiftDateISO(today, -RETENTION_DAYS_BACK);
}

/**
 * Quién ve el historial entero, y por tanto queda fuera de la ventana: **solo el
 * admin y el gerente de logística** (D-239).
 *
 * El dueño: *«the same rule that you can only see yesterday today and future
 * applies to everyone except admin and logistic manager»*.
 *
 * Antes esto no existía como regla, sino como tres condiciones distintas escritas
 * en tres pantallas: `adminAllAccess` en el tablero, `realRole !== "admin"` en
 * almacén y una lista `nearTerm` de tres roles. **Y así fue como `logistics` quedó
 * fuera por omisión y no por decisión**: nadie decidió que un gerente de logística
 * viera todo el historial en el tablero; simplemente no estaba en la lista de los
 * que se filtraban. Una regla escrita una vez no tiene ese fallo.
 *
 * Se compara contra el rol REAL, no el de «ver como»: un admin previsualizando a
 * un vendedor sigue viendo todo, que es lo que ya hacía almacén.
 */
export const HISTORY_EXEMPT_ROLES = ["admin", "logistics"] as const;

export function seesAllHistory(role: string | null | undefined): boolean {
  return (HISTORY_EXEMPT_ROLES as readonly string[]).includes(role ?? "");
}

/** El día más antiguo que ve quien no está exento: ayer. Para los selectores de
 *  fecha, que si no dejarían escribir una fecha anterior y enseñar el día vacío. */
export function retentionFloorISO(today: string = todayISO()): string {
  return shiftDateISO(today, -RETENTION_DAYS_BACK);
}

/** Human "2 h 5 min" from a millisecond span (drops zero parts). "—" if invalid. */
export function fmtDuration(ms: number | null): string {
  if (ms == null || !isFinite(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function isToday(iso: string | null): boolean {
  if (!iso) return false;
  // Calendar-date comparison in the business timezone, so server and client
  // agree (see isOverdue / todayISO).
  return iso.slice(0, 10) === todayISO();
}

/** Build a CSV string from rows of records (values are stringified + quoted). */
export function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Every data column of a delivery, as [header, value] — used for CSV export & detail view. */
// Spanish labels for the delivery column keys, used by the view-mode detail
// grid. CSV export keeps the English keys as headers.
const COLUMN_ES: Record<string, string> = {
  "ID": "ID",
  "Order Type": "Tipo de Orden",
  "Store (Sold From)": "Tienda (Vendido Desde)",
  "PO #": "PO #",
  "SO #": "SO #",
  "Invoice #": "Factura #",
  "Estimate #": "Estimación #",
  "Input Date": "Fecha de Ingreso",
  "Input Military Time": "Hora de Ingreso (militar)",
  "Delivery Date": "Fecha de Entrega",
  "Pickup Name": "Nombre de Recolección",
  "Pickup Address": "Dirección de Recolección",
  "Pickup Duration": "Duración de Recolección",
  "Delivery Fee": "Costo de Entrega",
  "Est. Pallets (sales)": "Pallets Est. (ventas)",
  "Actual Pallets (warehouse)": "Pallets Reales (almacén)",
  "Assigned Driver": "Chofer Asignado",
  "Delivery Duration": "Duración de Entrega",
  "Delivery Address": "Dirección de Entrega",
  "Delivery Military Time Windows": "Ventanas de Entrega (militar)",
  "Account": "Cuenta",
  "Contact": "Contacto",
  "Delivery Phone Number": "Teléfono de Entrega",
  "Delivery Notes": "Notas de Entrega",
  "Route Miles": "Millas de Ruta",
  "Est. Travel Time": "Tiempo de Viaje Est.",
  "Re-delivery reason": "Motivo de Reentrega",
};

/** Translate a delivery-column key for display (English keys pass through). */
export function colLabel(key: string, lang: "en" | "es"): string {
  return lang === "es" ? COLUMN_ES[key] ?? key : key;
}

// Friendly labels for Delivery field KEYS (as they appear in an update patch),
// used to describe an edit in the activity log. Derived/auto fields are left
// out on purpose so a routine save doesn't spam the history with them.
const FIELD_LABELS: Record<string, string> = {
  order_type: "Order Type", store: "Store", po2: "PO #", so_num: "SO #",
  invoice_num: "Invoice #", estimate_num: "Estimate #", delivery_date: "Delivery Date",
  pickup_name: "Pickup Name", pickup_address: "Pickup Address", delivery_fee: "Delivery Fee",
  est_pallets: "Est. Pallets", actual_pallets: "Actual Pallets", assigned_driver: "Assigned Driver",
  delivery_address: "Delivery Address", delivery_name: "Dropoff Name", delivery_windows: "Time Window",
  account: "Account", contact: "Contact", delivery_phone: "Phone", delivery_notes: "Notes",
  role_notes: "Note", redelivery_reason: "Re-delivery reason", assigned_sales_rep: "Sales Rep", route_seq: "Route order",
};
// Keys that change on nearly every save (recomputed/auto), never worth logging.
const NOISY_KEYS = new Set(["pickup_duration", "delivery_duration", "input_date", "input_time", "updated_at", "route_miles", "route_duration", "route_provider", "route_traffic"]);

/** Human summary of which meaningful fields an update patch actually changes,
 * e.g. "Delivery Date, Assigned Driver". "" if nothing notable changed. */
export function changedFieldsNote(before: Record<string, unknown>, patch: Record<string, unknown>): string {
  const norm = (v: unknown) => (v == null ? "" : String(v));
  const names: string[] = [];
  for (const k of Object.keys(patch)) {
    if (NOISY_KEYS.has(k)) continue;
    if (norm(before?.[k]) === norm(patch[k])) continue;
    names.push(FIELD_LABELS[k] ?? k);
  }
  return names.length ? `Changed: ${names.join(", ")}` : "";
}

export function deliveryColumns(d: Delivery): [string, string][] {
  // Order matters: the read view renders these row-major into two columns, so
  // each adjacent pair below is one left/right row in the order form.
  return [
    ["ID", orderLabel(d)],
    // — header / order identity —
    ["Input Date", d.input_date ?? ""],
    ["Input Military Time", fmtMilitary(d.input_time)],
    ["Order Type", d.order_type ?? ""],
    ["Store (Sold From)", d.store ?? ""],
    ["PO #", d.po2 ?? ""],
    ["SO #", d.so_num ?? ""],
    ["Invoice #", d.invoice_num ?? ""],
    ["Estimate #", d.estimate_num ?? ""],
    ["Est. Pallets (sales)", d.est_pallets == null ? "" : String(d.est_pallets)],
    ["Actual Pallets (warehouse)", d.actual_pallets == null ? "" : String(d.actual_pallets)],
    // — pickup —
    ["Pickup Name", d.pickup_name ?? ""],
    ["Pickup Address", d.pickup_address ?? ""],
    ["Delivery Date", d.delivery_date ?? ""],
    ["Pickup Duration", d.pickup_duration ?? ""],
    // — route / delivery —
    ["Route Miles", d.route_miles == null ? "" : `${d.route_miles} mi`],
    ["Est. Travel Time", d.route_duration ?? ""],
    ["Delivery Military Time Windows", fmtWindows(d.delivery_windows)],
    ["Delivery Duration", d.delivery_duration ?? ""],
    ["Delivery Fee", d.delivery_fee == null ? "" : fmtMoney(d.delivery_fee)],
    ["Delivery Address", d.delivery_address ?? ""],
    // — customer —
    ["Account", d.account ?? ""],
    ["Contact", d.contact ?? ""],
    ["Delivery Phone Number", d.delivery_phone ?? ""],
    ["Delivery Notes", d.delivery_notes ?? ""],
    // — hide-when-empty extras kept last so they never break the pairing above —
    ["Assigned Driver", d.assigned_driver ?? ""],
    ["Re-delivery reason", d.redelivery_reason ?? ""],
  ];
}
