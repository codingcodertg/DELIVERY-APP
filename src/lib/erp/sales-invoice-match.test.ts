import { describe, it, expect } from "vitest";
import {
  normCode, sizeOf, nameTokens, buildIndex, matchLine, matchInvoice,
  type CatalogProduct, type InvoiceLine,
} from "./sales-invoice-match";

// Fixture catalog: the five real products behind the two sample invoices
// (sales-invoice-datamodel.md) + decoys that share a size or a token, so a
// correct name+size match has to discriminate, not just find "a" candidate.
const CATALOG: CatalogProduct[] = [
  { id: 1260, sku: "NM6060A0041", name: "CARSO LIGHT GRAY (M) 24X24 15.5 SF", mpn: null, size_in: "24X24" },
  { id: 3578, sku: "00900900", name: "2X2 IRON STRAIGHT JOINT MATTE CS23 1 SF", mpn: null, size_in: "2X2" },
  { id: 1405, sku: "BPI004", name: "JOLLY PVC 1/2 CLASSIC GRAY", mpn: null, size_in: "8'" },
  { id: 9001, sku: "TEX1UU012", name: "UNI TEXCOLOR GROUT #012", mpn: null, size_in: null },
  { id: 8,    sku: "PLG2030", name: "CARRARA BLANCO (G) 17X17 20.66 SF", mpn: "PCARNUE14HV", size_in: "17X17" },
  // decoys
  { id: 7001, sku: "PLG2010", name: "CARRARA BLANCO (G) 12X12 11 SF", mpn: null, size_in: "12X12" }, // same color, wrong size
  { id: 7002, sku: "BPI007", name: "JOLLY PVC 1/2 BRIGHT WHITE", mpn: null, size_in: "8'" },         // same trim, wrong color
  { id: 7003, sku: "CST1S008", name: "UNI TEXCOLOR GROUT #008", mpn: null, size_in: null },          // same line, wrong color #
  { id: 7004, sku: "ZZ22", name: "2X2 IRON STRAIGHT JOINT MATTE CS99 1 SF", mpn: null, size_in: "2X2" }, // same size, wrong code-token
];

const VENDOR_SKUS = [{ code: "V-CARRARA-17", product_id: 8 }];
const ALIASES = [{ code: "OLDCODE-1", product_id: 1405 }];
const idx = buildIndex(CATALOG, VENDOR_SKUS, ALIASES);

describe("normalization", () => {
  it("normCode strips case / spacing / punctuation (exact-but-tolerant)", () => {
    expect(normCode("nm6060-a0041")).toBe("NM6060A0041");
    expect(normCode(" BPI 004 ")).toBe("BPI004");
    // OCR swaps are NOT normalized away — they must miss on code and fall to name+size
    expect(normCode("TEXIUU012")).not.toBe(normCode("TEX1UU012"));
    expect(normCode("BPD04")).not.toBe(normCode("BPI004"));
  });
  it("sizeOf pulls an NxN size from text", () => {
    expect(sizeOf("CARRARA BLANCO 17X17 20.66 SF")).toBe("17X17");
    expect(sizeOf("JOLLY PVC 1/2")).toBe("");
  });
  it("nameTokens drops size/coverage/units/grade and folds GREY→GRAY", () => {
    const t = nameTokens("JOLLY PVC 1/2 Classic Grey");
    expect(t.has("GRAY")).toBe(true);
    expect(t.has("GREY")).toBe(false);
    expect(t.has("JOLLY")).toBe(true);
    const t2 = nameTokens("2X2 IRON STRAIGHT JOINT MATTE CS23 1 SF");
    expect(t2.has("SF")).toBe(false);
    expect([...t2].some(x => x.includes("X"))).toBe(false); // 2X2 stripped as size
  });
});

describe("exact code tiers (high-confidence, auto-eligible)", () => {
  it("matches NM6060A0041 on products.sku (the one clean code on the PDF)", () => {
    const m = matchLine({ line_no: 1, raw_item_code: "NM6060A0041", raw_description: "CARSO GRIS (M) 24X24" }, idx);
    expect(m.match_method).toBe("sku");
    expect(m.product_id).toBe(1260);
    expect(m.auto_eligible).toBe(true);
    expect(m.match_confidence).toBeGreaterThanOrEqual(0.95);
  });
  it("matches on mpn, vendor_sku and alias (normalized)", () => {
    expect(matchLine({ line_no: 1, raw_item_code: "pcarnue14hv", raw_description: "x" }, idx).match_method).toBe("mpn");
    expect(matchLine({ line_no: 1, raw_item_code: "v-carrara-17", raw_description: "x" }, idx).match_method).toBe("vendor_sku");
    expect(matchLine({ line_no: 1, raw_item_code: "oldcode 1", raw_description: "x" }, idx).match_method).toBe("alias");
  });
});

