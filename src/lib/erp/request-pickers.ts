// Los datos de los desplegables del formulario de solicitud (request-form.tsx): categorías, proveedores,
// tiendas y el vocabulario (unidad base, material, acabado, estilo, color). D-553: el formulario se
// abre ahora también desde cada fila del catálogo (request-drawer.tsx), y esos datos se cargan UNA vez
// por página —en /erp/catalog y en /erp/request—, nunca por fila ni por apertura. Esta función es la
// única lectura, para que las dos páginas no tengan dos copias de las mismas cuatro consultas.
//
// Las lecturas se desenvuelven (ARC-02): una que falle levanta en vez de pintar el formulario con
// desplegables vacíos, que cambiaría en silencio lo que se puede enviar.

import type { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import type { Vocabulario } from "@/components/erp/request-form";

type SB = Awaited<ReturnType<typeof createClient>>;

export type RequestPickers = {
  categories: { id: number; path: string }[];
  vendors: { id: number; name: string }[];
  stores: { id: string; name: string }[];
  vocab: Vocabulario;
};

export async function loadRequestPickers(supabase: SB, donde: string): Promise<RequestPickers> {
  const [catRes, vendorRes, storeRes, vocabRes] = await Promise.all([
    supabase.from("categories").select("id,path").order("path"),
    supabase.from("vendors").select("id,name").order("name"),
    supabase.from("stores").select("id,name").order("id"),
    // PRF-04: this used to pull the whole catalog (`.limit(10000)`, silently capped at 1,000 of 6,528)
    // purely to derive three DISTINCT vocabularies — so ~5,500 products never contributed a value to
    // the pickers. One small aggregate instead (product_vocabulary, v4_65; style y color desde la 158).
    supabase.rpc("product_vocabulary"),
  ]);
  const cats = unwrap(catRes, `${donde}: categories`);
  const vendors = unwrap(vendorRes, `${donde}: vendors`);
  const stores = unwrap(storeRes, `${donde}: stores`);
  const vocab = unwrap(vocabRes, `${donde}: product_vocabulary`) as Partial<Vocabulario> | null;
  const uniq = (k: keyof Vocabulario) => vocab?.[k] ?? [];
  return {
    categories: (cats ?? []) as RequestPickers["categories"],
    vendors: (vendors ?? []) as RequestPickers["vendors"],
    stores: (stores ?? []) as RequestPickers["stores"],
    vocab: { base_unit: uniq("base_unit"), material: uniq("material"), finish: uniq("finish"), style: uniq("style"), color: uniq("color") },
  };
}
