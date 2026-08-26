import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { Badge } from "@/components/erp/ui/badge";
import { money } from "@/lib/erp/utils";
import { recordStatusClass, label } from "@/lib/erp/status";
import { PublishButton } from "@/components/erp/publish-button";
import { PoDraftPanel } from "@/components/erp/po-draft-panel";
import { SeoEditor } from "@/components/erp/seo-editor";
import { ProductFamily, type FamilyMember } from "@/components/erp/product-family";
import { priceUnitSuffix } from "@/lib/erp/domain/units";
import { productImageUrl } from "@/lib/erp/images";
import { DaltileCard, type DaltileRef } from "@/components/erp/daltile-card";
import { statusView, boxesToSqFt } from "@/lib/erp/item-dashboard";
import { VerifiedBadge } from "@/components/erp/item/verified-badge";
import { PricingBar } from "@/components/erp/item/pricing-bar";
import { ProductGallery } from "@/components/erp/item/product-gallery";
import { QohPanel, type StoreQoh } from "@/components/erp/item/qoh-panel";
import { SuggestFixButton } from "@/components/erp/item/suggest-fix-button";

export const dynamic = "force-dynamic";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{children ?? "—"}</span>
    </div>
  );
}

function val(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function Section({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

const MgrTag = () => <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">mgr only</span>;
const phase2 = <span className="text-sm text-slate-400">Populates in Phase 2.</span>;

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
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <Link href="/erp/catalog" className="text-sm text-clay-600 hover:underline">← Catalog</Link>

        {/* ─ Title row ─ */}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <Badge className={sv.tone}>{sv.label}</Badge>
          <Badge className={recordStatusClass(p.record_status)}>{label(p.record_status)}</Badge>
          <VerifiedBadge level={p.verified_level} hasConfirmedRef={dref?.match_status === "confirmed"} />
          <span className="font-mono text-sm text-slate-500">{p.sku}</span>
          <div className="ml-auto flex items-center gap-2">
            <SuggestFixButton productId={p.id} />
            {session.role === "admin" && p.record_status === "draft" && <PublishButton productId={p.id} />}
          </div>
        </div>
        {sv.note && <p className="mt-1 text-sm text-slate-500">{sv.note}</p>}
        {Array.isArray(p.review_tags) && p.review_tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.review_tags.map((t: string) => (
              <Badge key={t} className="border-amber-200 bg-amber-50 text-amber-700">{t}</Badge>
            ))}
          </div>
        )}

        {dref && <div className="mt-4"><DaltileCard dref={dref as DaltileRef} canManage={canManage} /></div>}
        {showCost && p.record_status === "draft" && Array.isArray(p.review_tags) && p.review_tags.includes("PO IMPORT") && (
          <PoDraftPanel productId={p.id} mpn={p.mpn} cost={p.cost} vendorName={p.vendor_name} />
        )}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {/* (1) Identity / status */}
          <Section title="Identity & status">
            <Field label="SKU">{val(p.sku)}</Field>
            <Field label="Name">{val(p.name)}</Field>
            <Field label="Status">{sv.label}{sv.note ? ` — ${sv.note}` : ""}</Field>
            <Field label="Record status">{label(p.record_status)}</Field>
            {p.status === "discontinued" && <Field label="Discontinue reason">{val(p.discontinue_reason)}</Field>}
            <Field label="Product type">{val(p.product_type)}</Field>
            <Field label="Vendor">{val(p.vendor_name)}</Field>
            <Field label="MPN">{val(p.mpn)}</Field>
            <Field label="Barcode (UPC)">{val(p.barcode_upc)}</Field>
            <Field label="Date added">{p.date_added ? new Date(p.date_added).toLocaleDateString() : "—"}</Field>
            <Field label="Description">{val(p.description)}</Field>
            <Field label="Product page">{p.product_url ? <a href={p.product_url} target="_blank" rel="noopener noreferrer" className="text-clay-600 hover:underline">open ↗</a> : "—"}</Field>
          </Section>

          {/* (2) Images */}
          <Section title="Images">
            <ProductGallery images={galleryUrls} folderUrl={(p.folder_url as string | null) ?? null} alt={p.name} />
          </Section>

          {/* (3) Pricing bar — sales-visible tiers */}
          <Section title="Pricing">
            <PricingBar
              erp={p.price_erp ?? null}
              sales={p.price_sales ?? null}
              mgr={p.price_mgr ?? null}
              vol={p.price_vol ?? null}
              kind={p.price_kind ?? null}
              mode={p.price_mode ?? null}
              suffix={priceUnitSuffix(p.sell_unit)}
            />
            <div className="mt-3">
              <Field label="Current price">{p.price == null ? "—" : <>{money(p.price)}<span className="text-slate-400">{priceUnitSuffix(p.sell_unit)}</span></>}</Field>
              <Field label="Sell unit">{val(p.sell_unit)}</Field>
              <Field label="Price approved">{val(p.price_approved)}</Field>
              <Field label="Taxable">{val(p.taxable)}</Field>
            </div>
          </Section>

          {/* (5) Characteristics */}
          <Section title="Characteristics">
            <Field label="Material">{val(p.material)}</Field>
            <Field label="Finish">{val(p.finish)}</Field>
            <Field label="Color">{[p.color1, p.color2].filter(Boolean).join(" / ") || "—"}</Field>
            <Field label="Look">{val(p.look)}</Field>
            <Field label="Color observation">{val(p.color_observation)}</Field>
            <Field label="Substitute color">{val(p.substitute_color)}</Field>
            <Field label="Style">{val(p.style)}</Field>
            <Field label="Collection">{val(p.collection)}</Field>
            <Field label="Size (in)">{val(p.size_in)}</Field>
            <Field label="Size (cm)">{val(p.size_cm)}</Field>
            <Field label="Origin">{val(p.origin)}</Field>
          </Section>

          {/* (6) Packaging / logistics */}
          <Section title="Packaging & logistics">
            <Field label="Pieces / box">{val(p.pieces_per_box)}</Field>
            <Field label="SF / box">{val(p.sf_per_box)}</Field>
            <Field label="Lbs / box">{val(p.weight_per_box_lbs)}</Field>
            <Field label="Boxes / pallet">{val(p.boxes_per_pallet)}</Field>
            <Field label="Lbs / pallet">{val(p.lbs_per_pallet)}</Field>
            <Field label="Base unit">{val(p.base_unit)}</Field>
            {canManage && (
              <div className="mt-3 border-t border-slate-100 pt-2">
                <div className="mb-1 flex items-center gap-2"><span className="text-xs font-medium text-slate-500">Logistics</span><MgrTag /></div>
                <Field label="Truck quantity">{phase2}</Field>
                <Field label="Lead time">{phase2}</Field>
                <Field label="MOQ (RTG)">{p.moq_group == null ? phase2 : val(p.moq_group)}</Field>
                <Field label="MOQ (supplier)">{phase2}</Field>
              </div>
            )}
          </Section>

          {/* Relationships */}
          <Section title="Relationships">
            <ProductFamily
              productId={p.id}
              canEdit={canManage}
              bros={bros}
              cuz={cuz}
              subs={subs}
              legacyBros={p.bros ?? null}
              legacyCuz={p.cuz ?? null}
              legacySubs={p.subs ?? null}
            />
          </Section>
        </div>

        {/* (4) QOH — collapsible, sales-visible */}
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">On-hand (QOH)</h2>
          <QohPanel unifiedCode={p.sku} description={p.name} totalBoxes={p.qoh ?? null} totalSqFt={totalSqFt} stores={storeQoh} showCost={showCost} />
        </section>

        {/* (7) Demand analysis — mgr/admin */}
        {canManage && (
          <Section title="Demand analysis" badge={<MgrTag />}>
            <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
              <Field label="Units sold (90d)">{phase2}</Field>
              <Field label="Velocity (units/mo)">{phase2}</Field>
              <Field label="Weeks of supply">{phase2}</Field>
              <Field label="Reorder point">{phase2}</Field>
              <Field label="Sell-through rate">{phase2}</Field>
              <Field label="Seasonality">{phase2}</Field>
            </div>
            <p className="mt-2 text-xs text-slate-400">Demand analysis derives from sales history + bill dates — wired in Phase 2.</p>
          </Section>
        )}

        {/* (8) Cost & margin — admin/manager only (#29; staff never reaches this) */}
        {showCost && (
          <Section title="Cost & margin" badge={<MgrTag />}>
            <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
              <Field label="Cost / box">{money(p.cost)}</Field>
              <Field label="Gross margin">{money(p.gm_amount)}</Field>
              <Field label="Margin %">{p.margin_pct == null ? "—" : `${p.margin_pct}%`}</Field>
              <Field label="Price source">{val(p.price_source)}</Field>
              <Field label="Asset turnover">{phase2}</Field>
              <Field label="Profit / unit">{phase2}</Field>
            </div>

            {(lots?.length ?? 0) > 0 && (
              <div className="mt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Lots / receipts</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="py-1.5 pr-4 font-medium">Lot #</th>
                        <th className="py-1.5 pr-4 font-medium">Received</th>
                        <th className="py-1.5 pr-4 font-medium">Status</th>
                        <th className="py-1.5 pr-4 text-right font-medium">Base</th>
                        <th className="py-1.5 pr-4 text-right font-medium">Freight</th>
                        <th className="py-1.5 pr-4 text-right font-medium">Duty</th>
                        <th className="py-1.5 pr-4 text-right font-medium">Landed cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lots!.map((l) => (
                        <tr key={l.id} className="border-t border-slate-100">
                          <td className="py-1.5 pr-4 font-mono text-xs text-slate-600">{val(l.lot_number)}</td>
                          <td className="py-1.5 pr-4">{l.received_date ? new Date(l.received_date).toLocaleDateString() : "—"}</td>
                          <td className="py-1.5 pr-4 text-slate-600">{val(l.status)}</td>
                          <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">{money(l.base_cost)}</td>
                          <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">{money(l.freight_cost)}</td>
                          <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">{money(l.duty_cost)}</td>
                          <td className="py-1.5 pr-4 text-right tabular-nums font-medium">{money(l.landed_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Price history</h3>
              {(history?.length ?? 0) === 0 ? (
                <p className="text-sm text-slate-500">No price history.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">Effective from</th>
                      <th className="py-1.5 pr-4 font-medium">Store</th>
                      <th className="py-1.5 pr-4 text-right font-medium">Price</th>
                      <th className="py-1.5 pr-4 text-right font-medium">Cost</th>
                      <th className="py-1.5 pr-4 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history!.map((h) => (
                      <tr key={h.id} className="border-t border-slate-100">
                        <td className="py-1.5 pr-4">{new Date(h.effective_from).toLocaleDateString()}</td>
                        <td className="py-1.5 pr-4">{h.store_id ? storeName(h.store_id) : "all"}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{money(h.price)}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">{money(h.cost)}</td>
                        <td className="py-1.5 pr-4 text-slate-500">{val(h.source)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Section>
        )}

        {/* SEO (web) — retained manager tool */}
        {canManage && (
          <Section title="SEO (Shopify / web)">
            <SeoEditor productId={p.id} initialTitle={p.seo_title ?? ""} initialDescription={p.seo_description ?? ""} />
          </Section>
        )}
      </main>
    </>
  );
}
