// Reading the bits of deliveries.settings that change what the app allows, rather than how it looks.

export interface StoreSetting {
  name?: string | null;
  address?: string | null;
  auto_approve?: boolean | null;
}

/**
 * The stores that approve their own orders.
 *
 * Mirrors deliveries.store_auto_approves() (v4_77), which the database trigger consults on every
 * write. Kept as a Set so the UI can answer the same question per row without a query each time —
 * but the database remains the one that decides: this only governs which buttons are offered.
 */
export function autoApproveStores(stores: StoreSetting[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const s of stores ?? []) {
    const name = (s?.name ?? "").trim();
    if (name && s?.auto_approve === true) out.add(name);
  }
  return out;
}

export function storeAutoApproves(
  store: string | null | undefined,
  stores: StoreSetting[] | null | undefined
): boolean {
  const name = (store ?? "").trim();
  return name ? autoApproveStores(stores).has(name) : false;
}
