import type { AnySupabase } from "@/lib/clockin/supabase/types";

// Store-scoping rule, shared by every manager screen so it stays consistent:
//   - owner (or a manager with no home store) sees the WHOLE company
//   - a manager WITH a home store sees only that store's crew
//
// Returns `scopeStore` (the store id to filter profiles by, or null = all) and
// `ids` (the employee ids in that store, or null = everyone). Filter profile
// queries with `.eq("store_id", scopeStore)` when set, and employee_id-keyed
// queries with `.in("employee_id", ids)` when set.

export type StoreScope = { scopeStore: string | null; ids: string[] | null };

export async function storeScope(
  supabase: AnySupabase,
  companyId: string,
  role: string,
  storeId: string | null,
): Promise<StoreScope> {
  const scopeStore = role === "manager" && storeId ? storeId : null;
  if (!scopeStore) return { scopeStore: null, ids: null };
  const { data } = await supabase.from("profiles").select("id").eq("company_id", companyId).eq("store_id", scopeStore);
  return { scopeStore, ids: (data ?? []).map((p) => p.id as string) };
}

// Sentinel used with `.in("employee_id", ...)` so an empty allow-list matches
// nothing (rather than being dropped and matching everything).
export const NO_MATCH = ["00000000-0000-0000-0000-000000000000"];
