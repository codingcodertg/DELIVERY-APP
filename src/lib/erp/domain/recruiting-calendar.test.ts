import { describe, it, expect } from "vitest";
import {
  interviewEvents,
  monthCells,
  eventsByDay,
  shiftMonth,
  upcomingInterviews,
  type CalendarCandidate,
} from "./recruiting-calendar";

const cand = (over: Partial<CalendarCandidate> & { id: string }): CalendarCandidate => ({
  name: "Ana Reyes",
  role: "Installer",
  phone: "956-555-0100",
  phone_date: null,
  inperson_date: null,
  ...over,
});

describe("interviewEvents", () => {
  it("flattens both interview kinds into separate events", () => {
    const evs = interviewEvents([
      cand({ id: "c1", phone_date: "2026-08-10T15:00:00Z", inperson_date: "2026-08-12T16:00:00Z" }),
    ]);
    expect(evs.map((e) => e.kind)).toEqual(["phone", "inperson"]);
  });

  it("skips a candidate with nothing scheduled", () => {
    expect(interviewEvents([cand({ id: "c1" })])).toEqual([]);
  });

  it("sorts by time across candidates", () => {
    const evs = interviewEvents([
      cand({ id: "late", phone_date: "2026-08-20T15:00:00Z" }),
      cand({ id: "early", phone_date: "2026-08-02T15:00:00Z" }),
    ]);
    expect(evs.map((e) => e.candidateId)).toEqual(["early", "late"]);
  });

  it("resolves the day in BUSINESS time, not UTC", () => {
    // 2026-08-11T02:00:00Z is 9pm on the 10th in America/Chicago. A UTC reading would file this
    // interview under the 11th and the recruiter would look for it on the wrong day.
    const [ev] = interviewEvents([cand({ id: "c1", phone_date: "2026-08-11T02:00:00Z" })]);
    expect(ev.day).toBe("2026-08-10");
  });
});

describe("monthCells", () => {
  it("pads so the 1st lands under its weekday", () => {
    // 1 Aug 2026 is a Saturday, so six leading blanks.
    const cells = monthCells(2026, 8);
    expect(cells.slice(0, 7)).toEqual([null, null, null, null, null, null, 1]);
  });

  it("has no leading blanks when the 1st is a Sunday", () => {
    // 1 Feb 2026 is a Sunday.
    expect(monthCells(2026, 2)[0]).toBe(1);
  });

  it("takes month as 1-12, so 12 is December with 31 days", () => {
    const cells = monthCells(2026, 12).filter((c) => c !== null);
    expect(cells).toHaveLength(31);
    expect(cells.at(-1)).toBe(31);
  });

  it("gets February right in a leap year", () => {
    expect(monthCells(2028, 2).filter((c) => c !== null)).toHaveLength(29);
    expect(monthCells(2026, 2).filter((c) => c !== null)).toHaveLength(28);
  });
});

describe("eventsByDay", () => {
  const evs = interviewEvents([
    cand({ id: "a", phone_date: "2026-08-10T15:00:00Z" }),
    cand({ id: "b", inperson_date: "2026-08-10T18:00:00Z" }),
    cand({ id: "c", phone_date: "2026-09-01T15:00:00Z" }),
  ]);

  it("buckets by day of month", () => {
    const byDay = eventsByDay(evs, 2026, 8);
    expect(byDay.get(10)?.map((e) => e.candidateId)).toEqual(["a", "b"]);
  });

  it("leaves other months out", () => {
    const byDay = eventsByDay(evs, 2026, 8);
    expect([...byDay.keys()]).toEqual([10]);
  });

  it("does not confuse month 1 with month 10 via a prefix match", () => {
    const jan = interviewEvents([cand({ id: "jan", phone_date: "2026-01-05T15:00:00Z" })]);
    const oct = interviewEvents([cand({ id: "oct", phone_date: "2026-10-05T15:00:00Z" })]);
    const byDay = eventsByDay([...jan, ...oct], 2026, 1);
    expect(byDay.get(5)?.map((e) => e.candidateId)).toEqual(["jan"]);
  });
});

describe("shiftMonth", () => {
  it("steps forward across December", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it("steps back across January", () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("stays inside a year", () => {
    expect(shiftMonth(2026, 5, 2)).toEqual({ year: 2026, month: 7 });
  });
});

describe("upcomingInterviews", () => {
  const now = new Date("2026-08-20T15:00:00Z");
  const evs = interviewEvents([
    cand({ id: "long-past", phone_date: "2026-08-01T15:00:00Z" }),
    cand({ id: "yesterday", phone_date: "2026-08-19T18:00:00Z" }),
    cand({ id: "soon", phone_date: "2026-08-21T15:00:00Z" }),
  ]);

  it("keeps yesterday, because a morning interview is still what you are looking for at lunch", () => {
    expect(upcomingInterviews(evs, now).map((e) => e.candidateId)).toEqual(["yesterday", "soon"]);
  });

  it("drops what is well past", () => {
    expect(upcomingInterviews(evs, now).map((e) => e.candidateId)).not.toContain("long-past");
  });

  it("caps the list", () => {
    const many = interviewEvents(
      Array.from({ length: 20 }, (_, i) => cand({ id: String(i), phone_date: `2026-08-2${i % 10}T15:00:00Z` }))
    );
    expect(upcomingInterviews(many, now, 8)).toHaveLength(8);
  });
});
