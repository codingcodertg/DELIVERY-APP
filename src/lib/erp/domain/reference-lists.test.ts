import { describe, it, expect } from "vitest";
import {
  normalizeLocations,
  normalizeAccounts,
  usageCounts,
  type NamedLocation,
  type AccountEntry,
} from "./reference-lists";

const loc = (over: Partial<NamedLocation> = {}): NamedLocation => ({
  name: "Pharr yard",
  address: "100 Main St",
  ...over,
});

describe("normalizeLocations", () => {
  it("trims names and addresses", () => {
    expect(normalizeLocations([loc({ name: "  Pharr yard  ", address: "  100 Main St " })])).toEqual([
      { name: "Pharr yard", address: "100 Main St" },
    ]);
  });

  it("drops rows with no name — a blank row is the editor's empty state, not data", () => {
    expect(normalizeLocations([loc({ name: "   " }), loc()])).toHaveLength(1);
  });

  it("de-duplicates case-insensitively", () => {
    const out = normalizeLocations([loc({ name: "Pharr yard" }), loc({ name: "PHARR YARD" })]);
    expect(out).toHaveLength(1);
  });

  it("keeps the FIRST duplicate, which is the one already in use and already verified", () => {
    const out = normalizeLocations([
      loc({ name: "Pharr yard", address: "100 Main St", lat: 26.2, lng: -98.2 }),
      loc({ name: "pharr yard", address: "different" }),
    ]);
    expect(out[0].address).toBe("100 Main St");
    expect(out[0].lat).toBe(26.2);
  });

  it("keeps auto_approve only when it is true, rather than writing false everywhere", () => {
    const [on] = normalizeLocations([loc({ name: "A", auto_approve: true })]);
    const [off] = normalizeLocations([loc({ name: "B", auto_approve: false })]);
    expect(on.auto_approve).toBe(true);
    expect("auto_approve" in off).toBe(false);
  });

  it("drops a half-set pin rather than storing a broken coordinate", () => {
    const [row] = normalizeLocations([loc({ lat: 26.2, lng: null })]);
    expect("lat" in row).toBe(false);
  });

  it("preserves order otherwise", () => {
    const out = normalizeLocations([loc({ name: "B" }), loc({ name: "A" }), loc({ name: "C" })]);
    expect(out.map((r) => r.name)).toEqual(["B", "A", "C"]);
  });
});

describe("normalizeAccounts", () => {
  const acc = (over: Partial<AccountEntry> = {}): AccountEntry => ({
    name: "Ramirez Flooring",
    contact: "Luis",
    phone: "956-555-0100",
    ...over,
  });

  it("trims and de-duplicates by name", () => {
    const out = normalizeAccounts([acc({ name: " Ramirez Flooring " }), acc({ name: "ramirez flooring" })]);
    expect(out).toEqual([{ name: "Ramirez Flooring", contact: "Luis", phone: "956-555-0100", intertienda: false }]);
  });

  it("always writes intertienda as a boolean, so the order form never sees undefined", () => {
    expect(normalizeAccounts([acc()])[0].intertienda).toBe(false);
    expect(normalizeAccounts([acc({ intertienda: true })])[0].intertienda).toBe(true);
  });

  it("drops an unnamed account", () => {
    expect(normalizeAccounts([acc({ name: "" })])).toEqual([]);
  });
});

describe("usageCounts", () => {
  const orders = [
    { store: "Pharr" },
    { store: "pharr " },
    { store: "McAllen" },
    { store: null },
    { other: "Pharr" },
  ];

  it("counts references case- and whitespace-insensitively", () => {
    const counts = usageCounts(orders, "store", ["Pharr", "McAllen"]);
    expect(counts.get("pharr")).toBe(2);
    expect(counts.get("mcallen")).toBe(1);
  });

  it("reports zero for an entry nothing references, rather than omitting it", () => {
    // The zero is the point: it is what tells somebody a row is safe to delete.
    const counts = usageCounts(orders, "store", ["Weslaco"]);
    expect(counts.get("weslaco")).toBe(0);
  });

  it("ignores a different field", () => {
    expect(usageCounts(orders, "store", ["Pharr"]).get("pharr")).toBe(2);
  });
});
