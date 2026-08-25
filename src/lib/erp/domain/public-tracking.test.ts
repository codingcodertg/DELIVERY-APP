import { test, expect } from "vitest";
import {
  publicLabel, flowIndex, publicState, toPublicOrder, PUBLIC_FIELDS, PUBLIC_FLOW,
} from "./public-tracking";

test("customer wording replaces internal wording", () => {
  expect(publicLabel("picked_up")).toBe("Out for delivery");
  expect(publicLabel("fulfilling")).toBe("Being prepared");
});

test("an unknown stage never leaks its internal name", () => {
  // "draft" or "rejected" appearing verbatim on a customer page tells them something internal.
  expect(publicLabel("draft")).toBe("In progress");
  expect(publicLabel("rejected")).toBe("In progress");
});

test("the flow is the five customer-visible stages", () => {
  expect([...PUBLIC_FLOW]).toEqual(["approved", "fulfilling", "ready", "picked_up", "delivered"]);
  expect(flowIndex("approved")).toBe(0);
  expect(flowIndex("delivered")).toBe(4);
  expect(flowIndex("draft")).toBe(-1);
});

test("a confirmed order tracks, with its position in the journey", () => {
  expect(publicState("fulfilling")).toEqual({ kind: "tracking", stage: "fulfilling", step: 2, total: 5 });
  expect(publicState("delivered")).toEqual({ kind: "tracking", stage: "delivered", step: 5, total: 5 });
});

test("an unconfirmed order shows nothing about being unconfirmed", () => {
  // Whether an order is still being approved is the company's business until it is.
  expect(publicState("draft")).toEqual({ kind: "pending" });
  expect(publicState("pending")).toEqual({ kind: "pending" });
});

test("cancelled and rejected say so, rather than showing a stalled bar", () => {
  expect(publicState("canceled")).toEqual({ kind: "closed" });
  expect(publicState("rejected")).toEqual({ kind: "closed" });
});

test("a missing stage is unknown, not pending", () => {
  expect(publicState(null)).toEqual({ kind: "unknown" });
  expect(publicState("")).toEqual({ kind: "unknown" });
});

test("the public projection is an allow-list and drops everything else", () => {
  const row = {
    order_code: "FA100",
    stage: "ready",
    account: "Tile Depot",
    delivery_address: "1 Main St",
    // None of the following may ever reach a tracking link.
    delivery_fee: 250,
    contact_phone: "555-0100",
    delivery_phone: "555-0101",
    notes: "customer is difficult",
    role_notes: "internal",
    pod_lat: 26.1,
    pod_lng: -98.2,
    created_by: "uuid-of-a-person",
    approved_by: "uuid-of-a-manager",
    est_pallets: 4,
  };
  const pub = toPublicOrder(row) as Record<string, unknown>;
  expect(pub.order_code).toBe("FA100");
  expect(pub.account).toBe("Tile Depot");
  for (const leaked of [
    "delivery_fee", "contact_phone", "delivery_phone", "notes", "role_notes",
    "pod_lat", "pod_lng", "created_by", "approved_by", "est_pallets",
  ]) {
    expect(Object.prototype.hasOwnProperty.call(pub, leaked), leaked).toBe(false);
  }
});

test("the projection has exactly the declared keys, present even when null", () => {
  // Stable shape: a missing key and a null one read differently to a client.
  const pub = toPublicOrder({}) as Record<string, unknown>;
  expect(Object.keys(pub).sort()).toEqual([...PUBLIC_FIELDS].sort());
  expect(pub.account).toBeNull();
});