describe("name+size fallback — the four real code-miss cases (suggestions)", () => {
  const cases: Array<[string, string, string, number]> = [
    // raw_item_code (OCR/drift), raw_description, expected sku, expected product_id
    ["40900900", "2X2 Iron Straight Joint CS23", "00900900", 3578],
    ["BPD04", "Jolly P-1/2 PVC Classic Grey", "BPI004", 1405],
    ["TEXIUU012", "Uni Texcolor Grout #012", "TEX1UU012", 9001],
    ["PLGPM1M264", "Carrara Blanco 17X17", "PLG2030", 8],
  ];
  for (const [code, desc, sku, pid] of cases) {
    it(`${code} "${desc}" → ${sku} via name_size`, () => {
      const m = matchLine({ line_no: 1, raw_item_code: code, raw_description: desc }, idx);
      expect(m.match_method).toBe("name_size");   // missed on code, recovered on name+size
      expect(m.product_id).toBe(pid);
      expect(m.matched_sku).toBe(sku);
      expect(m.auto_eligible).toBe(false);          // always a manager-review suggestion
      expect(m.match_confidence).toBeGreaterThan(0.4);
      expect(m.match_confidence).toBeLessThanOrEqual(0.85);
    });
  }
  it("discriminates against same-size / same-token decoys", () => {
    // 17X17 carrara must beat the 12X12 carrara decoy; #012 grout must beat #008
    expect(matchLine({ line_no: 1, raw_item_code: "X", raw_description: "Carrara Blanco 17X17" }, idx).product_id).toBe(8);
    expect(matchLine({ line_no: 1, raw_item_code: "X", raw_description: "Uni Texcolor Grout #012" }, idx).product_id).toBe(9001);
  });
  it("treats a #NNN color number as a hard discriminator (no wrong-color match)", () => {
    // a catalog with the grout LINE but only the #460 color → must NOT match #012
    const onlyOtherColor = buildIndex([
      { id: 2021, sku: "TEX1UU460", name: "UNI TEXCOLOR GROUT STONE #460", mpn: null, size_in: null },
    ]);
    const m = matchLine({ line_no: 1, raw_item_code: "TEXIUU012", raw_description: "Uni Texcolor Grout #012" }, onlyOtherColor);
    expect(m.match_method).toBeNull(); // #012 ≠ #460 → conflict → unmatched, not a wrong-color suggestion
  });
});

describe("non-matches", () => {
  it("returns null method when nothing is close", () => {
    const m = matchLine({ line_no: 1, raw_item_code: "ZZZ999", raw_description: "completely unrelated widget" }, idx);
    expect(m.match_method).toBeNull();
    expect(m.product_id).toBeNull();
    expect(m.match_confidence).toBe(0);
  });
  it("a single common token is not enough to match", () => {
    const m = matchLine({ line_no: 1, raw_item_code: "X", raw_description: "GROUT" }, idx);
    expect(m.match_method).toBeNull();
  });
});

describe("invoice-level summary", () => {
  it("the PNG #162094 fixture matches 4/4 (1 would-be code, 4 name_size across both invoices)", () => {
    const lines: InvoiceLine[] = [
      { line_no: 1, raw_item_code: "NM6060A0041", raw_description: "CARSO GRIS (M) 24X24" },
      { line_no: 2, raw_item_code: "40900900", raw_description: "2X2 Iron Straight Joint CS23" },
      { line_no: 3, raw_item_code: "BPD04", raw_description: "Jolly P-1/2 PVC Classic Grey" },
      { line_no: 4, raw_item_code: "TEXIUU012", raw_description: "Uni Texcolor Grout #012" },
      { line_no: 5, raw_item_code: "PLGPM1M264", raw_description: "Carrara Blanco 17X17" },
    ];
    const { summary } = matchInvoice(lines, idx);
    expect(summary.total).toBe(5);
    expect(summary.matched).toBe(5);
    expect(summary.match_rate).toBe(1);
    expect(summary.byMethod.sku).toBe(1);
    expect(summary.byMethod.name_size).toBe(4);
    expect(summary.auto_eligible).toBe(1);   // only the exact-code line
    expect(summary.suggestions).toBe(4);     // the four name+size lines need review
  });
});
