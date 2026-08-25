import { test, expect } from "vitest";
import { duplicateOf, duplicateInvoiceOf, pickupEqualsDropoff } from "./delivery-duplicates";

const EXISTING = [
  { id: "a", stage: "approved", account: "Tile Depot", delivery_date: "2026-03-10", po2: "PO-1", invoice_num: "INV-1" },
  { id: "b", stage: "canceled", account: "Tile Depot", delivery_date: "2026-03-11", po2: "PO-9", invoice_num: "INV-9" },
];

test("same account, date and PO is flagged", () => {
  const hit = duplicateOf({ account: "Tile Depot", delivery_date: "2026-03-10", po2: "PO-1" }, EXISTING);
  expect(hit?.id).toBe("a");
});

test("matching is case- and space-insensitive on the account", () => {
  const hit = duplicateOf({ account: "  tile depot ", delivery_date: "2026-03-10", po2: "PO-1" }, EXISTING);
  expect(hit?.id).toBe("a");
});

test("no PO means no warning — same account on the same day is ordinary", () => {
  // Without this guard the form would cry wolf on every second order.
  expect(duplicateOf({ account: "Tile Depot", delivery_date: "2026-03-10" }, EXISTING)).toBeUndefined();
  expect(duplicateOf({ account: "Tile Depot", delivery_date: "2026-03-10", po2: "   " }, EXISTING)).toBeUndefined();
});

test("a canceled order is never a duplicate", () => {
  expect(
    duplicateOf({ account: "Tile Depot", delivery_date: "2026-03-11", po2: "PO-9" }, EXISTING)
  ).toBeUndefined();
});

test("an order never duplicates itself while being edited", () => {
  expect(
    duplicateOf({ account: "Tile Depot", delivery_date: "2026-03-10", po2: "PO-1" }, EXISTING, "a")
  ).toBeUndefined();
});

test("a different date or PO is not a duplicate", () => {
  expect(duplicateOf({ account: "Tile Depot", delivery_date: "2026-03-12", po2: "PO-1" }, EXISTING)).toBeUndefined();
  expect(duplicateOf({ account: "Tile Depot", delivery_date: "2026-03-10", po2: "PO-2" }, EXISTING)).toBeUndefined();
});

test("a reused invoice number is flagged, case-insensitively", () => {
  expect(duplicateInvoiceOf({ invoice_num: "inv-1" }, EXISTING)?.id).toBe("a");
});

test("a blank invoice never matches", () => {
  expect(duplicateInvoiceOf({ invoice_num: "" }, EXISTING)).toBeUndefined();
  expect(duplicateInvoiceOf({ invoice_num: null }, EXISTING)).toBeUndefined();
  expect(duplicateInvoiceOf({}, EXISTING)).toBeUndefined();
});

test("a canceled order's invoice is free to reuse", () => {
  expect(duplicateInvoiceOf({ invoice_num: "INV-9" }, EXISTING)).toBeUndefined();
});

test("identical pickup and delivery addresses are rejected", () => {
  expect(pickupEqualsDropoff({ pickup_address: "1 Main St", delivery_address: " 1 MAIN ST " })).toBe(true);
});

test("an empty pickup address is not an accidental match", () => {
  // Otherwise every order without a pickup address would look like it collided with itself.
  expect(pickupEqualsDropoff({ pickup_address: "", delivery_address: "" })).toBe(false);
  expect(pickupEqualsDropoff({ delivery_address: "1 Main St" })).toBe(false);
  expect(pickupEqualsDropoff({ pickup_address: "1 Main St" })).toBe(false);
});

test("different addresses pass", () => {
  expect(pickupEqualsDropoff({ pickup_address: "1 Main St", delivery_address: "2 Oak Ave" })).toBe(false);
});
