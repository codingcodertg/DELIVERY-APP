"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/erp/supabase/client";
import { unwrap, dbErrorMessage } from "@/lib/erp/db-result";
import { inlineFix } from "@/lib/erp/actions";
import { Input } from "@/components/erp/ui/input";
import { statusLabel } from "@/lib/erp/status";
import { usePrefs } from "@/lib/prefs";
import { productImageUrl } from "@/lib/erp/images";
import { SELL_UNITS, SELL_UNIT_LABEL } from "@/lib/erp/domain/units";

const STATUSES = ["active", "special_order", "discontinued", "inactive"];
const selCls =
  "h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm disabled:bg-slate-50 disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500";

type FieldType = "text" | "num" | "status" | "category" | "textarea" | "sellunit";
type T = (en: string, es: string) => string;
// G-10 (D-204): texto de pantalla por pares inline (usePrefs). Las claves de campo (lo que se guarda
// y se parchea) viven en FIELD_KEYS y no cambian; la etiqueta se construye con t(). Los estados son
// enumerado fijo (statusLabel); categorías y unidades de venta son dato.
const FIELD_KEYS: { key: string; cost?: boolean; type?: FieldType }[] = [
  { key: "name" }, { key: "status", type: "status" }, { key: "category_id", type: "category" }, { key: "price", type: "num" },
  { key: "sell_unit", type: "sellunit" }, { key: "cost", cost: true, type: "num" }, { key: "base_unit" }, { key: "sf_per_box", type: "num" },
  { key: "pieces_per_box", type: "num" }, { key: "size_in" }, { key: "size_cm" }, { key: "material" }, { key: "finish" },
  { key: "seo_title" }, { key: "seo_description", type: "textarea" },
];
const fieldLabel = (t: T, key: string): string => ({
  name: t("Name", "Nombre"), status: t("Commercial status", "Estado comercial"), category_id: t("Category", "Categoría"),
  price: t("Price (per sell unit)", "Precio (por unidad de venta)"), sell_unit: t("Sell unit", "Unidad de venta"),
  cost: t("Cost / box", "Costo / caja"), base_unit: t("Base unit", "Unidad base"), sf_per_box: t("SF / box", "SF / caja"),
  pieces_per_box: t("Pieces / box", "Piezas / caja"), size_in: t("Size (in)", "Tamaño (in)"), size_cm: t("Size (cm)", "Tamaño (cm)"),
  material: t("Material", "Material"), finish: t("Finish", "Acabado"), seo_title: t("SEO title", "Título SEO"),
  seo_description: t("SEO description", "Descripción SEO"),
} as Record<string, string>)[key] ?? key;
const FIELDS = FIELD_KEYS;
const SELECT_FIELDS = "id,sku,name,record_status,status,category_id,price,sell_unit,cost,base_unit,sf_per_box,pieces_per_box,size_in,size_cm,material,finish,seo_title,seo_description";

