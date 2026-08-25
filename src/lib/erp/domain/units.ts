// Buy/sell unit model (ADR 0007). COST is stored per base_unit (the buy/stock unit, usually box);
// PRICE is stored per sell_unit. This module holds the sell_unit list + display labels and a mirror
// of the DB price_in_cost_unit conversion. The AUTHORITATIVE margin/GM is computed server-side in the
// cost-gated app_products view (#29) — this mirror is for labels/help text and is unit-tested so the
// conversion intent stays documented and verifiable client-side.

export const SELL_UNITS = ["sqft", "piece", "box", "bag", "bucket", "linear_ft", "each"] as const;
export type SellUnit = (typeof SELL_UNITS)[number];

export const SELL_UNIT_LABEL: Record<SellUnit, string> = {
  sqft: "sqft",
  piece: "piece",
  box: "box",
  bag: "bag",
  bucket: "bucket",
  linear_ft: "linear ft",
  each: "each",
};

export function isSellUnit(v: unknown): v is SellUnit {
  return typeof v === "string" && (SELL_UNITS as readonly string[]).includes(v);
}

/** Short price suffix for display, e.g. " /sqft" (empty when there's no sell unit). */
export function priceUnitSuffix(u: string | null | undefined): string {
  if (!u) return "";
  return ` /${SELL_UNIT_LABEL[u as SellUnit] ?? u}`;
}

/** Mirror of the DB `price_in_cost_unit` helper: PRICE converted to the cost (base_unit) basis.
 *  Returns null when a needed conversion factor is missing (sqft without sf_per_box, piece without
 *  pieces_per_box) — callers must treat null as "can't compute margin", never as zero. */
export function priceInCostUnit(
  price: number | null | undefined,
  sellUnit: string | null | undefined,
  baseUnit: string | null | undefined,
  sfPerBox: number | null | undefined,
  piecesPerBox: number | null | undefined
): number | null {
  if (price == null) return null;
  const su = (sellUnit ?? "").trim().toLowerCase();
  if (su && su === (baseUnit ?? "").trim().toLowerCase()) return price; // already per cost unit
  if (su === "sqft") return sfPerBox && sfPerBox > 0 ? price * sfPerBox : null;
  if (su === "piece") return piecesPerBox && piecesPerBox > 0 ? price * piecesPerBox : null;
  return price; // box / bag / bucket / each / linear_ft (and unset): price already per cost unit
}
