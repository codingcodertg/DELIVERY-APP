"use client";

import Link from "next/link";
import { Badge } from "@/components/erp/ui/badge";
import { money } from "@/lib/erp/utils";
import { recordStatusClass, label } from "@/lib/erp/status";
import { PublishButton } from "@/components/erp/publish-button";
import { PoDraftPanel } from "@/components/erp/po-draft-panel";
import { SeoEditor } from "@/components/erp/seo-editor";
import { ProductFamily, type FamilyMember } from "@/components/erp/product-family";
import { priceUnitSuffix } from "@/lib/erp/domain/units";
import { DaltileCard, type DaltileRef } from "@/components/erp/daltile-card";
import type { StatusView } from "@/lib/erp/item-dashboard";
import { VerifiedBadge } from "@/components/erp/item/verified-badge";
import { PricingBar } from "@/components/erp/item/pricing-bar";
import { ProductGallery } from "@/components/erp/item/product-gallery";
import { QohPanel, type StoreQoh } from "@/components/erp/item/qoh-panel";
import { SuggestFixButton } from "@/components/erp/item/suggest-fix-button";
import { usePrefs } from "@/lib/prefs";

/**
 * El detalle de producto, pintado en el cliente (G-10, D-203).
 *
 * product/[id]/page.tsx es un server component y era el fichero con más texto del ERP (~69
 * textos). El idioma vive en el navegador (usePrefs, localStorage) y el servidor no lo ve, así
 * que el texto se pinta aquí: la página hace TODAS las consultas y los cálculos, y pasa los datos
 * ya listos; este componente solo los coloca y pone las etiquetas en el idioma elegido. Es el
 * mismo árbol que tenía la página, movido, con t(en, es) donde había texto fijo.
 *
 * Dato vs texto: nombre, SKU, valores de campo, el estado (sv.label / sv.note, de
 * item-dashboard), label(record_status), el estado de un lote y la fuente de un precio son datos
 * y salen tal cual.
 */

/** Los campos de app_products que esta pantalla lee. El resto de la fila viaja igual y no se mira. */
export interface ProductRow {
  id: number;
  sku: string;
  name: string;
  status: string | null;
  record_status: string;
  verified_level: number | null;
  review_tags: string[] | null;
  mpn: string | null;
  cost: number | null;
  vendor_name: string | null;
  discontinue_reason: unknown;
  product_type: unknown;
  barcode_upc: unknown;
  date_added: string | null;
  description: unknown;
  product_url: string | null;
  folder_url: string | null;
  price: number | null;
  sell_unit: string | null;
  price_erp: number | null;
  price_sales: number | null;
  price_mgr: number | null;
  price_vol: number | null;
  price_kind: string | null;
  price_mode: string | null;
  price_approved: unknown;
  taxable: unknown;
  material: unknown;
  finish: unknown;
  color1: string | null;
  color2: string | null;
  look: unknown;
  color_observation: unknown;
  substitute_color: unknown;
  style: unknown;
  collection: unknown;
  size_in: unknown;
  size_cm: unknown;
  origin: unknown;
  pieces_per_box: unknown;
  sf_per_box: number | null;
  weight_per_box_lbs: unknown;
  boxes_per_pallet: unknown;
  lbs_per_pallet: unknown;
  base_unit: unknown;
  moq_group: unknown;
  bros: string | null;
  cuz: string | null;
  subs: string | null;
  qoh: number | null;
  gm_amount: number | null;
  margin_pct: number | null;
  price_source: unknown;
  seo_title: string | null;
  seo_description: string | null;
}

export interface LotRow {
  id: number;
  lot_number: unknown;
  received_date: string | null;
  status: unknown;
  base_cost: number | null;
  freight_cost: number | null;
  duty_cost: number | null;
  landed_cost: number | null;
}

export interface PriceHistoryRow {
  id: number;
  effective_from: string;
  store_id: string | null;
  price: number | null;
  cost: number | null;
  source: unknown;
}

