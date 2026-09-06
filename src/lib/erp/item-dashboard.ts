// Pure helpers for the Item Dashboard (product detail) page. Framework-free so
// they unit-test cleanly. No cost/margin logic lives here (#29 stays at the DB
// view layer).
import { PILL, type Pair } from "@/lib/erp/status";

// ── Status / context ─────────────────────────────────────────────────────────
// A discontinued SKU is NOT the same as inactive: it keeps selling through while
// stock remains, and only goes truly dead once QOH hits 0. Surface that nuance.
// G-10 (D-NEXT): label y note son pares {en, es}; el componente elige con t(). La librería no lee el idioma.
export interface StatusView {
  label: Pair;
  tone: string; // a PILL class
  note: Pair | null;
}

export function statusView(status: string | null | undefined, totalQoh: number | null | undefined): StatusView {
  const qoh = Number(totalQoh ?? 0);
  switch (status) {
    case "active":
      return { label: { en: "Active", es: "Activo" }, tone: PILL.green, note: null };
    case "special_order":
      return { label: { en: "Special order", es: "Pedido especial" }, tone: PILL.amber, note: { en: "made to order — typically no shelf stock", es: "se fabrica bajo pedido — normalmente sin existencia en estante" } };
    case "discontinued":
      return qoh > 0
        ? { label: { en: "Discontinued", es: "Descontinuado" }, tone: PILL.amber, note: { en: `still selling through — ${qoh.toLocaleString()} on hand`, es: `se sigue vendiendo — ${qoh.toLocaleString()} en existencia` } }
        : { label: { en: "Discontinued", es: "Descontinuado" }, tone: PILL.slate, note: { en: "sold out — no stock remaining", es: "agotado — sin existencia" } };
    case "inactive":
      return { label: { en: "Inactive", es: "Inactivo" }, tone: PILL.red, note: null };
    default:
      return { label: { en: status ? status.replace(/_/g, " ") : "—", es: status ? status.replace(/_/g, " ") : "—" }, tone: PILL.gray, note: null };
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
  label: Pair;
  title: Pair;
}

export function verifiedView(verifiedLevel: number | null | undefined, hasConfirmedRef = false): VerifiedView {
  const eff = Math.max(Number(verifiedLevel ?? 0), hasConfirmedRef ? 2 : 0) as 0 | 1 | 2;
  if (eff >= 2) return { marks: 2, symbol: "✓✓", label: { en: "Confirmed", es: "Confirmado" }, title: { en: "Confirmed against the supplier scrape (product_external_refs)", es: "Confirmado contra el rastreo del proveedor (product_external_refs)" } };
  if (eff === 1) return { marks: 1, symbol: "✓", label: { en: "Reviewed", es: "Revisado" }, title: { en: "Human-reviewed and approved", es: "Revisado y aprobado por una persona" } };
  return { marks: 0, symbol: "", label: { en: "Unverified", es: "Sin verificar" }, title: { en: "Not yet human-reviewed", es: "Aún sin revisión humana" } };
}
