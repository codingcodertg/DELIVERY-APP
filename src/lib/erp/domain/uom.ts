// Unit-of-measure error detection (review-queue-triage-guide SOP).
//
// The biggest review pile ("below cost") is mostly NOT a pricing problem: cost ≥ ~1.5×
// price across a product line is the signature of a UoM error — a per-box/bag/bucket
// cost stapled to a per-SF/piece price. The fix is to correct the *unit*, not reprice.
// This module SUGGESTS; a manager applies via update_product (audit + price_history fire).

import { perUnitCost } from "./pricing";

export type UomSeverity = "high" | "marginal" | "none";

export type UomFlag = {
  isLikelyError: boolean; // true only for the high-confidence (UoM) band
  ratio: number | null; // cost / price
  severity: UomSeverity;
  suggestion: string | null;
};

export function detectUomError(
  price: number | null | undefined,
  cost: number | null | undefined,
  opts?: { highRatio?: number; marginalRatio?: number }
): UomFlag {
  const highRatio = opts?.highRatio ?? 1.5;
  const marginalRatio = opts?.marginalRatio ?? 1.0;
  if (price == null || cost == null || price <= 0 || cost <= 0) {
    return { isLikelyError: false, ratio: null, severity: "none", suggestion: null };
  }
  const ratio = cost / price;
  if (ratio >= highRatio) {
    return {
      isLikelyError: true,
      ratio,
      severity: "high",
      suggestion:
        "Cost ≥ 1.5× price — likely a unit-of-measure error (per-box cost on a per-unit price). " +
        "Verify base_unit and restate cost & price in the same unit before judging margin. Don't reprice.",
    };
  }
  if (ratio >= marginalRatio) {
    return {
      isLikelyError: false,
      ratio,
      severity: "marginal",
      suggestion:
        "Cost ≥ price — confirm cost against the most-recent vendor bill, then reprice to target margin " +
        "or flag as a deliberate loss-leader / discontinue.",
    };
  }
  return { isLikelyError: false, ratio, severity: "none", suggestion: null };
}

export function medianOf(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** True when a product's cost is a multiple (default ≥2×) of its line-mates' median cost —
 *  the ACUARELA-style outlier the triage guide describes. */
export function isCostOutlier(cost: number, lineMateCosts: number[], factor = 2): boolean {
  const others = lineMateCosts.filter((c) => c > 0);
  if (others.length < 2) return false;
  const median = medianOf(others);
  return median != null && median > 0 && cost / median >= factor;
}

export type UomSuggestion = {
  flag: UomFlag;
  proposedCost: number | null;
  proposedBaseUnit: string | null;
  rationale: string | null;
};

/** Turn a high-confidence UoM flag into a concrete, manager-applies suggestion. When sf_per_box
 *  explains the ratio (a per-box cost on a per-SF price), proposes restating the cost per SF — this
 *  corrects the cost's UNIT, it never reprices. Returns no proposal for marginal/none. */
export function suggestUomFix(p: {
  price?: number | null;
  cost?: number | null;
  sf_per_box?: number | null;
  base_unit?: string | null;
}): UomSuggestion {
  const flag = detectUomError(p.price, p.cost);
  if (flag.severity !== "high" || p.price == null || p.cost == null) {
    return { flag, proposedCost: null, proposedBaseUnit: null, rationale: null };
  }
  const sf = p.sf_per_box ?? null;
  if (sf && sf > 0) {
    const perSf = perUnitCost(p.cost, sf);
    if (perSf != null && perSf > 0 && perSf <= p.price * 1.1) {
      const unit = p.base_unit && p.base_unit.trim().toUpperCase() === "SF" ? p.base_unit : "SF";
      return {
        flag,
        proposedCost: perSf,
        proposedBaseUnit: unit,
        rationale: `Cost ${p.cost} ÷ ${sf} SF/box ≈ ${perSf}/SF, in line with the ${p.price} price — a per-box cost on a per-SF price.`,
      };
    }
  }
  return {
    flag,
    proposedCost: null,
    proposedBaseUnit: null,
    rationale: "Likely a per-box cost on a per-unit price. Verify base_unit and restate the cost in the price's unit before repricing.",
  };
}
