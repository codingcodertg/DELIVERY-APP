import { test, expect } from "vitest";
import {
  isOnDay,
  outcomeDueAt,
  awaitingOutcome,
  outcomeDue,
  sinceLabel,
  todayLists,
  OUTCOME_GRACE_HOURS,
  type TodayCandidate,
} from "./recruiting-today";
import type { Stage } from "./recruiting-board";

const STAGES: Stage[] = [
  { key: "registered", label: "Registered", type: "active" },
  { key: "inperson", label: "In person", type: "active" },
  { key: "hired", label: "Hired", type: "won" },
  { key: "discarded", label: "Discarded", type: "lost" },
];
const DAY = "2026-03-10";
const NOW = new Date("2026-03-10T18:00:00Z");

const c = (o: Partial<TodayCandidate> = {}): TodayCandidate => ({
  id: "c1",
  name: "Ana",
  status: "registered",
  ...o,
});

test("a day match compares calendar dates, not runtime local time", () => {
  // The source used the runtime's local date, which files a 7pm Central interview under tomorrow on
  // a UTC server. Same class of bug as the on-time calculation.
  expect(isOnDay("2026-03-10T23:30:00Z", DAY)).toBe(true);
  expect(isOnDay("2026-03-10", DAY)).toBe(true);
  expect(isOnDay("2026-03-11T00:30:00Z", DAY)).toBe(false);
  expect(isOnDay(null, DAY)).toBe(false);
});

test("the outcome clock starts after the interview, plus a grace period", () => {
  expect(OUTCOME_GRACE_HOURS).toBe(3);
  const due = outcomeDueAt(c({ inperson_date: "2026-03-10T12:00:00Z" }));
  expect(due?.toISOString()).toBe("2026-03-10T15:00:00.000Z");
  expect(outcomeDueAt(c())).toBeNull();
});

test("only an un-judged in-person candidate is awaiting an outcome", () => {
  expect(awaitingOutcome(c({ status: "inperson", inperson_date: "2026-03-10T12:00:00Z" }))).toBe(true);
  // Moved on: somebody has already decided.
  expect(awaitingOutcome(c({ status: "hired", inperson_date: "2026-03-10T12:00:00Z" }))).toBe(false);
  // Archived: not anybody's task any more.
  expect(awaitingOutcome(c({ status: "inperson", inperson_date: "2026-03-10T12:00:00Z", archived: true }))).toBe(false);
  expect(awaitingOutcome(c({ status: "inperson" }))).toBe(false);
});

test("an outcome nags only once the grace period has passed", () => {
  const cand = c({ status: "inperson", inperson_date: "2026-03-10T16:00:00Z" });
  // 18:00 is only two hours after; still inside the grace.
  expect(outcomeDue(cand, NOW)).toBe(false);
  expect(outcomeDue(cand, new Date("2026-03-10T19:01:00Z"))).toBe(true);
});

test("sinceLabel reads at the right scale, and refuses the future", () => {
  const t0 = new Date("2026-03-10T12:00:00Z");
  expect(sinceLabel(t0, new Date("2026-03-10T12:30:00Z"))).toBe("30m");
  expect(sinceLabel(t0, new Date("2026-03-10T14:10:00Z"))).toBe("2h 10m");
  expect(sinceLabel(t0, new Date("2026-03-13T16:00:00Z"))).toBe("3d 4h");
  expect(sinceLabel(t0, new Date("2026-03-10T11:00:00Z"))).toBe("—");
});

// --- the lists ---------------------------------------------------------------
test("today's interviews include both kinds, in time order", () => {
  const out = todayLists(
    [
      c({ id: "a", phone_date: "2026-03-10T14:00:00Z" }),
      c({ id: "b", inperson_date: "2026-03-10T09:00:00Z", status: "inperson" }),
      c({ id: "c", phone_date: "2026-03-11T09:00:00Z" }),
    ],
    STAGES, DAY, NOW
  );
  expect(out.interviews.map((e) => [e.candidate.id, e.kind])).toEqual([["b", "inperson"], ["a", "phone"]]);
});

test("one candidate with both interviews on the same day appears twice", () => {
  // Two separate things to attend, so two rows — collapsing them would hide one.
  const out = todayLists(
    [c({ id: "a", phone_date: "2026-03-10T09:00:00Z", inperson_date: "2026-03-10T15:00:00Z" })],
    STAGES, DAY, NOW
  );
  expect(out.interviews).toHaveLength(2);
});

test("overdue follow-ups still count as due", () => {
  const out = todayLists(
    [c({ id: "old", follow_up: "2026-03-01" }), c({ id: "today", follow_up: DAY }), c({ id: "later", follow_up: "2026-03-20" })],
    STAGES, DAY, NOW
  );
  expect(out.followUps.map((x) => x.id)).toEqual(["old", "today"]);
});

test("a follow-up on somebody already hired or discarded is not chased", () => {
  const out = todayLists(
    [c({ id: "h", follow_up: "2026-03-01", status: "hired" }), c({ id: "d", follow_up: "2026-03-01", status: "discarded" })],
    STAGES, DAY, NOW
  );
  expect(out.followUps).toEqual([]);
});

test("awaiting a first call means registered with no phone screen booked", () => {
  const out = todayLists(
    [
      c({ id: "new", status: "registered", reg_date: "2026-03-02" }),
      c({ id: "older", status: "registered", reg_date: "2026-03-01" }),
      c({ id: "booked", status: "registered", phone_date: "2026-03-12T09:00:00Z" }),
    ],
    STAGES, DAY, NOW
  );
  // Oldest first: the person waiting longest is chased first.
  expect(out.awaitingFirstCall.map((x) => x.id)).toEqual(["older", "new"]);
});

test("archived candidates are absent from every list", () => {
  const out = todayLists(
    [
      c({ id: "x", archived: true, phone_date: "2026-03-10T09:00:00Z", follow_up: "2026-03-01",
          status: "registered" }),
    ],
    STAGES, DAY, NOW
  );
  expect(out.total).toBe(0);
});

test("the total is the sum of the four lists", () => {
  const out = todayLists(
    [
      c({ id: "i", phone_date: "2026-03-10T09:00:00Z" }),
      c({ id: "o", status: "inperson", inperson_date: "2026-03-10T09:00:00Z" }),
      c({ id: "f", follow_up: "2026-03-01" }),
      c({ id: "n", status: "registered", reg_date: "2026-03-01" }),
    ],
    STAGES, DAY, NOW
  );
  expect(out.total).toBe(
    out.interviews.length + out.outcomesDue.length + out.followUps.length + out.awaitingFirstCall.length
  );
});
