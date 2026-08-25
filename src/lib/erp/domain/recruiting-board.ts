// The recruiting board's own rules. Ported from the recruiting app (ADR 0010).

/**
 * Interview scoring runs 1..4. The recruiter's separate gut-feel score runs 1..5.
 *
 * Two scales, kept apart on purpose: dividing an interview average by 5 would understate every
 * percentage on the board, and it would look plausible while doing it.
 */
export const MAX_SCORE = 4;
export const RECRUITER_MAX_SCORE = 5;

export const CALL_AGAIN_TAG = "Call again";

export interface Stage {
  key: string;
  label: string;
  color?: string | null;
  type?: string | null;
  sort?: number | null;
  max_days?: number | null;
}

export interface BoardCandidate {
  id: string;
  name: string;
  status: string;
  role?: string | null;
  location?: string | null;
  home_location?: string | null;
  phone?: string | null;
  phone_date?: string | null;
  stage_changed_at?: string | null;
  archived?: boolean | null;
  favorite?: boolean | null;
  tags?: string[] | null;
  summary_sent?: boolean | null;
  interview?: { average?: number | null; recruiterScore?: number | null } | null;
}

/** Stages that end the pipeline: anything not "active". Nothing is chased once it lands in one. */
export function terminalKeys(stages: Stage[]): Set<string> {
  return new Set(stages.filter((s) => s.type !== "active").map((s) => s.key));
}

/**
 * A phone screen that was due and has not happened.
 *
 * Deliberately requires no interview yet: once somebody has actually been interviewed, a past phone
 * date is history rather than a task. And nobody in a terminal stage is overdue, because nobody is
 * waiting on a call to a person already hired or discarded.
 */
export function isOverdue(
  c: BoardCandidate,
  terminal?: Set<string>,
  now: Date = new Date()
): boolean {
  const isTerminal = terminal
    ? terminal.has(c.status)
    : c.status === "discarded" || c.status === "hired";
  return !!c.phone_date && !c.interview && new Date(c.phone_date) < now && !isTerminal;
}

export function daysInStage(
  stageChangedAt: string | null | undefined,
  now: Date = new Date()
): number {
  if (!stageChangedAt) return 0;
  return Math.floor((now.getTime() - new Date(stageChangedAt).getTime()) / 864e5);
}

/** Sitting in an active stage longer than that stage allows. Only active stages carry a limit. */
export function slaExceeded(c: BoardCandidate, stages: Stage[], now: Date = new Date()): boolean {
  const st = stages.find((s) => s.key === c.status);
  if (!st || st.type !== "active" || st.max_days == null) return false;
  return daysInStage(c.stage_changed_at, now) > st.max_days;
}

export function scorePct(avg: number | null | undefined): number | null {
  if (avg == null || avg <= 0) return null;
  return Math.round((avg / MAX_SCORE) * 100);
}

export function fmtPct(avg: number | null | undefined, dash = "—"): string {
  const p = scorePct(avg);
  return p == null ? dash : p + "%";
}

export function scoreColor(avg: number | null | undefined): string {
  if (avg == null) return "var(--gray)";
  return avg >= 3.5 ? "var(--green)" : avg >= 2.5 ? "var(--amber)" : "var(--red)";
}

const AVATAR_COLORS = ["#2456c9", "#7c4dbc", "#0f8a8a", "#e9a13b", "#1f9d61", "#d64545", "#3d4d68"];

/** Stable colour from the name, so a person keeps the same avatar on every screen. */
export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

/** The board's columns, in stage order, each with the candidates that belong to it. */
export function boardColumns<T extends BoardCandidate>(
  stages: Stage[],
  candidates: T[]
): { stage: Stage; cards: T[] }[] {
  return stages.map((s) => ({
    stage: s,
    // Archived candidates are hidden here, not deleted. The Candidates screen has a filter that
    // brings them back, which is why archiving is safe to offer as a one-click action.
    cards: candidates.filter((c) => c.status === s.key && !c.archived),
  }));
}
