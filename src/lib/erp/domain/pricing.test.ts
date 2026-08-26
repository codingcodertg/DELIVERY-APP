import { describe, it, expect } from "vitest";
import { grossMargin, marginPct, round1, round2, perUnitCost } from "@/lib/erp/domain/pricing";

describe("grossMargin", () => {
  it("price - cost, rounded to cents", () => {
    expect(grossMargin(10, 4)).toBe(6);
    expect(grossMargin(2.45, 1.01)).toBe(1.44);
  });
  it("negative when cost exceeds price (below-cost item)", () => {
    expect(grossMargin(2.45, 10.12)).toBe(-7.67);
  });
  it("null on missing input (no cost leak)", () => {
    expect(grossMargin(null, 4)).toBeNull();
    expect(grossMargin(10, undefined)).toBeNull();
  });
  it("no binary-float drift on subtraction", () => {
    expect(grossMargin(0.3, 0.1)).toBe(0.2); // 0.3 - 0.1 = 0.19999999999999998 in float
    expect(grossMargin(4.3, 4.2)).toBe(0.1);
  });
});

describe("marginPct", () => {
  it("(price-cost)/price*100, one decimal", () => {
    expect(marginPct(10, 4)).toBe(60);
    expect(marginPct(2.45, 1.0)).toBe(59.2);
  });
  it("null when price is 0 (no div-by-zero) or input missing", () => {
    expect(marginPct(0, 4)).toBeNull();
    expect(marginPct(10, null)).toBeNull();
  });
  it("negative for below-cost", () => {
    expect(marginPct(2.45, 10.12)!).toBeLessThan(0);
  });
});

describe("round2 / round1 — decimal half-up (matches Postgres round())", () => {
  it("rounds .5 away from zero exactly (the classic float bug)", () => {
    expect(round2(1.005)).toBe(1.01); // float Math.round((1.005)*100)/100 gives 1.00
    expect(round2(2.675)).toBe(2.68); // float gives 2.67
    expect(round2(-2.675)).toBe(-2.68);
    expect(round1(2.45)).toBe(2.5);
    expect(round1(2.449)).toBe(2.4);
  });
  it("leaves exact values untouched", () => {
    expect(round2(1.44)).toBe(1.44);
    expect(round2(6)).toBe(6);
  });
});

describe("perUnitCost — exact per-unit restatement", () => {
  it("divides exactly to cents", () => {
    expect(perUnitCost(24.5, 10)).toBe(2.45);
    expect(perUnitCost(10, 3)).toBe(3.33);
  });
  it("null on missing or zero units", () => {
    expect(perUnitCost(10, 0)).toBeNull();
    expect(perUnitCost(null, 5)).toBeNull();
  });
});