export function ProductDrawer({
  productId,
  canEdit,
  canSeeCost,
  onClose,
}: {
  productId: number;
  canEdit: boolean;
  canSeeCost: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { t } = usePrefs();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<{ sku: string; name: string } | null>(null);
  const [cats, setCats] = useState<{ id: number; path: string }[]>([]);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const sb = createClient();
      // ARC-02: a failed read used to render an empty, still-editable drawer.
      try {
        const [pRes, cRes, imgRes] = await Promise.all([
          sb.from("app_products").select(SELECT_FIELDS).eq("id", productId).maybeSingle(),
          sb.from("categories").select("id,path").order("path"),
          sb.from("product_images").select("storage_path").eq("product_id", productId).eq("sort_order", 0).maybeSingle(),
        ]);
        if (!active) return;
        const p = unwrap(pRes, "product-drawer: app_products");
        const c = unwrap(cRes, "product-drawer: categories");
        const img = unwrap(imgRes, "product-drawer: product_images");
        setCats(c ?? []);
        setImagePath((img?.storage_path as string | undefined) ?? null);
        if (p) {
          const seed: Record<string, string> = {};
          for (const f of FIELDS) {
            const v = (p as Record<string, unknown>)[f.key];
            seed[f.key] = v === null || v === undefined ? "" : String(v);
          }
          setForm(seed);
          setOriginal(seed);
          setMeta({ sku: p.sku as string, name: p.name as string });
        }
      } catch (e) {
        if (!active) return;
        setStatus("error");
        setErrMsg(t(`Could not load this product: ${dbErrorMessage(e)}`, `No se pudo cargar este producto: ${dbErrorMessage(e)}`));
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [productId]);

  async function flush(next: Record<string, string>) {
    if (!canEdit) return;
    const patch: Record<string, string> = {};
    for (const f of FIELDS) {
      if (f.cost && !canSeeCost) continue;
      if (next[f.key] !== original[f.key]) patch[f.key] = next[f.key];
    }
    if (Object.keys(patch).length === 0) return;
    setStatus("saving");
    setErrMsg(null);
    const res = await inlineFix(productId, patch);
    if (!res.ok) {
      setStatus("error");
      setErrMsg(res.error);
    } else {
      setOriginal({ ...next });
      setStatus("saved");
      router.refresh();
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
    }
  }

  function onChange(k: string, v: string) {
    const next = { ...form, [k]: v };
    setForm(next);
    if (!canEdit) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next), 700);
  }
  function onBlur() {
    if (timer.current) clearTimeout(timer.current);
    flush(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{meta?.name ?? "…"}</div>
            <div className="font-mono text-xs text-slate-400">{meta?.sku}</div>
          </div>
          <div className="flex items-center gap-3">
            {canEdit && status === "saving" && <span className="text-xs text-slate-400">{t("Saving…", "Guardando…")}</span>}
            {canEdit && status === "saved" && <span className="text-xs text-emerald-600">{t("Saved ✓", "Guardado ✓")}</span>}
            {canEdit && status === "error" && <span className="text-xs text-red-600">{t("Error", "Error")}</span>}
            <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">
              ✕
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-500">{t("Loading…", "Cargando…")}</div>
        ) : (
          <div className="space-y-3 p-4">
            {productImageUrl(imagePath) && (
              <img src={productImageUrl(imagePath)!} alt={meta?.sku ?? ""} loading="lazy" className="max-h-44 w-full rounded-lg bg-slate-50 object-contain ring-1 ring-slate-100" />
            )}
            {!canEdit && (
              <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-500">
                {t("Read-only — your role can view but not edit (cost hidden).", "Solo lectura — tu rol puede ver pero no editar (costo oculto).")}
              </p>
            )}
            {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
            {FIELDS.filter((f) => !f.cost || canSeeCost).map((f) => (
              <label key={f.key} className="block space-y-1">
                <span className="text-xs text-slate-500">{fieldLabel(t, f.key)}</span>
                {f.type === "status" ? (
                  <select className={selCls} disabled={!canEdit} value={form[f.key] ?? ""} onChange={(e) => onChange(f.key, e.target.value)}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{t(statusLabel(s).en, statusLabel(s).es)}</option>
                    ))}
                  </select>
                ) : f.type === "category" ? (
                  <select className={selCls} disabled={!canEdit} value={form[f.key] ?? ""} onChange={(e) => onChange(f.key, e.target.value)}>
                    <option value="">—</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>{c.path}</option>
                    ))}
                  </select>
                ) : f.type === "sellunit" ? (
                  <select className={selCls} disabled={!canEdit} value={form[f.key] ?? ""} onChange={(e) => onChange(f.key, e.target.value)}>
                    <option value="">—</option>
                    {SELL_UNITS.map((u) => (
                      <option key={u} value={u}>{SELL_UNIT_LABEL[u]}</option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea
                    disabled={!canEdit}
                    rows={3}
                    value={form[f.key] ?? ""}
                    onChange={(e) => onChange(f.key, e.target.value)}
                    onBlur={onBlur}
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
                  />
                ) : (
                  <Input
                    disabled={!canEdit}
                    value={form[f.key] ?? ""}
                    onChange={(e) => onChange(f.key, e.target.value)}
                    onBlur={onBlur}
                    inputMode={f.type === "num" ? "decimal" : undefined}
                  />
                )}
              </label>
            ))}
            <a href={`/erp/product/${productId}`} className="inline-block pt-2 text-sm text-clay-600 hover:underline">
              {t("Full detail →", "Ficha completa →")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
