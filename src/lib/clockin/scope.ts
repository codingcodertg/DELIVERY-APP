import type { AnySupabase } from "@/lib/clockin/supabase/types";

/**
 * Qué tiendas ve quien pregunta, y qué gente hay en ellas.
 *
 * Hasta D-127 esta regla **no se aplicaba nunca**. Decía "un gerente con tienda ve solo su
 * cuadrilla" y la condición era `role === "manager"`, pero `clockin.profiles` jamás emitía ese
 * valor: solo `owner` o `employee`. Ocho de doce personas tenían tienda asignada y no servía
 * para nada — todo el que entraba veía la empresa entera. La migración 089 crea el nivel de
 * verdad; esto es lo que por fin lo usa.
 *
 * La regla, en una frase: **el dueño lo ve todo; un gerente ve su tienda más las que se le
 * hayan concedido; un gerente sin tienda ve todo** (no tener tienda es no estar acotado, no
 * estar acotado a nada — lo contrario dejaría a alguien sin ver a nadie por un campo vacío).
 */

export type StoreScope = {
  /** La tienda "principal", o null si no está acotado. Se conserva por compatibilidad. */
  scopeStore: string | null;
  /** TODAS las tiendas visibles, o null si no está acotado. */
  stores: string[] | null;
  /** Las personas de esas tiendas, o null si no está acotado. */
  ids: string[] | null;
};

/** Las tiendas que ve alguien: null = todas. */
export function visibleStores(
  role: string,
  storeId: string | null,
  extra: string[] | null | undefined,
): string[] | null {
  if (role !== "manager") return null;      // el dueño, y cualquier otro nivel, no se acota
  if (!storeId) return null;                // gerente sin tienda: sin acotar, como siempre
  const todas = [storeId, ...(extra ?? [])].filter(Boolean);
  return [...new Set(todas)];
}

export async function storeScope(
  supabase: AnySupabase,
  companyId: string,
  role: string,
  storeId: string | null,
  extra?: string[] | null,
): Promise<StoreScope> {
  const stores = visibleStores(role, storeId, extra);
  if (!stores) return { scopeStore: null, stores: null, ids: null };
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("company_id", companyId)
    .in("store_id", stores);
  return { scopeStore: storeId, stores, ids: (data ?? []).map((p) => p.id as string) };
}

// Sentinel used with `.in("employee_id", ...)` so an empty allow-list matches
// nothing (rather than being dropped and matching everything).
export const NO_MATCH = ["00000000-0000-0000-0000-000000000000"];
