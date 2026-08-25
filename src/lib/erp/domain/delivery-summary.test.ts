import { describe, it, expect } from "vitest";
import { mineFor, summaryStats, recentOrders, type SummaryOrder, type SummarySubject } from "./delivery-summary";

// Pinned: "yesterday and today" is relative to business time, and a floating clock makes the
// driver case pass or fail depending on the hour the suite happens to run.
const NOW = new Date("2026-08-20T15:00:00Z"); // 2026-08-20 in America/Chicago
const TODAY = "2026-08-20";
const YESTERDAY = "2026-08-19";

const o = (over: Partial<SummaryOrder> & { id: string }): SummaryOrder => ({
  order_no: 1,
  order_code: null,
  stage: "approved",
  delivery_date: TODAY,
  delivery_fee: null,
  created_by: null,
  assigned_sales_rep: null,
  assigned_driver: null,
  ...over,
});

const subj = (role: string, over: Partial<SummarySubject> = {}): SummarySubject => ({
  id: "u1",
  full_name: "Nick Huerta",
  role,
  ...over,
});

describe("mineFor", () => {
  it("gives a driver what is assigned to them", () => {
    const rows = mineFor([o({ id: "a", assigned_driver: "Nick Huerta" }), o({ id: "b", assigned_driver: "Ana" })], subj("driver"), NOW);
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("narrows a driver to yesterday and today — not their whole history", () => {
    const rows = mineFor(
      [
        o({ id: "today", assigned_driver: "Nick Huerta", delivery_date: TODAY }),
        o({ id: "yday", assigned_driver: "Nick Huerta", delivery_date: YESTERDAY }),
        o({ id: "old", assigned_driver: "Nick Huerta", delivery_date: "2026-07-01" }),
        o({ id: "future", assigned_driver: "Nick Huerta", delivery_date: "2026-09-01" }),
      ],
      subj("driver"),
      NOW
    );
    expect(rows.map((r) => r.id).sort()).toEqual(["today", "yday"]);
  });

  it("excludes a driver's undated order rather than treating null as today", () => {
    const rows = mineFor([o({ id: "a", assigned_driver: "Nick Huerta", delivery_date: null })], subj("driver"), NOW);
    expect(rows).toHaveLength(0);
  });

  it("counts an order a driver logged themselves", () => {
    const rows = mineFor([o({ id: "a", created_by: "u1", assigned_driver: "Ana" })], subj("driver"), NOW);
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("gives a sales rep what they OWN, including an order somebody else typed for them", () => {
    // The regression this guards: filtering sales by created_by hides orders the office logged on
    // the rep's behalf, so a rep sees fewer of their own orders than they have.
    const rows = mineFor(
      [
        o({ id: "typed-by-office", created_by: "office", assigned_sales_rep: "u1" }),
        o({ id: "typed-by-rep", created_by: "u1" }),
        o({ id: "someone-else", created_by: "other" }),
      ],
      subj("sales"),
      NOW
    );
    expect(rows.map((r) => r.id).sort()).toEqual(["typed-by-office", "typed-by-rep"]);
  });

  it("gives everybody else what they logged", () => {
    const rows = mineFor(
      [o({ id: "a", created_by: "u1" }), o({ id: "b", created_by: "other" })],
      subj("manager"),
      NOW
    );
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("returns nothing when there is no subject", () => {
    expect(mineFor([o({ id: "a" })], null, NOW)).toEqual([]);
  });
});

describe("summaryStats", () => {
  const rows = [
    o({ id: "a", stage: "approved", delivery_fee: 10 }),
    o({ id: "b", stage: "delivered", delivery_fee: 20 }),
    o({ id: "c", stage: "canceled", delivery_fee: 100 }),
    o({ id: "d", stage: "rejected", delivery_fee: 5 }),
    o({ id: "e", stage: "pending", delivery_date: "2026-08-01", delivery_fee: null }),
  ];

  it("counts total, in-progress and delivered", () => {
    const s = summaryStats(rows, NOW);
    expect(s.total).toBe(5);
    // delivered, canceled and rejected are all finished — only approved + pending are in progress.
    expect(s.active).toBe(2);
    expect(s.delivered).toBe(1);
  });

  it("counts an overdue order, and does not count a closed one", () => {
    const s = summaryStats(rows, NOW);
    expect(s.overdue).toBe(1); // only "e" — past-dated and still open
  });

  it("excludes cancelled orders from fees, because a cancelled run was never charged", () => {
    expect(summaryStats(rows, NOW).fees).toBe(35); // 10 + 20 + 5, not 135
  });

  it("rounds the total once rather than each row", () => {
    const s = summaryStats([o({ id: "a", delivery_fee: 0.005 }), o({ id: "b", delivery_fee: 0.005 })], NOW);
    expect(s.fees).toBe(0.01);
  });

  it("treats a missing fee as zero, not NaN", () => {
    expect(summaryStats([o({ id: "a", delivery_fee: null })], NOW).fees).toBe(0);
  });
});

describe("recentOrders", () => {
  it("returns the newest first", () => {
    const rows = recentOrders([o({ id: "a", order_no: 1 }), o({ id: "b", order_no: 9 }), o({ id: "c", order_no: 5 })]);
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("caps the list", () => {
    expect(recentOrders(Array.from({ length: 20 }, (_, i) => o({ id: String(i), order_no: i })), 8)).toHaveLength(8);
  });

  it("does not mutate the caller's array", () => {
    const input = [o({ id: "a", order_no: 1 }), o({ id: "b", order_no: 9 })];
    recentOrders(input);
    expect(input.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
