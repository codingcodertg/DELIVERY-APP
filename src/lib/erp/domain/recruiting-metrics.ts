// Recruiting reporting: the funnel, where candidates come from, and who is working them.
// Ported from the recruiting app (ADR 0010).

import type { Stage, BoardCandidate } from "./recruiting-board";

export interface MetricCandidate extends BoardCandidate {
  reg_date?: string | null;
  source?: string | null;
  assigned_recruiter?: string | null;
  interview?: { average?: number | null; recruiterScore?: number | null; date?: string | null } | null;
}

/** The stage a "hired" or "discarded" outcome actually lives in, resolved by TYPE not key. */
export function wonStage(stages: Stage[]): Stage | undefined {
  return stages.find((s) => s.type === "won");
}
export function lostStage(stages: Stage[]): Stage | undefined {
  return stages.find((s) => s.type === "lost");
}

/**
 * The funnel: active stages in their configured order, then won, then lost.
 *
 * Resolved by type rather than by key, which is the source's own choice and worth keeping — renaming
 * "Hired" in Settings would otherwise silently empty this report rather than renaming a row.
 */
export function funnelStages(stages: Stage[]): Stage[] {
  const won = wonStage(stages);
  const lost = lostStage(stages);
  return [...stages.filter((s) => s.type === "active"), ...(won ? [won] : []), ...(lost ? [lost] : [])];
}

export function countsByStage(candidates: MetricCandidate[], stages: Stage[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of stages) out[s.key] = 0;
  for (const c of candidates) {
    // A candidate whose status is not one of the configured stages is counted nowhere rather than
    // into a stage it does not belong to. The funnel adding up to less than the total is a visible
    // problem; a row silently inflated is not.
    if (Object.prototype.hasOwnProperty.call(out, c.status)) out[c.status]++;
  }
  return out;
}

export interface Headline {
  total: number;
  hired: number;
  discarded: number;
  interviewed: number;
  hiredPct: number;
  avgScore: number | null;
  avgDaysToInterview: number | null;
}

const scoreOf = (c: MetricCandidate) => {
  const n = c.interview?.average;
  return n == null || !Number.isFinite(Number(n)) ? null : Number(n);
};

/**
 * Days from registering to being interviewed.
 *
 * Both ends are calendar dates, so the gap is computed from date parts rather than by subtracting
 * two parsed timestamps — the source parses `reg_date + "T12:00:00"` in the runtime's zone, which
 * makes the answer depend on where the report runs.
 */
export function daysBetweenISO(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split("-").map(Number);
  const [by, bm, bd] = b.slice(0, 10).split("-").map(Number);
  if (!ay || !by) return 0;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 864e5);
}

export function headline(candidates: MetricCandidate[], stages: Stage[]): Headline {
  const won = wonStage(stages);
  const lost = lostStage(stages);
  const total = candidates.length;
  const hired = won ? candidates.filter((c) => c.status === won.key).length : 0;
  const discarded = lost ? candidates.filter((c) => c.status === lost.key).length : 0;
  const interviewed = candidates.filter((c) => c.interview).length;

  const scores = candidates.map(scoreOf).filter((n): n is number => n != null);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const gaps = candidates
    .filter((c) => c.interview?.date && c.reg_date)
    .map((c) => Math.max(0, daysBetweenISO(c.reg_date!, c.interview!.date!)));
  const avgDaysToInterview = gaps.length
    ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
    : null;

  return {
    total,
    hired,
    discarded,
    interviewed,
    hiredPct: total ? Math.round((hired / total) * 100) : 0,
    avgScore,
    avgDaysToInterview,
  };
}

export interface SourceStat {
  name: string;
  total: number;
  hired: number;
  /** Percentage of this source's candidates who were hired. */
  rate: number;
  avgScore: number | null;
}

/**
 * Which sources actually produce hires, not merely applicants.
 *
 * Ranked by hire RATE first and volume second, because a source sending 200 people of whom none are
 * hired is a cost, not a channel — and ranking by volume alone would put it top.
 */
export function sourceStats(candidates: MetricCandidate[], stages: Stage[]): SourceStat[] {
  const won = wonStage(stages);
  const groups = new Map<string, MetricCandidate[]>();
  for (const c of candidates) {
    const name = (c.source ?? "").trim() || "—";
    const list = groups.get(name);
    if (list) list.push(c);
    else groups.set(name, [c]);
  }
  return [...groups.entries()]
    .map(([name, list]) => {
      const hired = won ? list.filter((c) => c.status === won.key).length : 0;
      const scored = list.map(scoreOf).filter((n): n is number => n != null);
      return {
        name,
        total: list.length,
        hired,
        rate: list.length ? Math.round((hired / list.length) * 100) : 0,
        avgScore: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null,
      };
    })
    .sort((a, b) => b.rate - a.rate || b.hired - a.hired || b.total - a.total);
}

export interface RecruiterStat {
  recruiter: string;
  total: number;
  hired: number;
}

/** Load and outcome per recruiter, busiest first. Unassigned is a row, not a gap. */
export function recruiterStats(
  candidates: MetricCandidate[],
  stages: Stage[],
  nameOf: (id: string | null | undefined) => string
): RecruiterStat[] {
  const won = wonStage(stages);
  const by = new Map<string, RecruiterStat>();
  for (const c of candidates) {
    const who = nameOf(c.assigned_recruiter);
    const s = by.get(who) ?? { recruiter: who, total: 0, hired: 0 };
    s.total++;
    if (won && c.status === won.key) s.hired++;
    by.set(who, s);
  }
  return [...by.values()].sort((a, b) => b.total - a.total || b.hired - a.hired);
}

/** Candidates registered within [from, to]. An undated candidate is excluded, never assumed today. */
export function inDateRange<T extends MetricCandidate>(candidates: T[], from: string, to: string): T[] {
  return candidates.filter((c) => {
    const d = (c.reg_date ?? "").slice(0, 10);
    return !!d && d >= from && d <= to;
  });
}
