import { test, expect } from "vitest";
import {
  wonStage,
  lostStage,
  funnelStages,
  countsByStage,
  daysBetweenISO,
  headline,
  sourceStats,
  recruiterStats,
  inDateRange,
  type MetricCandidate,
} from "./recruiting-metrics";
import type { Stage } from "./recruiting-board";

const STAGES: Stage[] = [
  { key: "registered", label: "Registered", type: "active", sort: 1 },
  { key: "screen", label: "Screening", type: "active", sort: 2 },
  { key: "inperson", label: "In person", type: "active", sort: 3 },
  { key: "hired", label: "Hired", type: "won", sort: 4 },
  { key: "discarded", label: "Discarded", type: "lost", sort: 5 },
];

const c = (o: Partial<MetricCandidate> = {}): MetricCandidate => ({
  id: "c1",
  name: "Ana",
  status: "registered",
  ...o,
});

test("won and lost are resolved by type, not by key", () => {
  // Renaming "Hired" in Settings must not silently empty the report.
  expect(wonStage(STAGES)?.key).toBe("hired");
  expect(lostStage(STAGES)?.key).toBe("discarded");
  const renamed: Stage[] = [{ key: "placed", label: "Placed", type: "won" }];
  expect(wonStage(renamed)?.key).toBe("placed");
});

test("the funnel is the active stages, then won, then lost", () => {
  expect(funnelStages(STAGES).map((s) => s.key)).toEqual([
    "registered", "screen", "inperson", "hired", "discarded",
  ]);
});

test("a workspace with no terminal stages still produces a funnel", () => {
  const onlyActive: Stage[] = [{ key: "a", label: "A", type: "active" }];
  expect(funnelStages(onlyActive).map((s) => s.key)).toEqual(["a"]);
});

test("counts cover every stage, including the empty ones", () => {
  const counts = countsByStage([c({ status: "hired" })], STAGES);
  expect(counts).toEqual({ registered: 0, screen: 0, inperson: 0, hired: 1, discarded: 0 });
});

test("a candidate in an unknown stage is counted nowhere, not somewhere wrong", () => {
  // The funnel summing to less than the total is visible; an inflated row is not.
  const counts = countsByStage([c({ status: "ghost-stage" })], STAGES);
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
});

test("days between two dates does not depend on where the report runs", () => {
  // The source parses reg_date + "T12:00:00" in the runtime's zone. Same class of bug as the
  // on-time calculation; computed from date parts here.
  expect(daysBetweenISO("2026-03-01", "2026-03-10")).toBe(9);
  expect(daysBetweenISO("2026-03-01T23:59:00Z", "2026-03-02T00:01:00Z")).toBe(1);
  expect(daysBetweenISO("2026-02-27", "2026-03-01")).toBe(2);
  expect(daysBetweenISO("2028-02-27", "2028-03-01")).toBe(3); // leap year
});

test("headline counts hires, discards and interviews", () => {
  const h = headline(
    [
      c({ id: "1", status: "hired", interview: { average: 4 } }),
      c({ id: "2", status: "discarded" }),
      c({ id: "3", status: "screen", interview: { average: 2 } }),
      c({ id: "4", status: "registered" }),
    ],
    STAGES
  );
  expect(h.total).toBe(4);
  expect(h.hired).toBe(1);
  expect(h.discarded).toBe(1);
  expect(h.interviewed).toBe(2);
  expect(h.hiredPct).toBe(25);
  expect(h.avgScore).toBe(3);
});

test("an empty pipeline reports nothing rather than dividing by zero", () => {
  const h = headline([], STAGES);
  expect(h).toEqual({
    total: 0, hired: 0, discarded: 0, interviewed: 0,
    hiredPct: 0, avgScore: null, avgDaysToInterview: null,
  });
});

test("days to interview averages only candidates who have both dates", () => {
  const h = headline(
    [
      c({ id: "1", reg_date: "2026-03-01", interview: { date: "2026-03-05" } }),
      c({ id: "2", reg_date: "2026-03-01", interview: { date: "2026-03-09" } }),
      c({ id: "3", reg_date: "2026-03-01" }),             // never interviewed
      c({ id: "4", interview: { date: "2026-03-09" } }),  // no registration date
    ],
    STAGES
  );
  expect(h.avgDaysToInterview).toBe(6);
});

test("an interview dated before registration counts as zero days, not negative", () => {
  const h = headline(
    [c({ reg_date: "2026-03-10", interview: { date: "2026-03-01" } })],
    STAGES
  );
  expect(h.avgDaysToInterview).toBe(0);
});

test("sources rank by hire RATE, not by volume", () => {
  // A source sending 200 people and hiring none is a cost, not a channel.
  const stats = sourceStats(
    [
      ...Array.from({ length: 8 }, (_, i) => c({ id: "loud" + i, source: "Job board", status: "discarded" })),
      c({ id: "r1", source: "Referral", status: "hired" }),
      c({ id: "r2", source: "Referral", status: "screen" }),
    ],
    STAGES
  );
  expect(stats[0].name).toBe("Referral");
  expect(stats[0].rate).toBe(50);
  expect(stats[1].name).toBe("Job board");
  expect(stats[1].rate).toBe(0);
});

test("a blank source becomes one bucket rather than several", () => {
  const stats = sourceStats(
    [c({ id: "1", source: null }), c({ id: "2", source: "" }), c({ id: "3", source: "   " })],
    STAGES
  );
  expect(stats).toHaveLength(1);
  expect(stats[0]).toMatchObject({ name: "—", total: 3 });
});

test("recruiters rank by load, and unassigned is a row", () => {
  const nameOf = (id: string | null | undefined) => id ?? "Unassigned";
  const stats = recruiterStats(
    [
      c({ id: "1", assigned_recruiter: "r1", status: "hired" }),
      c({ id: "2", assigned_recruiter: "r1" }),
      c({ id: "3", assigned_recruiter: null }),
    ],
    STAGES,
    nameOf
  );
  expect(stats[0]).toEqual({ recruiter: "r1", total: 2, hired: 1 });
  expect(stats[1]).toEqual({ recruiter: "Unassigned", total: 1, hired: 0 });
});

test("the date range excludes undated candidates rather than assuming today", () => {
  const out = inDateRange(
    [
      c({ id: "in", reg_date: "2026-03-05" }),
      c({ id: "before", reg_date: "2026-02-28" }),
      c({ id: "after", reg_date: "2026-04-01" }),
      c({ id: "undated" }),
    ],
    "2026-03-01",
    "2026-03-31"
  );
  expect(out.map((x) => x.id)).toEqual(["in"]);
});

test("range bounds are inclusive on both ends", () => {
  const out = inDateRange(
    [c({ id: "first", reg_date: "2026-03-01" }), c({ id: "last", reg_date: "2026-03-31" })],
    "2026-03-01",
    "2026-03-31"
  );
  expect(out).toHaveLength(2);
});
