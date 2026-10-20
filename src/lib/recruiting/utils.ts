import type { Candidate, Question, ScaleLevel, Settings, Stage } from "./types";

// Interview scoring is on a 1..MAX_SCORE scale (no weights).
export const MAX_SCORE = 4;

/** Default 1–4 scoring scale. Each level has a bilingual label + example.
 * value 1 = worst … 4 = best. Fully editable in the Questions tab. */
export const DEFAULT_SCALE: ScaleLevel[] = [
  { value: 1, label_en: "Worst", label_es: "Peor", example_en: "No relevant experience; would not consider.", example_es: "Sin experiencia relevante; no se consideraría." },
  { value: 2, label_en: "Bad", label_es: "Malo", example_en: "Below expectations; significant gaps.", example_es: "Debajo de lo esperado; brechas importantes." },
  { value: 3, label_en: "Average", label_es: "Promedio", example_en: "Meets the basics; some gaps.", example_es: "Cumple lo básico; algunas brechas." },
  { value: 4, label_en: "Good", label_es: "Bueno", example_en: "Strong answer; clearly qualified.", example_es: "Respuesta sólida; claramente calificado." },
];

/** The active scale for a question: its own override, else the global scale,
 * else the built-in default. Always returns MAX_SCORE levels. */
export function scaleFor(question: Pick<Question, "scale"> | null, settings: Pick<Settings, "scale">): ScaleLevel[] {
  const s = (question?.scale && question.scale.length ? question.scale : settings.scale) ?? DEFAULT_SCALE;
  return s.length ? s : DEFAULT_SCALE;
}

/** Label of the level nearest to an average score (replaces the old semaforo). */
export function levelLabel(avg: number | null | undefined, scale: ScaleLevel[], lang: "en" | "es"): string | null {
  if (avg == null) return null;
  const lvl = scale.find((l) => l.value === Math.round(avg)) ?? scale[scale.length - 1];
  return lang === "es" ? lvl.label_es : lvl.label_en;
}

/** Localized text of an interview question; falls back to English when the
 * Spanish translation is empty. */
export function qText(q: Pick<Question, "text" | "text_es">, lang: "en" | "es"): string {
  return lang === "es" ? (q.text_es?.trim() || q.text) : q.text;
}

/** Keys of terminal stages (won/lost) — candidates there are out of the active pipeline. */
export function terminalKeys(stages: Stage[]): Set<string> {
  return new Set(stages.filter((s) => s.type !== "active").map((s) => s.key));
}

