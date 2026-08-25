// Duplicate warnings on the order form. Ported from deliveries-app's OrderModal (ADR 0010).
//
// Both are WARNINGS, not blocks: the rep is told and decides. Sometimes the same customer really
// does take two loads on one PO, and a rule that refuses would just teach people to fudge the field.

export interface DuplicateCandidate {
  id: string;
  order_no?: number | null;
  order_code?: string | null;
  order_suffix?: string | null;
  stage?: string | null;
  account?: string | null;
  delivery_date?: string | null;
  po2?: string | null;
  invoice_num?: string | null;
}

export interface DuplicateDraft {
  account?: string | null;
  delivery_date?: string | null;
  po2?: string | null;
  invoice_num?: string | null;
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * Another live order for the same account, date and PO.
 *
 * Requires a PO to be present — without one, "same account, same day" is ordinary business, not a
 * mistake, and warning about it would cry wolf on every second order.
 */
export function duplicateOf<T extends DuplicateCandidate>(
  draft: DuplicateDraft,
  deliveries: T[],
  selfId?: string | null
): T | undefined {
  const po = String(draft.po2 ?? "").trim();
  if (!po) return undefined;
  if (!String(draft.account ?? "").trim()) return undefined;
  return deliveries.find(
    (x) =>
      x.id !== selfId &&
      x.stage !== "canceled" &&
      norm(x.account) === norm(draft.account) &&
      (draft.delivery_date || "") === (x.delivery_date || "") &&
      String(x.po2 ?? "").trim() === po
  );
}

/**
 * Another live order already using this customer invoice number.
 *
 * Invoice numbers are meant to be one per delivery, so this is nearly always a typo or a
 * re-entry — but one invoice legitimately covers several drops, which is why the caller can
 * suppress it when the rep has deliberately linked them.
 */
export function duplicateInvoiceOf<T extends DuplicateCandidate>(
  draft: DuplicateDraft,
  deliveries: T[],
  selfId?: string | null
): T | undefined {
  const inv = norm(draft.invoice_num);
  if (!inv) return undefined;
  return deliveries.find(
    (x) => x.id !== selfId && x.stage !== "canceled" && norm(x.invoice_num) === inv
  );
}

/** Pickup and delivery address may never be the same. The one hard rule on the form. */
export function pickupEqualsDropoff(d: {
  pickup_address?: string | null;
  delivery_address?: string | null;
}): boolean {
  const a = norm(d.pickup_address);
  const b = norm(d.delivery_address);
  return !!a && a === b;
}
