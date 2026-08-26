import { describe, it, expect } from "vitest";
import { dupKey, isLikelyDup } from "@/lib/erp/domain/dup";

describe("dupKey", () => {
  it("collapses case, punctuation, and whitespace", () => {
    expect(dupKey("Bondi  White, 12x24!")).toBe("bondi white 12x24");
  });
});

describe("isLikelyDup", () => {
  it("matches trivially-different spellings of the same name", () => {
    expect(isLikelyDup("Bondi White 12x24", "bondi  white   12X24")).toBe(true);
  });
  it("distinguishes genuinely different names", () => {
    expect(isLikelyDup("Bondi White", "Neutro Grey")).toBe(false);
  });
});
