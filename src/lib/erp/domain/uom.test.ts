import { describe, it, expect } from "vitest";
import { detectUomError, isCostOutlier, medianOf, suggestUomFix } from "@/lib/erp/domain/uom";

describe("detectUomError", () => {
  it("flags cost >= 1.5x price as a likely UoM error (ACUARELA case)", () => {
    const r = detectUomError(2.45, 10.12);
    expect(r.isLikelyError).toBe(true);
    expect(r.severity).toBe("high");
    expect(r.ratio).toBeCloseTo(4.13, 2);
    expect(r.suggestion).toMatch(/unit-of-measure/i);
  });
  it("treats 1.0-1.5x as marginal — verify, don't auto-fix", () => {
    const r = detectUomError(10, 12);
    expect(r.isLikelyError).toBe(false);
    expect(r.severity).toBe("marginal");
  });
  it("healthy margin -> none", () => {
    expect(detectUomError(10, 4).severity).toBe("none");
  });
  it("missing/zero/negative inputs -> none (no false positives)", () => {
    expect(detectUomError(null, 4).severity).toBe("none");
    expect(detectUomError(0, 4).severity).toBe("none");
    expect(detectUomError(10, 0).severity).toBe("none");
  });
});

describe("isCostOutlier / medianOf", () => {
  it("median of even and odd sets", () => {
    expect(medianOf([1, 3])).toBe(2);
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([])).toBeNull();
  });
  it("flags a per-box cost among per-unit line-mates", () => {
    expect(isCostOutlier(10.12, [1.01, 0.98, 1.05])).toBe(true);
  });
  it("does not flag a consistent line", () => {
    expect(isCostOutlier(1.02, [1.01, 0.98, 1.05])).toBe(false);
  });
  it("needs at least two comparators", () => {
    expect(isCostOutlier(10, [1])).toBe(false);
  });
});

describe("suggestUomFix", () => {
  it("proposes a per-SF cost when sf_per_box explains the ratio", () => {
    const s = suggestUomFix({ price: 2.45, cost: 24.5, sf_per_box: 10, base_unit: "BX" });
    expect(s.flag.severity).toBe("high");
    expect(s.proposedCost).toBe(2.45);
    expect(s.proposedBaseUnit).toBe("SF");
  });
  it("falls back to a verify-the-unit note when sf_per_box is missing", () => {
    const s = suggestUomFix({ price: 2.45, cost: 10.12, sf_per_box: null });
    expect(s.flag.severity).toBe("high");
    expect(s.proposedCost).toBeNull();
    expect(s.rationale).toMatch(/verify base_unit/i);
  });
  it("makes no proposal for a healthy margin", () => {
    expect(suggestUomFix({ price: 10, cost: 4 }).flag.severity).toBe("none");
  });
});
