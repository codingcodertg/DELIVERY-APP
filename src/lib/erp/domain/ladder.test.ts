import { describe, it, expect } from "vitest";
import { matchByLadder } from "@/lib/erp/domain/ladder";

const cands = [
  { id: 1, sku: "A", name: "Bondi White 12x24", mpn: "BON-WHT" },
  { id: 2, sku: "B", name: "Neutro Grey 12x24", mpn: "NEU-GRY" },
];

describe("matchByLadder", () => {
  it("matches MPN exact first (case-insensitive)", () => {
    expect(matchByLadder({ mpn: "bon-wht", name: "irrelevant" }, cands)?.id).toBe(1);
  });
  it("falls back to name contains when MPN misses", () => {
    expect(matchByLadder({ name: "neutro" }, cands)?.id).toBe(2);
  });
  it("prefers MPN over name when they point at different rows", () => {
    expect(matchByLadder({ mpn: "NEU-GRY", name: "Bondi" }, cands)?.id).toBe(2);
  });
  it("returns null when nothing matches", () => {
    expect(matchByLadder({ mpn: "ZZ", name: "nope" }, cands)).toBeNull();
  });
});
