import { describe, it, expect } from "vitest";
import { DELIVERY_STAGES, stageInfo, filterStagesFor, orderLabel } from "./delivery-stages";

describe("stageInfo", () => {
  it("resolves every stage key present in the migrated data", () => {
    // These six are what the 77 imported orders actually contain.
    for (const k of ["delivered", "canceled", "approved", "draft", "ready", "picked_up"]) {
      expect(stageInfo(k).key).toBe(k);
    }
  });

  it("keeps the business's own labels where they differ from the key", () => {
    expect(stageInfo("approved").label).toBe("Programmed");
    expect(stageInfo("fulfilling").label).toBe("Preparing");
  });

  it("falls back to the first stage for an unknown key rather than throwing", () => {
    // A row with an unexpected stage should still render — an order that can't be displayed is
    // worse than one displayed under the wrong chip.
    expect(stageInfo("not-a-stage").key).toBe("draft");
  });
});

describe("filterStagesFor", () => {
  it("gives warehouse only the stages it acts on", () => {
    expect(filterStagesFor("warehouse")).toEqual([
      "approved",
      "ready",
      "fulfilling",
      "picked_up",
      "delivered",
    ]);
  });

  it("gives an unlisted role every stage in canonical order", () => {
    const all = DELIVERY_STAGES.map((s) => s.key);
    expect(filterStagesFor("admin")).toEqual(all);
    expect(filterStagesFor("logistics")).toEqual(all);
  });

  it("gives every stage for a null role rather than an empty toolbar", () => {
    expect(filterStagesFor(null)).toEqual(DELIVERY_STAGES.map((s) => s.key));
  });

  it("only ever returns real stage keys", () => {
    const valid = new Set(DELIVERY_STAGES.map((s) => s.key));
    for (const r of ["warehouse", "sales", "manager", "accounting", "driver", "admin"]) {
      for (const k of filterStagesFor(r)) expect(valid.has(k)).toBe(true);
    }
  });
});

describe("orderLabel", () => {
  it("prefers the human order_code", () => {
    expect(orderLabel({ order_code: "FA100", order_no: 12 })).toBe("FA100");
  });

  it("falls back to the internal number when there is no code", () => {
    expect(orderLabel({ order_code: null, order_no: 12 })).toBe("#12");
  });

  it("renders a dash rather than 'null' when neither exists", () => {
    expect(orderLabel({ order_code: null, order_no: null })).toBe("—");
    expect(orderLabel({})).toBe("—");
  });

  it("treats an empty order_code as missing", () => {
    expect(orderLabel({ order_code: "", order_no: 7 })).toBe("#7");
  });
});
