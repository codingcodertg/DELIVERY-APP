import { test, expect } from "vitest";
import {
  weekdayOfISO,
  shiftISO,
  weekStartISO,
  weekEndISO,
  addWeeks,
  weekLabel,
  weekIsFinished,
  computePay,
  groupByDay,
  secondsByAssignment,
  type WeekSession,
} from "./timetracker-week";

// 2026-03-10 is a Tuesday.
test("weekday comes from the date itself, not the runtime timezone", () => {
  expect(weekdayOfISO("2026-03-08")).toBe(0); // Sunday
  expect(weekdayOfISO("2026-03-10")).toBe(2); // Tuesday
  expect(weekdayOfISO("2026-03-14")).toBe(6); // Saturday
});

test("shifting dates crosses months and years correctly", () => {
  expect(shiftISO("2026-03-31", 1)).toBe("2026-04-01");
  expect(shiftISO("2026-01-01", -1)).toBe("2025-12-31");
  expect(shiftISO("2028-02-28", 1)).toBe("2028-02-29"); // leap year
});

test("the pay week starts on the configured day", () => {
  // Sunday-start: Tuesday belongs to the week beginning Sunday the 8th.
  expect(weekStartISO("2026-03-10", 0)).toBe("2026-03-08");
  // Monday-start: the same Tuesday belongs to the week beginning Monday the 9th.
  expect(weekStartISO("2026-03-10", 1)).toBe("2026-03-09");
  // Saturday-start: it belongs to the week beginning Saturday the 7th.
  expect(weekStartISO("2026-03-10", 6)).toBe("2026-03-07");
});

test("a date that IS the week start stays put", () => {
  expect(weekStartISO("2026-03-08", 0)).toBe("2026-03-08");
  expect(weekStartISO("2026-03-07", 6)).toBe("2026-03-07");
});

test("a week is seven days, and stepping moves by seven", () => {
  expect(weekEndISO("2026-03-08")).toBe("2026-03-14");
  expect(addWeeks("2026-03-08", 1)).toBe("2026-03-15");
  expect(addWeeks("2026-03-08", -1)).toBe("2026-03-01");
});

test("the label spans the week and carries the ending year", () => {
  expect(weekLabel("2026-03-08")).toBe("Mar 8 – Mar 14, 2026");
  // A week that straddles New Year is labelled with the year it ends in.
  expect(weekLabel("2025-12-28")).toBe("Dec 28 – Jan 3, 2026");
});

test("a week is finished only once its LAST day has passed", () => {
  // Mid-week is not finished — pay must not be treated as final while hours can still be added.
  expect(weekIsFinished("2026-03-08", "2026-03-10")).toBe(false);
  expect(weekIsFinished("2026-03-08", "2026-03-14")).toBe(false);
  expect(weekIsFinished("2026-03-08", "2026-03-15")).toBe(true);
});

// --- pay ---------------------------------------------------------------------
const RATE = { hourly_rate: 20, overtime_rate: 30, overtime_threshold: 40, weekly_limit: 50 };

test("ordinary hours pay at the normal rate", () => {
  const p = computePay(35, RATE);
  expect(p.reg).toBe(35);
  expect(p.ot).toBe(0);
  expect(p.pay).toBe(700);
});

test("hours past the threshold pay overtime", () => {
  const p = computePay(45, RATE);
  expect(p.reg).toBe(40);
  expect(p.ot).toBe(5);
  expect(p.pay).toBe(40 * 20 + 5 * 30);
});

test("the weekly limit caps pay, and the excess is reported rather than hidden", () => {
  // 60 worked, 50 payable: 40 regular + 10 overtime, and 10 hours somebody needs to see.
  const p = computePay(60, RATE);
  expect(p.billable).toBe(50);
  expect(p.overLimit).toBe(10);
  expect(p.reg).toBe(40);
  expect(p.ot).toBe(10);
  expect(p.pay).toBe(40 * 20 + 10 * 30);
});

test("the limit is applied BEFORE overtime, not after", () => {
  // The order is the whole point: applying overtime first would pay OT on hours the limit says are
  // not payable, inflating the total.
  const p = computePay(60, RATE);
  expect(p.reg + p.ot).toBe(p.billable);
});

test("a blank threshold or limit means no cap, not zero", () => {
  // Treating an empty field as 0 would reduce everyone to no billable hours while looking numeric.
  const p = computePay(60, { hourly_rate: 20, overtime_threshold: "", weekly_limit: "" });
  expect(p.billable).toBe(60);
  expect(p.overLimit).toBe(0);
  expect(p.ot).toBe(0);
  expect(p.pay).toBe(1200);
});

test("a null threshold or limit behaves the same as blank", () => {
  const p = computePay(60, { hourly_rate: 20, overtime_threshold: null, weekly_limit: null });
  expect(p.billable).toBe(60);
  expect(p.pay).toBe(1200);
});

test("a missing overtime rate falls back to the normal rate", () => {
  // Never pays MORE by accident when a setting is absent.
  const p = computePay(45, { hourly_rate: 20, overtime_threshold: 40 });
  expect(p.otRate).toBe(20);
  expect(p.pay).toBe(45 * 20);
});

test("no rate at all is no pay, not NaN", () => {
  const p = computePay(40, {});
  expect(p.pay).toBe(0);
  expect(Number.isNaN(p.pay)).toBe(false);
});

test("zero hours pays nothing", () => {
  expect(computePay(0, RATE).pay).toBe(0);
});

// --- grouping ----------------------------------------------------------------
const S = (o: Partial<WeekSession> & { id: string }): WeekSession => ({ ...o });

test("days come newest first, entries within a day in the order they happened", () => {
  const groups = groupByDay([
    S({ id: "1", date: "2026-03-09", duration_seconds: 3600, start_ms: 200 }),
    S({ id: "2", date: "2026-03-10", duration_seconds: 1800, start_ms: 100 }),
    S({ id: "3", date: "2026-03-09", duration_seconds: 600, start_ms: 100 }),
  ]);
  expect(groups.map((g) => g.date)).toEqual(["2026-03-10", "2026-03-09"]);
  expect(groups[1].seconds).toBe(4200);
  expect(groups[1].items.map((i) => i.id)).toEqual(["3", "1"]);
});

test("grouping does not mutate the input", () => {
  const input = [S({ id: "1", date: "d", start_ms: 2 }), S({ id: "2", date: "d", start_ms: 1 })];
  const before = JSON.parse(JSON.stringify(input));
  groupByDay(input);
  expect(JSON.parse(JSON.stringify(input))).toEqual(before);
});

test("seconds are totalled per assignment, including unassigned work", () => {
  const by = secondsByAssignment([
    S({ id: "1", assignment_id: "a", duration_seconds: 100 }),
    S({ id: "2", assignment_id: "a", duration_seconds: 50 }),
    S({ id: "3", assignment_id: null, duration_seconds: 25 }),
  ]);
  expect(by.get("a")).toBe(150);
  // Unassigned time is kept under "" rather than dropped — hours that vanish are worse than hours
  // that need explaining.
  expect(by.get("")).toBe(25);
});

test("a session with no duration counts as zero, not NaN", () => {
  const by = secondsByAssignment([S({ id: "1", assignment_id: "a", duration_seconds: null })]);
  expect(by.get("a")).toBe(0);
});
