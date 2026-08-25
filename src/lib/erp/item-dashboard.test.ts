import { describe, it, expect } from "vitest";
import { statusView, boxesToSqFt, verifiedView } from "./item-dashboard";

describe("statusView — discontinued ≠ inactive until QOH = 0", () => {
  it("active / special_order / inactive", () => {
    expect(statusView("active", 10).label).toBe("Active");
    expect(statusView("special_order", 0).label).toBe("Special order");
    expect(statusView("inactive", 0).label).toBe("Inactive");
  });
  it("discontinued WITH stock still sells through (not treated as dead)", () => {
    const v = statusView("discontinued", 42);
    expect(v.label).toBe("Discontinued");
    expect(v.note).toMatch(/selling through/i);
    expect(v.note).toContain("42");
  });
  it("discontinued at QOH 0 is sold out", () => {
    const v = statusView("discontinued", 0);
    expect(v.note).toMatch(/sold out/i);
  });
  it("null qoh treated as 0", () => {
    expect(statusView("discontinued", null).note).toMatch(/sold out/i);
  });
});

describe("boxesToSqFt", () => {
  it("multiplies boxes by sf/box, rounded to 2dp", () => {
    expect(boxesToSqFt(10, 15.5)).toBe(155);
    expect(boxesToSqFt(3, 20.66)).toBe(61.98);
  });
  it("returns null when either input is null", () => {
    expect(boxesToSqFt(null, 15.5)).toBeNull();
    expect(boxesToSqFt(10, null)).toBeNull();
  });
});

describe("verifiedView — ✓ / ✓✓", () => {
  it("level 0 → no marks", () => {
    expect(verifiedView(0).marks).toBe(0);
    expect(verifiedView(null).symbol).toBe("");
  });
  it("level 1 → single ✓ (human-reviewed)", () => {
    const v = verifiedView(1);
    expect(v.marks).toBe(1);
    expect(v.symbol).toBe("✓");
  });
  it("level 2 → ✓✓ (confirmed vs scrape)", () => {
    expect(verifiedView(2).symbol).toBe("✓✓");
  });
  it("a confirmed external ref counts as ✓✓ even at level 0/1", () => {
    expect(verifiedView(0, true).marks).toBe(2);
    expect(verifiedView(1, true).symbol).toBe("✓✓");
  });
});
