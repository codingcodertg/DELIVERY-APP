import { describe, it, expect } from "vitest";
import { isValidSku, normalizeSku } from "@/lib/erp/domain/sku";

describe("normalizeSku", () => {
  it("trims and uppercases", () => {
    expect(normalizeSku("  ab-12 ")).toBe("AB-12");
  });
});

describe("isValidSku", () => {
  it("accepts alnum + hyphen starting with alnum", () => {
    expect(isValidSku("ABC-123")).toBe(true);
    expect(isValidSku("a")).toBe(true);
    expect(isValidSku("po-abc-1")).toBe(true);
  });
  it("rejects empty, leading hyphen, spaces, underscores, and the ~MERGE sentinel", () => {
    expect(isValidSku("")).toBe(false);
    expect(isValidSku("-ABC")).toBe(false);
    expect(isValidSku("AB CD")).toBe(false);
    expect(isValidSku("AB_CD")).toBe(false);
    expect(isValidSku("X~MERGE")).toBe(false);
  });
});
