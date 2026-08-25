import { test, expect } from "vitest";
import {
  hoursDelta,
  isResolvable,
  describeRequest,
  summarise,
  sortForReview,
  REQUEST_LABEL,
  type TimeRequest,
} from "./timetracker-requests";

const r = (o: Partial<TimeRequest> = {}): TimeRequest => ({
  id: "r1",
  employee_uid: "u1",
  type: "add",
  status: "pending",
  ...o,
});

test("adding and adjusting time are positive, removing is negative", () => {
  // Signed, so a list of requests can be totalled and the total mean something.
  expect(hoursDelta(r({ type: "add", payload: { hours: 2 } }))).toBe(2);
  expect(hoursDelta(r({ type: "adjust", payload: { hours: 2 } }))).toBe(2);
  expect(hoursDelta(r({ type: "delete", payload: { hours: 2 } }))).toBe(-2);
});

test("a missing or unparseable hours figure is zero, never NaN", () => {
  expect(hoursDelta(r({ payload: {} }))).toBe(0);
  expect(hoursDelta(r({ payload: null }))).toBe(0);
  expect(hoursDelta(r({}))).toBe(0);
  expect(hoursDelta(r({ payload: { hours: "x" as never } }))).toBe(0);
});

test("only a pending request can be resolved", () => {
  expect(isResolvable(r({ status: "pending" }))).toBe(true);
  expect(isResolvable(r({ status: "approved" }))).toBe(false);
  expect(isResolvable(r({ status: "rejected" }))).toBe(false);
});

test("the description reads sensibly whatever the payload carries", () => {
  // Older requests have only a date and hours; newer ones a time range. Both are real.
  expect(describeRequest(r({ type: "add", payload: { date: "2026-07-07", hours: 2.5 } })))
    .toBe("Add time · 2026-07-07 (2.5h)");
  expect(
    describeRequest(
      r({ type: "adjust", payload: { date: "2026-08-21", fromTime: "13:26", toTime: "15:30", hours: 2.07 } })
    )
  ).toBe("Adjust time · 2026-08-21 13:26–15:30 (2.07h)");
  expect(describeRequest(r({ type: "delete", payload: { date: "2026-07-07" } })))
    .toBe("Remove time · 2026-07-07");
});

test("a request with no payload still describes itself", () => {
  expect(describeRequest(r({ type: "add", payload: null }))).toBe("Add time · unknown date");
});

test("an unknown type falls back to its raw name rather than blank", () => {
  expect(describeRequest(r({ type: "something-new", payload: { date: "2026-01-01" } })))
    .toBe("something-new · 2026-01-01");
});

test("the summary counts each status and totals only the pending hours", () => {
  // Only pending hours, because approved ones are already in the timesheet — counting them again
  // would double what the reviewer thinks is outstanding.
  const s = summarise([
    r({ id: "a", status: "pending", type: "add", payload: { hours: 2 } }),
    r({ id: "b", status: "pending", type: "delete", payload: { hours: 1 } }),
    r({ id: "c", status: "approved", type: "add", payload: { hours: 8 } }),
    r({ id: "d", status: "rejected", type: "add", payload: { hours: 4 } }),
  ]);
  expect(s).toEqual({ pending: 2, approved: 1, rejected: 1, pendingHours: 1 });
});

test("pending requests sort first, newest within each group", () => {
  const out = sortForReview([
    r({ id: "old-approved", status: "approved", created_at: "2026-01-01" }),
    r({ id: "new-pending", status: "pending", created_at: "2026-03-01" }),
    r({ id: "old-pending", status: "pending", created_at: "2026-02-01" }),
    r({ id: "new-rejected", status: "rejected", created_at: "2026-04-01" }),
  ]);
  expect(out.map((x) => x.id)).toEqual(["new-pending", "old-pending", "new-rejected", "old-approved"]);
});

test("sorting does not mutate the input", () => {
  const input = [r({ id: "a", status: "approved" }), r({ id: "b", status: "pending" })];
  const before = input.map((x) => x.id);
  sortForReview(input);
  expect(input.map((x) => x.id)).toEqual(before);
});

test("every known type has a label", () => {
  expect(Object.keys(REQUEST_LABEL).sort()).toEqual(["add", "adjust", "delete"]);
});
