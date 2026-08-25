import { test, expect } from "vitest";
import { autoApproveStores, storeAutoApproves } from "./delivery-settings";

const STORES = [
  { name: "RDZ Pharr", auto_approve: true },
  { name: "RDZ McAllen", auto_approve: false },
  { name: "RDZ Mission" },
  { name: "  RDZ Weslaco  ", auto_approve: true },
];

test("only stores explicitly set to auto-approve are included", () => {
  expect([...autoApproveStores(STORES)].sort()).toEqual(["RDZ Pharr", "RDZ Weslaco"]);
});

test("a missing flag is not an auto-approving store", () => {
  // Absent must never mean yes: this setting is what lets an order skip approval entirely.
  expect(storeAutoApproves("RDZ Mission", STORES)).toBe(false);
  expect(storeAutoApproves("RDZ McAllen", STORES)).toBe(false);
});

test("a truthy non-boolean does not count either", () => {
  expect(storeAutoApproves("X", [{ name: "X", auto_approve: 1 as never }])).toBe(false);
  expect(storeAutoApproves("Y", [{ name: "Y", auto_approve: "true" as never }])).toBe(false);
});

test("names are matched trimmed, on both sides", () => {
  expect(storeAutoApproves("RDZ Weslaco", STORES)).toBe(true);
  expect(storeAutoApproves("  RDZ Pharr ", STORES)).toBe(true);
});

test("an unknown, empty or missing store never auto-approves", () => {
  expect(storeAutoApproves("Nowhere", STORES)).toBe(false);
  expect(storeAutoApproves("", STORES)).toBe(false);
  expect(storeAutoApproves(null, STORES)).toBe(false);
  expect(storeAutoApproves("RDZ Pharr", null)).toBe(false);
});
