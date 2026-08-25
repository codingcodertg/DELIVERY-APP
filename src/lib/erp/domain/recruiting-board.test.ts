import { test, expect } from "vitest";
import {
  terminalKeys,
  isOverdue,
  daysInStage,
  slaExceeded,
  scorePct,
  fmtPct,
  scoreColor,
  avatarColor,
  initials,
  boardColumns,
  MAX_SCORE,
  RECRUITER_MAX_SCORE,
  type BoardCandidate,
  type Stage,
} from "./recruiting-board";

const STAGES: Stage[] = [
  { key: "new", label: "New", type: "active", max_days: 3 },
  { key: "screen", label: "Screening", type: "active", max_days: null },
  { key: "hired", label: "Hired", type: "won" },
  { key: "discarded", label: "Discarded", type: "lost" },
];
const NOW = new Date("2026-03-10T12:00:00Z");
const TERM = terminalKeys(STAGES);

const cand = (o: Partial<BoardCandidate> = {}): BoardCandidate => ({
  id: "c1",
  name: "Ana Reyes",
  status: "new",
  ...o,
});

test("terminal stages are everything not active", () => {
  expect([...TERM].sort()).toEqual(["discarded", "hired"]);
});

test("a past phone date with no interview is overdue", () => {
  expect(isOverdue(cand({ phone_date: "2026-03-09T10:00:00Z" }), TERM, NOW)).toBe(true);
});

test("once interviewed, a past phone date is history rather than a task", () => {
  expect(
    isOverdue(cand({ phone_date: "2026-03-09T10:00:00Z", interview: { average: 3 } }), TERM, NOW)
  ).toBe(false);
});

test("nobody in a terminal stage is overdue", () => {
  // Nobody is waiting on a call to someone already hired.
  expect(isOverdue(cand({ status: "hired", phone_date: "2026-03-09T10:00:00Z" }), TERM, NOW)).toBe(false);
});

test("a future phone date is not overdue, and no date never is", () => {
  expect(isOverdue(cand({ phone_date: "2026-03-11T10:00:00Z" }), TERM, NOW)).toBe(false);
  expect(isOverdue(cand(), TERM, NOW)).toBe(false);
});

test("days in stage counts whole days, and an unset date is zero", () => {
  expect(daysInStage("2026-03-06T12:00:00Z", NOW)).toBe(4);
  expect(daysInStage(null, NOW)).toBe(0);
  expect(daysInStage(undefined, NOW)).toBe(0);
});

test("SLA fires only past the stage's own limit", () => {
  expect(slaExceeded(cand({ stage_changed_at: "2026-03-05T12:00:00Z" }), STAGES, NOW)).toBe(true);
  expect(slaExceeded(cand({ stage_changed_at: "2026-03-08T12:00:00Z" }), STAGES, NOW)).toBe(false);
});

test("a stage with no limit, a terminal stage, or an unknown one never breaches", () => {
  expect(slaExceeded(cand({ status: "screen", stage_changed_at: "2020-01-01T00:00:00Z" }), STAGES, NOW)).toBe(false);
  expect(slaExceeded(cand({ status: "hired", stage_changed_at: "2020-01-01T00:00:00Z" }), STAGES, NOW)).toBe(false);
  expect(slaExceeded(cand({ status: "nope" }), STAGES, NOW)).toBe(false);
});

test("score percentages use the interview scale, not the recruiter one", () => {
  // Dividing by 5 here would understate every score on the board, plausibly.
  expect(MAX_SCORE).toBe(4);
  expect(RECRUITER_MAX_SCORE).toBe(5);
  expect(scorePct(4)).toBe(100);
  expect(scorePct(3)).toBe(75);
  expect(scorePct(2)).toBe(50);
});

test("an absent or zero score has no percentage", () => {
  expect(scorePct(null)).toBeNull();
  expect(scorePct(0)).toBeNull();
  expect(fmtPct(null)).toBe("—");
  expect(fmtPct(3)).toBe("75%");
});

test("score colour bands", () => {
  expect(scoreColor(3.5)).toBe("var(--green)");
  expect(scoreColor(2.5)).toBe("var(--amber)");
  expect(scoreColor(2.4)).toBe("var(--red)");
  expect(scoreColor(null)).toBe("var(--gray)");
});

test("a name always gets the same avatar colour", () => {
  expect(avatarColor("Ana Reyes")).toBe(avatarColor("Ana Reyes"));
  expect(avatarColor("")).toBeTruthy();
});

test("initials take the first two words, uppercased", () => {
  expect(initials("ana reyes")).toBe("AR");
  expect(initials("Ana")).toBe("A");
  expect(initials("")).toBe("?");
  expect(initials("  ana   maria reyes ")).toBe("AM");
});

test("columns follow stage order and hide archived candidates", () => {
  const cols = boardColumns(STAGES, [
    cand({ id: "a", status: "new" }),
    cand({ id: "b", status: "new", archived: true }),
    cand({ id: "c", status: "hired" }),
  ]);
  expect(cols.map((c) => c.stage.key)).toEqual(["new", "screen", "hired", "discarded"]);
  expect(cols[0].cards.map((c) => c.id)).toEqual(["a"]);
  expect(cols[2].cards.map((c) => c.id)).toEqual(["c"]);
});

test("a candidate in no known stage appears in no column", () => {
  // Better an empty board than a card silently filed under the wrong heading.
  const cols = boardColumns(STAGES, [cand({ id: "x", status: "unknown-stage" })]);
  expect(cols.every((c) => c.cards.length === 0)).toBe(true);
});
