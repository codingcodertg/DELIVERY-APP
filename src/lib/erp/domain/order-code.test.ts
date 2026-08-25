import { describe, it, expect } from "vitest";
import { isoWeek, isoWeekYear, weeksInIsoYear, codeBand, nextOrderCode, codeLabel } from "./order-code";

const at = (iso: string) => new Date(`${iso}T12:00:00`);

describe("ISO week maths", () => {
  it("identifies 53-week years correctly", () => {
    expect(weeksInIsoYear(2026)).toBe(53);
    expect(weeksInIsoYear(2020)).toBe(53);
    expect(weeksInIsoYear(2032)).toBe(53);
    expect(weeksInIsoYear(2025)).toBe(52);
    expect(weeksInIsoYear(2027)).toBe(52);
  });

  it("puts early-January days in the PREVIOUS ISO year when they belong to its last week", () => {
    // 2027-01-01 is a Friday in ISO week 53 of 2026 — a real order that day gets a 2026 code.
    expect(isoWeekYear(at("2027-01-01"))).toBe(2026);
    expect(isoWeek(at("2027-01-01"))).toBe(53);
  });

  it("puts late-December days in the NEXT ISO year when they belong to its week 1", () => {
    expect(isoWeekYear(at("2024-12-30"))).toBe(2025);
    expect(isoWeek(at("2024-12-30"))).toBe(1);
    expect(isoWeekYear(at("2025-12-29"))).toBe(2026);
  });
});

describe("codeBand", () => {
  it("pairs two weeks per letter, odd week at 100 and even at 500", () => {
    expect(codeBand(at("2026-01-01"))).toMatchObject({ prefix: "FA", base: 100, ceil: 500 });
    expect(codeBand(at("2026-01-05"))).toMatchObject({ prefix: "FA", base: 500, ceil: 1000 });
  });

  it("splits the final letter of a 53-week year into three 300-wide bands", () => {
    expect(codeBand(at("2026-12-20"))).toMatchObject({ prefix: "FZ", base: 100, ceil: 400 });
    expect(codeBand(at("2026-12-21"))).toMatchObject({ prefix: "FZ", base: 400, ceil: 700 });
    expect(codeBand(at("2026-12-28"))).toMatchObject({ prefix: "FZ", base: 700, ceil: 1000 });
  });

  it("derives the year letter as year − 2020", () => {
    expect(codeBand(at("2021-01-04")).prefix[0]).toBe("A");
    expect(codeBand(at("2026-06-15")).prefix[0]).toBe("F");
    expect(codeBand(at("2027-01-04")).prefix[0]).toBe("G");
  });

  it("keeps same-year codes lexicographically ordered by date", () => {
    // The whole point of the fixed-width format: string sort == creation order.
    const codes = ["2026-01-01", "2026-06-15", "2026-08-23", "2026-12-28"].map((d) => {
      const b = codeBand(at(d));
      return b.prefix + String(b.base).padStart(3, "0");
    });
    expect([...codes].sort()).toEqual(codes);
  });
});

describe("nextOrderCode", () => {
  const d = at("2026-08-23"); // FQ, even week → band 500-999

  it("starts at the band base when nothing exists", () => {
    expect(nextOrderCode([], d)).toBe("FQ500");
  });

  it("takes max+1, so a gap is never backfilled and a code is never reused", () => {
    expect(nextOrderCode(["FQ500", "FQ505"], d)).toBe("FQ506");
  });

  it("ignores codes from another band or prefix", () => {
    expect(nextOrderCode(["ZZ400", "FQ100"], d)).toBe("FQ500");
  });

  it("ignores null, short and non-numeric entries rather than throwing", () => {
    expect(nextOrderCode([null, undefined, "", "AB", "FQxyz", "FQ501"], d)).toBe("FQ502");
  });
});

describe("known quirks of the original, pinned deliberately", () => {
  // These are NOT port bugs — the port is verified byte-identical to the source app's behaviour.
  // They are pre-existing quirks, pinned here so a future change to this file has to confront them
  // rather than "fix" one by accident and change live order ids.

  it("overflows past the band ceiling into a 6-char code when a band fills", () => {
    // An even week's band holds 500 codes (500-999). Order 501 in a single week produces "FQ1000",
    // which is six characters and breaks the fixed-width sort property. Unlikely at today's volume
    // (~77 orders total) but it is a real ceiling, not a guard.
    expect(nextOrderCode(["FQ999"], at("2026-08-23"))).toBe("FQ1000");
  });

  it("maps both 2020 and 2021 to the year letter A", () => {
    // yearLetter clamps `year - 2020` to a minimum of 1, so 2020 and 2021 share 'A'. Harmless in
    // practice — the app did not exist in 2020 — but it means the letter is not a unique year key.
    expect(codeBand(at("2020-12-31")).prefix[0]).toBe("A");
    expect(codeBand(at("2021-01-04")).prefix[0]).toBe("A");
  });
});

describe("codeLabel", () => {
  it("appends a split-load suffix", () => {
    expect(codeLabel({ order_code: "FA100", order_suffix: "a" })).toBe("FA100a");
  });

  it("falls back to the internal number, then to empty", () => {
    expect(codeLabel({ order_code: "FA100" })).toBe("FA100");
    expect(codeLabel({ order_no: 42 })).toBe("42");
    expect(codeLabel({})).toBe("");
  });
});
