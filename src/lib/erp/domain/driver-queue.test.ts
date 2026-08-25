// Driver-queue port checks (ADR 0010).
//
// withinRetention's expectations below were dumped from the SOURCE app's
// implementation (src/lib/utils.ts) and pasted in, same as the other ports.
//
// The scoping rules could NOT be differential-tested the same way: in the source
// they are an inline filter inside a client component, not an exported function,
// so there is nothing to import and run. They were transcribed line by line and
// are covered here by cases that pin each rule's INTENT, which is the weaker
// check — recorded plainly rather than described as differential.
import { test, expect } from "vitest";
import {
  withinRetention,
  scopedForDriver,
  stageCounts,
  rowsForTab,
  isRoutedTab,
  RETENTION_DAYS_BACK,
} from "./driver-queue";

const ME = { id: "u-driver", full_name: "Ana Reyes", role: "driver" };

function order(over: Partial<Parameters<typeof scopedForDriver>[0]["deliveries"][number]> = {}) {
  return {
    order_no: 1,
    stage: "ready",
    store: "Store A",
    invoice_num: "INV-100",
    delivery_date: "2026-03-10",
    assigned_driver: "Ana Reyes",
    created_by: "u-sales",
    ...over,
  };
}

// --- withinRetention: dumped from the source implementation -----------------
test("withinRetention matches the source, value for value", () => {
  const TODAY = "2026-03-10";
  const cases: [string | null, boolean][] = [
    [null, true],          // undated — still being scheduled, never ages out
    ["2026-03-11", true],  // tomorrow
    ["2026-03-10", true],  // today
    ["2026-03-09", true],  // yesterday — the retention edge, inclusive
    ["2026-03-08", false], // two days back is already out
    ["2026-01-01", false],
    ["2027-01-01", true],
  ];
  for (const [date, expected] of cases) {
    expect(withinRetention({ delivery_date: date }, TODAY), String(date)).toBe(expected);
  }
});

test("retention is one day back, matching the constant rather than the source comment", () => {
  expect(RETENTION_DAYS_BACK).toBe(1);
});

test("withinRetention compares dates, not timestamps", () => {
  expect(withinRetention({ delivery_date: "2026-03-09T23:59:59Z" }, "2026-03-10")).toBe(true);
});

// --- scoping ----------------------------------------------------------------
test("a driver sees orders assigned to them", () => {
  const out = scopedForDriver({ deliveries: [order()], me: ME, today: "2026-03-10" });
  expect(out).toHaveLength(1);
});

test("a driver does not see another driver's order", () => {
  const out = scopedForDriver({
    deliveries: [order({ assigned_driver: "Beto Cruz" })],
    me: ME,
    today: "2026-03-10",
  });
  expect(out).toHaveLength(0);
});

test("a driver still sees an order they logged themselves", () => {
  const out = scopedForDriver({
    deliveries: [order({ assigned_driver: "Beto Cruz", created_by: "u-driver" })],
    me: ME,
    today: "2026-03-10",
  });
  expect(out).toHaveLength(1);
});

test("an office role on this screen sees everyone's orders", () => {
  const out = scopedForDriver({
    deliveries: [order({ assigned_driver: "Beto Cruz" })],
    me: { ...ME, role: "logistics" },
    today: "2026-03-10",
  });
  expect(out).toHaveLength(1);
});

test("an admin previewing the driver role is not scoped at all", () => {
  const out = scopedForDriver({
    deliveries: [order({ assigned_driver: "Beto Cruz", delivery_date: "2020-01-01" })],
    me: ME,
    adminAllAccess: true,
    today: "2026-03-10",
  });
  expect(out).toHaveLength(1);
});

test("the store filter never hides the driver's own assignment", () => {
  // The whole point of this rule: filtering to Store B must not lose the stop
  // Ana is actually driving today, which happens to be Store A's.
  const out = scopedForDriver({
    deliveries: [order({ store: "Store A" }), order({ order_no: 2, store: "Store B", assigned_driver: "Beto Cruz", created_by: "u-driver" })],
    me: ME,
    storeFilter: "Store B",
    today: "2026-03-10",
  });
  expect(out.map((d) => d.order_no).sort()).toEqual([1, 2]);
});

test("invoice search reaches past the retention window", () => {
  // This is the ONLY way to reach older history from this screen, so it has to
  // survive the date filter that runs after it.
  const old = order({ delivery_date: "2025-01-01", invoice_num: "INV-999" });
  expect(scopedForDriver({ deliveries: [old], me: ME, today: "2026-03-10" })).toHaveLength(0);
  expect(
    scopedForDriver({ deliveries: [old], me: ME, query: "999", today: "2026-03-10" }),
  ).toHaveLength(1);
});

test("invoice search is case-insensitive and ignores surrounding space", () => {
  const out = scopedForDriver({
    deliveries: [order({ invoice_num: "INV-abc" })],
    me: ME,
    query: "  ABC ",
    today: "2026-03-10",
  });
  expect(out).toHaveLength(1);
});

test("an order with no invoice number is not matched by a search", () => {
  const out = scopedForDriver({
    deliveries: [order({ invoice_num: null })],
    me: ME,
    query: "100",
    today: "2026-03-10",
  });
  expect(out).toHaveLength(0);
});

test("scoping never mutates the input array", () => {
  const input = [order({ order_no: 2 }), order({ order_no: 1 })];
  const copy = input.map((d) => ({ ...d }));
  scopedForDriver({ deliveries: input, me: ME, today: "2026-03-10" });
  expect(input).toEqual(copy);
});

// --- tabs -------------------------------------------------------------------
test("stageCounts tallies every stage present", () => {
  const counts = stageCounts([
    order({ stage: "ready" }),
    order({ stage: "ready" }),
    order({ stage: "picked_up" }),
  ]);
  expect(counts).toEqual({ ready: 2, picked_up: 1 });
});

test("the all tab shows newest first across every stage", () => {
  const rows = rowsForTab(
    [order({ order_no: 5, stage: "delivered" }), order({ order_no: 9, stage: "ready" }), order({ order_no: 7, stage: "approved" })],
    "all",
  );
  expect(rows.map((d) => d.order_no)).toEqual([9, 7, 5]);
});

test("a stage tab shows only that stage", () => {
  const rows = rowsForTab([order({ stage: "ready" }), order({ order_no: 2, stage: "delivered" })], "delivered");
  expect(rows.map((d) => d.order_no)).toEqual([2]);
});

test("only the two active driving tabs are route-sequenced", () => {
  expect(isRoutedTab("ready")).toBe(true);
  expect(isRoutedTab("picked_up")).toBe(true);
  expect(isRoutedTab("all")).toBe(false);
  expect(isRoutedTab("delivered")).toBe(false);
  expect(isRoutedTab("approved")).toBe(false);
});

test("rowsForTab does not mutate the scoped list", () => {
  const scoped = [order({ order_no: 1 }), order({ order_no: 2 })];
  const copy = scoped.map((d) => ({ ...d }));
  rowsForTab(scoped, "all");
  rowsForTab(scoped, "ready");
  expect(scoped).toEqual(copy);
});
