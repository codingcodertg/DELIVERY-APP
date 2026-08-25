import { test, expect } from "vitest";
import { accountRows, filterAccounts, CLOSED_STAGES, type AccountOrder } from "./delivery-accounts";

const NOW = new Date("2026-03-10T12:00:00Z");
const o = (over: Partial<AccountOrder> & { id: string }): AccountOrder => ({
  account: "Tile Depot",
  stage: "ready",
  ...over,
});

test("orders group under one row per customer", () => {
  const rows = accountRows([o({ id: "1" }), o({ id: "2" }), o({ id: "3", account: "Other Co" })], NOW);
  expect(rows.map((r) => [r.name, r.total])).toEqual([["Tile Depot", 2], ["Other Co", 1]]);
});

test("the same customer typed two ways is one row, shown as first seen", () => {
  // Splitting them understates both; lowercasing the display would look like a bug of its own.
  const rows = accountRows([o({ id: "1", account: "Tile Depot" }), o({ id: "2", account: "tile depot" })], NOW);
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe("Tile Depot");
  expect(rows[0].total).toBe(2);
});

test("surrounding whitespace does not create a second customer", () => {
  const rows = accountRows([o({ id: "1", account: "Tile Depot" }), o({ id: "2", account: "  Tile Depot " })], NOW);
  expect(rows).toHaveLength(1);
});

test("orders with no account are grouped and visible, not dropped", () => {
  // Usually a data-entry gap worth seeing rather than noise worth hiding.
  const rows = accountRows([o({ id: "1", account: null }), o({ id: "2", account: "" })], NOW);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: "(no account)", total: 2 });
});

test("active counts what is still expected to move", () => {
  const rows = accountRows(
    [
      o({ id: "1", stage: "ready" }),
      o({ id: "2", stage: "delivered" }),
      o({ id: "3", stage: "canceled" }),
      o({ id: "4", stage: "rejected" }),
      o({ id: "5", stage: "pending" }),
    ],
    NOW
  );
  expect(rows[0].total).toBe(5);
  expect(rows[0].active).toBe(2);
  expect(rows[0].delivered).toBe(1);
  expect(CLOSED_STAGES).toEqual(["delivered", "canceled", "rejected"]);
});

test("overdue counts only orders still owed", () => {
  const rows = accountRows(
    [
      o({ id: "late", stage: "ready", delivery_date: "2026-03-01" }),
      o({ id: "done", stage: "delivered", delivery_date: "2026-03-01" }),
      o({ id: "soon", stage: "ready", delivery_date: "2026-03-20" }),
    ],
    NOW
  );
  expect(rows[0].overdue).toBe(1);
});

test("pallets prefer the actual count over the estimate", () => {
  const rows = accountRows(
    [o({ id: "1", est_pallets: 5, actual_pallets: 3 }), o({ id: "2", est_pallets: 4 })],
    NOW
  );
  expect(rows[0].pallets).toBe(7);
});

test("missing pallets and fees count as zero, not NaN", () => {
  const rows = accountRows([o({ id: "1", est_pallets: null, delivery_fee: null })], NOW);
  expect(rows[0].pallets).toBe(0);
  expect(rows[0].fees).toBe(0);
  expect(Number.isNaN(rows[0].fees)).toBe(false);
});

test("last date is the most recent, not the last row seen", () => {
  const rows = accountRows(
    [
      o({ id: "1", delivery_date: "2026-01-05" }),
      o({ id: "2", delivery_date: "2026-03-01" }),
      o({ id: "3", delivery_date: "2026-02-01" }),
      o({ id: "4", delivery_date: null }),
    ],
    NOW
  );
  expect(rows[0].lastDate).toBe("2026-03-01");
});

test("a customer with no dated orders has no last date rather than a wrong one", () => {
  const rows = accountRows([o({ id: "1", delivery_date: null })], NOW);
  expect(rows[0].lastDate).toBeNull();
});

test("rows sort by volume, then alphabetically", () => {
  const rows = accountRows(
    [
      o({ id: "1", account: "Zed" }),
      o({ id: "2", account: "Alpha" }),
      o({ id: "3", account: "Busy" }),
      o({ id: "4", account: "Busy" }),
    ],
    NOW
  );
  expect(rows.map((r) => r.name)).toEqual(["Busy", "Alpha", "Zed"]);
});

test("search matches however the name was typed", () => {
  const rows = accountRows([o({ id: "1", account: "Tile Depot" })], NOW);
  expect(filterAccounts(rows, "  tile ")).toHaveLength(1);
  expect(filterAccounts(rows, "DEPOT")).toHaveLength(1);
  expect(filterAccounts(rows, "concrete")).toHaveLength(0);
  expect(filterAccounts(rows, "")).toHaveLength(1);
});