export interface ProductDetailProps {
  p: ProductRow;
  sv: StatusView;
  lots: LotRow[];
  history: PriceHistoryRow[];
  /** id de tienda → nombre, para el historial de precios. */
  storeNames: Record<string, string>;
  storeQoh: StoreQoh[];
  totalSqFt: number | null;
  galleryUrls: string[];
  bros: FamilyMember[];
  cuz: FamilyMember[];
  subs: FamilyMember[];
  dref: DaltileRef | null;
  showCost: boolean;
  canManage: boolean;
  isAdmin: boolean;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{children ?? "—"}</span>
    </div>
  );
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

export function ProductDetail({
  p, sv, lots, history, storeNames, storeQoh, totalSqFt, galleryUrls, bros, cuz, subs, dref, showCost, canManage, isAdmin,
}: ProductDetailProps) {
  const { t } = usePrefs();

  // Un valor crudo → lo que se enseña. Yes/No es texto; lo demás es dato y sale tal cual.
  const val = (v: unknown): React.ReactNode => {
    if (v === null || v === undefined || v === "") return "—";
    if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
    if (typeof v === "boolean") return v ? t("Yes", "Sí") : t("No", "No");
    return String(v);
  };
  const storeName = (sid: string) => storeNames[sid] ?? sid;
  const mgrTag = <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">{t("mgr only", "solo gerente")}</span>;
  const phase2 = <span className="text-sm text-slate-400">{t("Populates in Phase 2.", "Se rellena en la fase 2.")}</span>;

  return (
    <main className="mx-auto max-w-screen-2xl px-4 py-6">
      <Link href="/erp/catalog" className="text-sm text-clay-600 hover:underline">{t("← Catalog", "← Catálogo")}</Link>

      {/* ─ Title row ─ */}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <Badge className={sv.tone}>{sv.label}</Badge>
        <Badge className={recordStatusClass(p.record_status)}>{label(p.record_status)}</Badge>
        <VerifiedBadge level={p.verified_level} hasConfirmedRef={dref?.match_status === "confirmed"} />
        <span className="font-mono text-sm text-slate-500">{p.sku}</span>
        <div className="ml-auto flex items-center gap-2">
          <SuggestFixButton productId={p.id} />
          {isAdmin && p.record_status === "draft" && <PublishButton productId={p.id} />}
        </div>
      </div>
      {sv.note && <p className="mt-1 text-sm text-slate-500">{sv.note}</p>}
      {Array.isArray(p.review_tags) && p.review_tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {p.review_tags.map((tag: string) => (
            <Badge key={tag} className="border-amber-200 bg-amber-50 text-amber-700">{tag}</Badge>
          ))}
        </div>
      )}

      {dref && <div className="mt-4"><DaltileCard dref={dref} canManage={canManage} /></div>}
      {showCost && p.record_status === "draft" && Array.isArray(p.review_tags) && p.review_tags.includes("PO IMPORT") && (
        <PoDraftPanel productId={p.id} mpn={p.mpn} cost={p.cost} vendorName={p.vendor_name} />
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {/* (1) Identity / status */}
        <Section title={t("Identity & status", "Identidad y estado")}>
          <Field label="SKU">{val(p.sku)}</Field>
          <Field label={t("Name", "Nombre")}>{val(p.name)}</Field>
          <Field label={t("Status", "Estado")}>{sv.label}{sv.note ? ` — ${sv.note}` : ""}</Field>
          <Field label={t("Record status", "Estado del registro")}>{label(p.record_status)}</Field>
          {p.status === "discontinued" && <Field label={t("Discontinue reason", "Motivo de descontinuación")}>{val(p.discontinue_reason)}</Field>}
          <Field label={t("Product type", "Tipo de producto")}>{val(p.product_type)}</Field>
          <Field label={t("Vendor", "Proveedor")}>{val(p.vendor_name)}</Field>
          <Field label="MPN">{val(p.mpn)}</Field>
          <Field label={t("Barcode (UPC)", "Código de barras (UPC)")}>{val(p.barcode_upc)}</Field>
          <Field label={t("Date added", "Fecha de alta")}>{p.date_added ? new Date(p.date_added).toLocaleDateString() : "—"}</Field>
          <Field label={t("Description", "Descripción")}>{val(p.description)}</Field>
          <Field label={t("Product page", "Página del producto")}>{p.product_url ? <a href={p.product_url} target="_blank" rel="noopener noreferrer" className="text-clay-600 hover:underline">{t("open ↗", "abrir ↗")}</a> : "—"}</Field>
        </Section>

        {/* (2) Images */}
        <Section title={t("Images", "Imágenes")}>
          <ProductGallery images={galleryUrls} folderUrl={p.folder_url ?? null} alt={p.name} />
        </Section>

        {/* (3) Pricing bar — sales-visible tiers */}
        <Section title={t("Pricing", "Precios")}>
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
            <Field label={t("Current price", "Precio actual")}>{p.price == null ? "—" : <>{money(p.price)}<span className="text-slate-400">{priceUnitSuffix(p.sell_unit)}</span></>}</Field>
            <Field label={t("Sell unit", "Unidad de venta")}>{val(p.sell_unit)}</Field>
            <Field label={t("Price approved", "Precio aprobado")}>{val(p.price_approved)}</Field>
            <Field label={t("Taxable", "Gravable")}>{val(p.taxable)}</Field>
          </div>
        </Section>

        {/* (5) Characteristics */}
        <Section title={t("Characteristics", "Características")}>
          <Field label={t("Material", "Material")}>{val(p.material)}</Field>
          <Field label={t("Finish", "Acabado")}>{val(p.finish)}</Field>
          <Field label={t("Color", "Color")}>{[p.color1, p.color2].filter(Boolean).join(" / ") || "—"}</Field>
          <Field label={t("Look", "Aspecto")}>{val(p.look)}</Field>
          <Field label={t("Color observation", "Observación de color")}>{val(p.color_observation)}</Field>
          <Field label={t("Substitute color", "Color sustituto")}>{val(p.substitute_color)}</Field>
          <Field label={t("Style", "Estilo")}>{val(p.style)}</Field>
          <Field label={t("Collection", "Colección")}>{val(p.collection)}</Field>
          <Field label={t("Size (in)", "Tamaño (in)")}>{val(p.size_in)}</Field>
          <Field label={t("Size (cm)", "Tamaño (cm)")}>{val(p.size_cm)}</Field>
          <Field label={t("Origin", "Origen")}>{val(p.origin)}</Field>
        </Section>

        {/* (6) Packaging / logistics */}
        <Section title={t("Packaging & logistics", "Empaque y logística")}>
          <Field label={t("Pieces / box", "Piezas / caja")}>{val(p.pieces_per_box)}</Field>
          <Field label={t("SF / box", "SF / caja")}>{val(p.sf_per_box)}</Field>
          <Field label={t("Lbs / box", "Lbs / caja")}>{val(p.weight_per_box_lbs)}</Field>
          <Field label={t("Boxes / pallet", "Cajas / tarima")}>{val(p.boxes_per_pallet)}</Field>
          <Field label={t("Lbs / pallet", "Lbs / tarima")}>{val(p.lbs_per_pallet)}</Field>
          <Field label={t("Base unit", "Unidad base")}>{val(p.base_unit)}</Field>
          {canManage && (
            <div className="mt-3 border-t border-slate-100 pt-2">
              <div className="mb-1 flex items-center gap-2"><span className="text-xs font-medium text-slate-500">{t("Logistics", "Logística")}</span>{mgrTag}</div>
              <Field label={t("Truck quantity", "Cantidad por camión")}>{phase2}</Field>
              <Field label={t("Lead time", "Plazo de entrega")}>{phase2}</Field>
              <Field label={t("MOQ (RTG)", "MOQ (RTG)")}>{p.moq_group == null ? phase2 : val(p.moq_group)}</Field>
              <Field label={t("MOQ (supplier)", "MOQ (proveedor)")}>{phase2}</Field>
            </div>
          )}
        </Section>

        {/* Relationships */}
        <Section title={t("Relationships", "Relaciones")}>
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
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("On-hand (QOH)", "Existencia (QOH)")}</h2>
        <QohPanel unifiedCode={p.sku} description={p.name} totalBoxes={p.qoh ?? null} totalSqFt={totalSqFt} stores={storeQoh} showCost={showCost} />
      </section>

      {/* (7) Demand analysis — mgr/admin */}
      {canManage && (
        <Section title={t("Demand analysis", "Análisis de demanda")} badge={mgrTag}>
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            <Field label={t("Units sold (90d)", "Unidades vendidas (90 d)")}>{phase2}</Field>
            <Field label={t("Velocity (units/mo)", "Velocidad (unidades/mes)")}>{phase2}</Field>
            <Field label={t("Weeks of supply", "Semanas de suministro")}>{phase2}</Field>
            <Field label={t("Reorder point", "Punto de reorden")}>{phase2}</Field>
            <Field label={t("Sell-through rate", "Tasa de venta")}>{phase2}</Field>
            <Field label={t("Seasonality", "Estacionalidad")}>{phase2}</Field>
          </div>
          <p className="mt-2 text-xs text-slate-400">{t("Demand analysis derives from sales history + bill dates — wired in Phase 2.", "El análisis de demanda sale del historial de ventas y las fechas de factura — se conecta en la fase 2.")}</p>
        </Section>
      )}

      {/* (8) Cost & margin — admin/manager only (#29; staff never reaches this) */}
      {showCost && (
        <Section title={t("Cost & margin", "Costo y margen")} badge={mgrTag}>
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            <Field label={t("Cost / box", "Costo / caja")}>{money(p.cost)}</Field>
            <Field label={t("Gross margin", "Margen bruto")}>{money(p.gm_amount)}</Field>
            <Field label={t("Margin %", "Margen %")}>{p.margin_pct == null ? "—" : `${p.margin_pct}%`}</Field>
            <Field label={t("Price source", "Fuente del precio")}>{val(p.price_source)}</Field>
            <Field label={t("Asset turnover", "Rotación de activos")}>{phase2}</Field>
            <Field label={t("Profit / unit", "Ganancia / unidad")}>{phase2}</Field>
          </div>

          {lots.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("Lots / receipts", "Lotes / recepciones")}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">{t("Lot #", "Lote #")}</th>
                      <th className="py-1.5 pr-4 font-medium">{t("Received", "Recibido")}</th>
                      <th className="py-1.5 pr-4 font-medium">{t("Status", "Estado")}</th>
                      <th className="py-1.5 pr-4 text-right font-medium">{t("Base", "Base")}</th>
                      <th className="py-1.5 pr-4 text-right font-medium">{t("Freight", "Flete")}</th>
                      <th className="py-1.5 pr-4 text-right font-medium">{t("Duty", "Arancel")}</th>
                      <th className="py-1.5 pr-4 text-right font-medium">{t("Landed cost", "Costo en destino")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.map((l) => (
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
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("Price history", "Historial de precios")}</h3>
            {history.length === 0 ? (
              <p className="text-sm text-slate-500">{t("No price history.", "Sin historial de precios.")}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="py-1.5 pr-4 font-medium">{t("Effective from", "Vigente desde")}</th>
                    <th className="py-1.5 pr-4 font-medium">{t("Store", "Tienda")}</th>
                    <th className="py-1.5 pr-4 text-right font-medium">{t("Price", "Precio")}</th>
                    <th className="py-1.5 pr-4 text-right font-medium">{t("Cost", "Costo")}</th>
                    <th className="py-1.5 pr-4 font-medium">{t("Source", "Fuente")}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-t border-slate-100">
                      <td className="py-1.5 pr-4">{new Date(h.effective_from).toLocaleDateString()}</td>
                      <td className="py-1.5 pr-4">{h.store_id ? storeName(h.store_id) : t("all", "todas")}</td>
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
        <Section title={t("SEO (Shopify / web)", "SEO (Shopify / web)")}>
          <SeoEditor productId={p.id} initialTitle={p.seo_title ?? ""} initialDescription={p.seo_description ?? ""} />
        </Section>
      )}
    </main>
  );
}
