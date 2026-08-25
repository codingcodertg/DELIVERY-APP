import { describe, it, expect } from "vitest";
import {
  overdueUnassigned,
  missingPin,
  deliveredWithoutProof,
  attentionItems,
  type AttentionOrder,
} from "./delivery-attention";

const TODAY = "2026-08-25";
const fleet: AttentionOrder[] = [
  { id: "a", order_no: 1, stage: "ready", assigned_driver: null, delivery_date: "2026-08-20", delivery_lat: 26.1 },
  { id: "b", order_no: 2, stage: "ready", assigned_driver: "Ana", delivery_date: "2026-08-20", delivery_lat: 26.1 },
  { id: "c", order_no: 3, stage: "ready", assigned_driver: null, delivery_date: TODAY, delivery_lat: 26.1 },
  { id: "d", order_no: 4, stage: "delivered", assigned_driver: null, delivery_date: "2026-08-01", delivery_lat: 26.1 },
  { id: "e", order_no: 5, stage: "pending", assigned_driver: null, delivery_date: "2026-08-26", delivery_lat: null },
  { id: "f", order_no: 6, stage: "draft", delivery_lat: null },
  { id: "g", order_no: 7, stage: "approved", delivery_lat: null },
  { id: "h", order_no: 8, stage: "picked_up", delivery_lat: null },
  { id: "i", order_no: 9, stage: "delivered", pod_delivered_at: "2026-08-20T10:00:00Z", delivery_lat: 26.1 },
  { id: "j", order_no: 10, stage: "delivered", pod_delivered_at: "2026-08-20T10:00:00Z", pod_received_by: "Ana", delivery_lat: 26.1 },
  { id: "k", order_no: 11, stage: "delivered", pod_delivered_at: "2026-08-20T10:00:00Z", photos: ["x"], delivery_lat: 26.1 },
  { id: "l", order_no: 12, stage: "delivered", pod_delivered_at: null, delivery_lat: 26.1 },
  { id: "m", order_no: 13, stage: "delivered", pod_delivered_at: "2026-08-20T10:00:00Z", pod_lat: 26.1, delivery_lat: 26.1 },
];
const nos = (r: AttentionOrder[]) => r.map((d) => d.order_no);

describe("overdueUnassigned", () => {
  it("flags live work past its date with no driver", () => {
    expect(nos(overdueUnassigned(fleet, TODAY))).toEqual([1]);
  });

  it("does NOT flag an order dated today — normal at 8am, and it would cry wolf daily", () => {
    expect(nos(overdueUnassigned(fleet, TODAY))).not.toContain(3);
  });

  it("ignores orders that already have a driver", () => {
    expect(nos(overdueUnassigned(fleet, TODAY))).not.toContain(2);
  });

  it("ignores finished work, however old", () => {
    expect(nos(overdueUnassigned(fleet, TODAY))).not.toContain(4);
  });
});

describe("missingPin", () => {
  it("flags plannable work with no coordinates", () => {
    // The optimizer skips these silently, so a stop can be scheduled, loaded and never routed.
    expect(nos(missingPin(fleet))).toEqual([5, 7]);
  });

  it("includes PENDING, not just approved — a pending order is schedulable", () => {
    // This is the case a narrower "open stages" check missed: pending, dated, full address, and
    // invisible to routing.
    expect(nos(missingPin(fleet))).toContain(5);
  });

  it("excludes drafts — they are not orders yet", () => {
    expect(nos(missingPin(fleet))).not.toContain(6);
  });

  it("excludes picked_up — already on the truck, nothing left to route", () => {
    expect(nos(missingPin(fleet))).not.toContain(8);
  });
});

describe("deliveredWithoutProof", () => {
  it("flags a delivery recorded through the app with nothing attached", () => {
    expect(nos(deliveredWithoutProof(fleet))).toEqual([9]);
  });

  it("accepts any one form of proof", () => {
    for (const n of [10, 11, 13]) {
      expect(nos(deliveredWithoutProof(fleet))).not.toContain(n);
    }
  });

  it("ignores bulk-imported deliveries with no pod timestamp", () => {
    // Those never had proof and never will; flagging them would bury the ones that matter.
    expect(nos(deliveredWithoutProof(fleet))).not.toContain(12);
  });
});

describe("attentionItems", () => {
  it("omits proof warnings when the office does not require proof", () => {
    // Otherwise the panel argues daily with a switch its owner deliberately turned off, and a panel
    // that is wrong daily is a panel nobody opens.
    const kinds = attentionItems(fleet, TODAY, false).map((i) => i.kind);
    expect(kinds).not.toContain("no_proof");
  });

  it("includes proof warnings once proof is required", () => {
    const items = attentionItems(fleet, TODAY, true);
    expect(items.map((i) => `${i.kind}:${i.delivery.order_no}`)).toEqual([
      "overdue_unassigned:1",
      "no_pin:5",
      "no_pin:7",
      "no_proof:9",
    ]);
  });

  it("defaults to not requiring proof", () => {
    expect(attentionItems(fleet, TODAY).map((i) => i.kind)).not.toContain("no_proof");
  });

  it("returns nothing for a clean board", () => {
    const clean: AttentionOrder[] = [
      { id: "x", order_no: 1, stage: "ready", assigned_driver: "Ana", delivery_date: TODAY, delivery_lat: 26.1 },
    ];
    expect(attentionItems(clean, TODAY, true)).toEqual([]);
  });
});