/** True if the candidate has sat in an active stage longer than that stage's SLA. */
export function slaExceeded(c: Candidate, stages: Stage[]): boolean {
  const st = stages.find((s) => s.key === c.status);
  if (!st || st.type !== "active" || st.max_days == null) return false;
  return daysInStage(c.stage_changed_at) > st.max_days;
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

/** Value for an <input type="datetime-local">, in LOCAL time.
 * toISOString() would hand back UTC and shift the clock by the timezone offset. */
export function localDateTimeInput(d: Date = new Date()): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

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

export const telClean = (t: string | null) => (t || "").replace(/[^0-9+]/g, "");

// (WhatsApp helper removed — comms now go through RingCentral, see below.)

// ---- RingCentral deep links --------------------------------------------------
// The RingCentral app registers the `rcapp://` protocol; these links open a call
// or a pre-filled SMS in RingCentral. If your org uses a different scheme, change
// RC_SCHEME (e.g. "rcmobile" for the legacy RingCentral Phone app).
export const RC_SCHEME = "rcapp";

export const rcCall = (phone: string | null) =>
  `${RC_SCHEME}://r/call?number=${encodeURIComponent(telClean(phone))}`;

/** El mensaje va en `content`, no en `text` (D-NEXT, 2026-10-20): la referencia de RingCentral documenta
 *  `/r/sms?type=new&number={phoneNumber}&content={text}`; con `text` la app abría el compositor con el número y sin mensaje
 *  (el dueño: «los templates de los mensajes aún no se pegan automáticamente»). */
export const rcSms = (phone: string | null, text = "") =>
  `${RC_SCHEME}://r/sms?type=new&number=${encodeURIComponent(telClean(phone))}` +
  (text ? `&content=${encodeURIComponent(text)}` : "");

export function isOverdue(c: Candidate, terminal?: Set<string>): boolean {
  const isTerminal = terminal ? terminal.has(c.status) : c.status === "discarded" || c.status === "hired";
  return !!c.phone_date && !c.interview && new Date(c.phone_date) < new Date() && !isTerminal;
}

/** A candidate's interview score, or null when no question was graded.
 * Guards against both shapes: new interviews store null, rows written before
 * 21_interview_null_average.sql stored 0. Grades start at 1, so an average of 0
 * can only mean "nothing scored" and must never be averaged in as a real score. */
export function scoreOf(c: { interview: { average: number | null } | null }): number | null {
  const a = c.interview?.average;
  return a != null && a > 0 ? a : null;
}

/** A 1..MAX_SCORE score as a percentage of the points possible (4/4 = 100%).
 * Grades start at 1, so nothing ever reads below 25% — that is intended: it is
 * "points earned / points possible", not a 0-100 normalization. */
export function scorePct(avg: number | null | undefined): number | null {
  if (avg == null || avg <= 0) return null;
  return Math.round((avg / MAX_SCORE) * 100);
}

/** Display form of a score: "78%", or a dash when nothing was graded. */
export function fmtPct(avg: number | null | undefined, dash = "—"): string {
  const p = scorePct(avg);
  return p == null ? dash : p + "%";
}

/** Inverse of scorePct — turns a percentage typed by the user back into the
 * 1..MAX_SCORE value the database stores. */
export function pctToScore(pct: number): number {
  return (pct / 100) * MAX_SCORE;
}

/** Traffic-light colour for a score — the same thresholds the recommendation
 * text uses (>=3.5 recommend, >=2.5 review with manager, else no). */
export function scoreColor(avg: number | null | undefined): string {
  if (avg == null) return "var(--gray)";
  return avg >= 3.5 ? "var(--green)" : avg >= 2.5 ? "var(--amber)" : "var(--red)";
}

/** Hours after an in-person interview before its outcome must be recorded. */
export const OUTCOME_GRACE_HOURS = 3;

/** When the outcome of a candidate's in-person interview becomes due. */
export function outcomeDueAt(c: Pick<Candidate, "inperson_date">): Date | null {
  if (!c.inperson_date) return null;
  return new Date(new Date(c.inperson_date).getTime() + OUTCOME_GRACE_HOURS * 3600_000);
}

/** Candidate sat an in-person interview and is still parked in that stage, so
 * nobody has recorded what happened yet. Derived — no extra column needed:
 * moving them to hired / standby / discarded is what clears it. */
export function awaitingOutcome(c: Candidate): boolean {
  return !c.archived && !!c.inperson_date && c.status === "inperson";
}

/** Awaiting an outcome AND past the grace period — this is what nags the user. */
export function outcomeDue(c: Candidate, now: Date = new Date()): boolean {
  if (!awaitingOutcome(c)) return false;
  const due = outcomeDueAt(c);
  return !!due && due <= now;
}

/** Rough "2h 10m" / "3d" since a moment passed, for overdue labels. */
export function sinceLabel(iso: string | Date, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (ms < 0) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

export function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

export interface Semaforo {
  label: "Strong" | "Maybe" | "Weak";
  color: string;
}

export function semaforo(p: number | null | undefined): Semaforo | null {
  if (p == null) return null;
  if (p >= 4) return { label: "Strong", color: "var(--green)" };
  if (p >= 3) return { label: "Maybe", color: "var(--amber)" };
  return { label: "Weak", color: "var(--red)" };
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

/** Normalize a name for duplicate detection (lowercase, no accents, single spaces). */
export function normalizeName(name: string): string {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole days the candidate has spent in its current stage. */
export function daysInStage(stageChangedAt: string | null): number {
  if (!stageChangedAt) return 0;
  return Math.floor((Date.now() - new Date(stageChangedAt).getTime()) / 864e5);
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

export const OFFER_STATUS: Record<string, { label: string; color: string }> = {
  none: { label: "No offer", color: "var(--gray)" },
  extended: { label: "Offer extended", color: "var(--accent)" },
  accepted: { label: "Offer accepted", color: "var(--green)" },
  declined: { label: "Offer declined", color: "var(--red)" },
};

export function mergeTemplate(text: string, c: Candidate, recruiter: string): string {
  return (text || "")
    .replace(/\{name\}/g, (c.name || "").split(" ")[0])
    .replace(/\{nombre\}/g, (c.name || "").split(" ")[0])
    .replace(/\{role\}/g, c.role || "")
    .replace(/\{rol\}/g, c.role || "")
    .replace(/\{recruiter\}/g, recruiter || "")
    .replace(/\{reclutador\}/g, recruiter || "")
    .replace(/\{phone\}/g, c.phone || "")
    .replace(/\{telefono\}/g, c.phone || "");
}

/** Unweighted 1..MAX_SCORE average from an answers map. Questions on a
 * descending scale (e.g. RISK, where 1 = No Risk is the best answer) have
 * their grade flipped to the common 1=worst..4=best direction first, so
 * mixing risk-style and performance-style questions still averages correctly. */
export function scoreAverage(
  answers: Record<string, { grade: number | null }>,
  questions: { id: string; scale?: ScaleLevel[] | null }[],
  settings: Pick<Settings, "scale">,
): number | null {
  let sum = 0;
  let n = 0;
  for (const q of questions) {
    const g = answers[q.id]?.grade;
    if (g) {
      const descending = scaleFor(q, settings)[0]?.descending;
      sum += descending ? MAX_SCORE + 1 - g : g;
      n += 1;
    }
  }
  return n ? sum / n : null;
}
