import { describe, it, expect } from "vitest";
import { parseCSV, mapRowsToDrafts } from "@/lib/csv-import";

describe("parseCSV", () => {
  it("parses simple rows", () => {
    expect(parseCSV("a,b,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
  it("handles quoted fields with commas and escaped quotes", () => {
    expect(parseCSV('name,note\n"Doe, John","said ""hi"""')).toEqual([
      ["name", "note"],
      ["Doe, John", 'said "hi"'],
    ]);
  });
  it("handles quoted newlines and CRLF", () => {
    expect(parseCSV('a,b\r\n"line1\nline2",x')).toEqual([["a", "b"], ["line1\nline2", "x"]]);
  });
  it("drops fully-blank rows", () => {
    expect(parseCSV("a,b\n\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("mapRowsToDrafts", () => {
  it("maps known headers and normalizes values", () => {
    const rows = parseCSV(
      'Account,Delivery Address,Delivery Fee,Est. Pallets (sales),Delivery Military Time Windows,Delivery Date\n' +
      'Rio Tile,"123 Main St, McAllen","$1,200.50",4,08:30-17:30,2026-08-10',
    );
    const { drafts, mappedHeaders } = mapRowsToDrafts(rows, "2026-10-23");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      account: "Rio Tile",
      delivery_address: "123 Main St, McAllen",
      delivery_fee: 1200.5,
      est_pallets: 4,
      delivery_windows: "0830-1730",
      delivery_date: "2026-08-10",
      stage: "draft",
    });
    expect(mappedHeaders).toContain("Account");
  });

  it("skips empty rows and reports ignored headers", () => {
    const rows = parseCSV("Account,Nonsense\n,\nRio Tile,x");
    const { drafts, ignoredHeaders } = mapRowsToDrafts(rows);
    expect(drafts).toHaveLength(1);
    expect(ignoredHeaders).toContain("Nonsense");
  });
});
