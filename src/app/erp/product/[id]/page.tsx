import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { type FamilyMember } from "@/components/erp/product-family";
import { productImageUrl } from "@/lib/erp/images";
import { type DaltileRef } from "@/components/erp/daltile-card";
import { statusView, boxesToSqFt } from "@/lib/erp/item-dashboard";
import { type StoreQoh } from "@/components/erp/item/qoh-panel";
import { ProductDetail, type LotRow, type PriceHistoryRow, type ProductRow } from "@/components/erp/product-detail";

export const dynamic = "force-dynamic";

// G-10 (D-NEXT): esta página es un server component y el idioma vive en el navegador (usePrefs),
// así que aquí no queda texto: se consulta y se calcula todo, y ProductDetail (cliente) lo pinta en
// el idioma elegido. Los ayudantes de pintado (Field, Section, val, "mgr only", "Phase 2") se fueron
// con el texto. Las consultas, el 404, la familia, el permiso de costo y los cálculos no cambian.

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  const { id } = await params;
  const supabase = await createClient();

  // Unwrapped (ARC-02). A genuinely missing product is `data: null, error: null` and
  // still 404s; only a real query/RLS failure raises — it used to 404 instead, which
  // read as "this product does not exist".
  const p = unwrap(await supabase.from("app_products").select("*").eq("id", id).maybeSingle(), "product: app_products");
  if (!p) notFound();

  const [storeRes, historyRes, storesRes, imgRes, lotRes] = await Promise.all([
    supabase.from("app_store_products").select("*").eq("product_id", id),
    supabase.from("app_price_history").select("*").eq("product_id", id).order("effective_from", { ascending: false }).limit(24),
    supabase.from("stores").select("id,name").order("id"),
    supabase.from("product_images").select("storage_path,sort_order").eq("product_id", id).order("sort_order"),
    supabase.from("app_lots").select("*").eq("product_id", id).order("received_date", { ascending: false }).order("id", { ascending: false }).limit(20),
  ]);
  const storeRows = unwrap(storeRes, "product: app_store_products");
  const history = unwrap(historyRes, "product: app_price_history");
  const stores = unwrap(storesRes, "product: stores");
  const imgs = unwrap(imgRes, "product: product_images");
  const lots = unwrap(lotRes, "product: app_lots");

  // Family (bros/cuz/sub) from product_relations; app_products masks cost (#29).
  const rels = unwrap(
    await supabase.from("product_relations").select("related_product_id, relation").eq("product_id", id),
    "product: product_relations",
  );
  const relIds = Array.from(new Set((rels ?? []).map((r) => r.related_product_id as number)));
  const famMap = new Map<number, FamilyMember>();
  if (relIds.length) {
    const [famRes, famImgRes] = await Promise.all([
      supabase.from("app_products").select("id,sku,name,status,price,sell_unit").in("id", relIds),
      supabase.from("product_images").select("product_id,storage_path").in("product_id", relIds).eq("sort_order", 0),
    ]);
    const famRows = unwrap(famRes, "product: family app_products");
    const famImgs = unwrap(famImgRes, "product: family product_images");
    const imgMap = new Map((famImgs ?? []).map((i) => [i.product_id as number, i.storage_path as string]));
    for (const f of (famRows ?? []) as Array<{ id: number; sku: string; name: string; status: string; price: number | null; sell_unit: string | null }>) {
      famMap.set(f.id, { id: f.id, sku: f.sku, name: f.name, status: f.status, price: f.price, sell_unit: f.sell_unit, image_path: imgMap.get(f.id) ?? null });
    }
  }
  const familyOf = (rel: string) =>
    (rels ?? []).filter((r) => r.relation === rel).map((r) => famMap.get(r.related_product_id as number)).filter((m): m is FamilyMember => !!m);
  const bros = familyOf("bro");
  const cuz = familyOf("cuz");
  const subs = familyOf("sub");

  const dref = unwrap(
    await supabase.from("product_external_refs").select("*").eq("product_id", id).neq("match_status", "rejected").maybeSingle(),
    "product: product_external_refs",
  );

  const showCost = canSeeCost(session.role); // admin/manager — staff never sees cost/margin (#29)
  const canManage = session.role === "admin" || session.role === "manager";
  const storeName = (sid: string) => stores?.find((s) => s.id === sid)?.name ?? sid;
  const sortedStores = [...(storeRows ?? [])].sort((a, b) => storeName(a.store_id).localeCompare(storeName(b.store_id)));

  const sv = statusView(p.status, p.qoh);
  const sfPerBox = p.sf_per_box as number | null;
  const totalSqFt = boxesToSqFt(p.qoh as number | null, sfPerBox);

  // (2) Images: image_urls[] first (the new column), then curated product_images.
  const galleryUrls = Array.from(
    new Set([
      ...(((p.image_urls as string[] | null) ?? []).filter(Boolean)),
      ...((imgs ?? []).map((i) => productImageUrl(i.storage_path as string)).filter((u): u is string => !!u)),
    ]),
  );

  // (4) QOH per-store rows for the collapsible panel.
  const storeQoh: StoreQoh[] = sortedStores.map((s) => ({
    store_id: s.store_id,
    store_name: storeName(s.store_id),
    qoh: s.qoh ?? null,
    sq_ft: boxesToSqFt(s.qoh ?? null, sfPerBox),
    qb_code: s.qb_code ?? null,
    qb_description: s.qb_description ?? null,
    assortment_active: !!s.assortment_active,
    store_price: s.store_price ?? null,
    qoh_verified: !!s.qoh_verified,
    store_cost: showCost ? (s.store_cost ?? null) : null,
    store_margin_pct: showCost ? (s.store_margin_pct ?? null) : null,
  }));

  return (
    <>
      <Header />
      <ProductDetail
        p={p as ProductRow}
        sv={sv}
        lots={(lots ?? []) as LotRow[]}
        history={(history ?? []) as PriceHistoryRow[]}
        storeNames={Object.fromEntries((stores ?? []).map((s) => [s.id as string, s.name as string]))}
        storeQoh={storeQoh}
        totalSqFt={totalSqFt}
        galleryUrls={galleryUrls}
        bros={bros}
        cuz={cuz}
        subs={subs}
        dref={(dref as DaltileRef | null) ?? null}
        showCost={showCost}
        canManage={canManage}
        isAdmin={session.role === "admin"}
      />
    </>
  );
}
