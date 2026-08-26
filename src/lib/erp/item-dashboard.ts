// Pure helpers for the Item Dashboard (product detail) page. Framework-free so
// they unit-test cleanly. No cost/margin logic lives here (#29 stays at the DB
// view layer).
import { PILL } from "@/lib/erp/status";

// ── Status / context ─────────────────────────────────────────────────────────
// A discontinued SKU is NOT the same as inactive: it keeps selling through while
// stock remains, and only goes truly dead once QOH hits 0. Surface that nuance.
export interface StatusView {
  label: string;
  tone: string; // a PILL class
  note: string | null;
}

export function statusView(status: string | null | undefined, totalQoh: number | null | undefined): StatusView {
  const qoh = Number(totalQoh ?? 0);
  switch (status) {
    case "active":
      return { label: "Active", tone: PILL.green, note: null };
    case "special_order":
      return { label: "Special order", tone: PILL.amber, note: "made to order — typically no shelf stock" };
    case "discontinued":
      return qoh > 0
        ? { label: "Discontinued", tone: PILL.amber, note: `still selling through — ${qoh.toLocaleString()} on hand` }
        : { label: "Discontinued", tone: PILL.slate, note: "sold out — no stock remaining" };
    case "inactive":
      return { label: "Inactive", tone: PILL.red, note: null };
    default:
      return { label: status ? status.replace(/_/g, " ") : "—", tone: PILL.gray, note: null };
  }
}

// ── QOH conversion ───────────────────────────────────────────────────────────
// Per-store QOH is carried in BOXES; square footage = boxes × sf/box.
export function boxesToSqFt(boxes: number | null | undefined, sfPerBox: number | null | undefined): number | null {
  if (boxes == null || sfPerBox == null) return null;
  const n = Number(boxes) * Number(sfPerBox);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// ── Verified badge ───────────────────────────────────────────────────────────
// 0 = unverified · 1 = human-reviewed (✓) · 2 = confirmed vs the supplier scrape
// (✓✓). A confirmed product_external_ref counts as a level-2 confirmation even if
// verified_level hasn't been bumped yet.
export interface VerifiedView {
  marks: 0 | 1 | 2;
  symbol: string; // "", "✓", "✓✓"
  label: string;
  title: string;
}

export function verifiedView(verifiedLevel: number | null | undefined, hasConfirmedRef = false): VerifiedView {
  const eff = Math.max(Number(verifiedLevel ?? 0), hasConfirmedRef ? 2 : 0) as 0 | 1 | 2;
  if (eff >= 2) return { marks: 2, symbol: "✓✓", label: "Confirmed", title: "Confirmed against the supplier scrape (product_external_refs)" };
  if (eff === 1) return { marks: 1, symbol: "✓", label: "Reviewed", title: "Human-reviewed and approved" };
  return { marks: 0, symbol: "", label: "Unverified", title: "Not yet human-reviewed" };
}
