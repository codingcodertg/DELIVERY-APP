import { describe, it, expect } from "vitest";
import { SELL_UNITS, isSellUnit, priceUnitSuffix, priceInCostUnit } from "@/lib/erp/domain/units";

describe("sell unit helpers", () => {
  it("isSellUnit guards the enum", () => {
    expect(SELL_UNITS).toContain("sqft");
    expect(isSellUnit("sqft")).toBe(true);
    expect(isSellUnit("liter")).toBe(false);
    expect(isSellUnit(null)).toBe(false);
  });

  it("priceUnitSuffix formats a label", () => {
    expect(priceUnitSuffix("sqft")).toBe(" /sqft");
    expect(priceUnitSuffix("linear_ft")).toBe(" /linear ft");
    expect(priceUnitSuffix(null)).toBe("");
  });
});

describe("priceInCostUnit (mirror of the DB helper)", () => {
  it("converts the 17x17 tile example (ADR 0007): $1/sqft × 20.67 sf/box = $20.67/box", () => {
    expect(priceInCostUnit(1, "sqft", null, 20.67, null)).toBeCloseTo(20.67, 2);
  });
  it("converts per-piece via pieces_per_box", () => {
    expect(priceInCostUnit(2, "piece", "BOX", null, 10)).toBe(20);
  });
  it("passes price through when sell unit equals the cost unit (no conversion)", () => {
    expect(priceInCostUnit(5, "bag", "BAG", null, null)).toBe(5);
    expect(priceInCostUnit(12.5, "box", "BOX", null, null)).toBe(12.5);
    expect(priceInCostUnit(3, "each", null, null, null)).toBe(3);
  });
  it("returns null when a needed conversion factor is missing (no bogus margin)", () => {
    expect(priceInCostUnit(1, "sqft", null, null, null)).toBeNull();
    expect(priceInCostUnit(1, "sqft", null, 0, null)).toBeNull();
    expect(priceInCostUnit(2, "piece", null, null, 0)).toBeNull();
  });
  it("null price → null", () => {
    expect(priceInCostUnit(null, "sqft", null, 20, null)).toBeNull();
  });
});
