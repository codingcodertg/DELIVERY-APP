import Decimal from "decimal.js";

// Exact decimal money math. Postgres `round(numeric, n)` rounds half away from zero, so we match it
// (Decimal.ROUND_HALF_UP) — JS-derived values agree with the SQL masking-view formulas
// (gm_amount, margin_pct) to the cent. All intermediate arithmetic is decimal (no binary-float
// drift, e.g. 1.005 → 1.01, not 1.00); only the final, correctly-rounded value is returned as a
// number so display/signatures are unchanged. DB columns stay Postgres numeric (already exact).
const HALF_UP = Decimal.ROUND_HALF_UP;

export function round2(n: number): number {
  return new Decimal(n).toDecimalPlaces(2, HALF_UP).toNumber();
}
export function round1(n: number): number {
  return new Decimal(n).toDecimalPlaces(1, HALF_UP).toNumber();
}

export function grossMargin(price: number | null | undefined, cost: number | null | undefined): number | null {
  if (price == null || cost == null) return null;
  return new Decimal(price).minus(cost).toDecimalPlaces(2, HALF_UP).toNumber();
}

export function marginPct(price: number | null | undefined, cost: number | null | undefined): number | null {
  if (price == null || cost == null || price === 0) return null;
  return new Decimal(price).minus(cost).div(price).times(100).toDecimalPlaces(1, HALF_UP).toNumber();
}

/** Restate a per-pack total as a per-unit cost (e.g. a per-box cost ÷ SF/box), exact to the cent. */
export function perUnitCost(total: number | null | undefined, units: number | null | undefined): number | null {
  if (total == null || units == null || units === 0) return null;
  return new Decimal(total).div(units).toDecimalPlaces(2, HALF_UP).toNumber();
}
