import { describe, it, expect } from "vitest";
import { classifyShape, parseSize } from "@/lib/erp/domain/classify";

describe("parseSize", () => {
  it("parses and normalizes w<=h, stripping quotes", () => {
    expect(parseSize('24"x12"')).toEqual({ w: 12, h: 24 });
    expect(parseSize("12 X 12")).toEqual({ w: 12, h: 12 });
  });
  it("null on unparseable", () => {
    expect(parseSize(null)).toBeNull();
    expect(parseSize("assorted")).toBeNull();
  });
});

describe("classifyShape", () => {
  it("name keywords win over size", () => {
    expect(classifyShape({ name: "Carrara Hexagon", sizeIn: "12x12" })).toBe("Hexagon");
    expect(classifyShape({ name: "Glass Mosaic Blend", sizeIn: "12x12" })).toBe("Mosaic");
  });
  it("aspect ratio buckets: subway / plank / rectangle / square", () => {
    expect(classifyShape({ name: "White Gloss", sizeIn: "3x6" })).toBe("Subway");
    expect(classifyShape({ name: "Oak Wood Look", sizeIn: "8x48" })).toBe("Plank");
    expect(classifyShape({ name: "Field Tile", sizeIn: "12x24" })).toBe("Rectangle");
    expect(classifyShape({ name: "Field Tile", sizeIn: "12x12" })).toBe("Square");
  });
  it("tiny pieces -> Mosaic; unknown size -> Other", () => {
    expect(classifyShape({ name: "Blend", sizeIn: "2x2" })).toBe("Mosaic");
    expect(classifyShape({ name: "Mystery", sizeIn: null })).toBe("Other");
  });
});
