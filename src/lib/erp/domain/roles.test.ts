import { describe, it, expect } from "vitest";
import { canSeeCost } from "@/lib/erp/domain/roles";

describe("canSeeCost", () => {
  it("admin and manager can see cost", () => {
    expect(canSeeCost("admin")).toBe(true);
    expect(canSeeCost("manager")).toBe(true);
  });
  it("staff/null/undefined cannot (fails closed)", () => {
    expect(canSeeCost("staff")).toBe(false);
    expect(canSeeCost(null)).toBe(false);
    expect(canSeeCost(undefined)).toBe(false);
  });
});
