// SKU rules mirror the DB. assign_draft_sku() enforces this exact regex; the base
// products_sku_check additionally tolerates the transient `~MERGE` sentinel (v4_05),
// which is never a user-assignable SKU, so it is intentionally rejected here.

export const SKU_RE = /^[A-Z0-9][A-Z0-9-]{0,63}$/;

export function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidSku(raw: string): boolean {
  return SKU_RE.test(normalizeSku(raw));
}
