"use client";

import Link from "next/link";
import { cn, money } from "@/lib/erp/utils";
import { usePrefs } from "@/lib/prefs";

// G-10 (D-204): pasa a componente de cliente, como po-reconcile: no tenía "use client" pero tampoco
// nada de servidor (recibe props serializables que calcula la página). Tiendas, SKU, nombre, proveedor
// y clase ABC son dato.

export type ReorderItem = {
  product_id: number;
  sku: string;
  name: string;
  vendor: string | null;
  store_id: string;
  qoh: number | null;
  reorder_point: number;
  demand: number | null;
  lead_time_months: number | null;
  abc_class: string | null;
  suggested_qty: number;
  cost: number | null;
};

const chip = (active: boolean) =>
  cn(
    "rounded-md border px-2 py-0.5 text-xs font-medium",
    active ? "border-clay-300 bg-clay-50 text-clay-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
  );
const qty = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString());

export function ReorderPanel({
  items,
  total,
  store,
  stores,
}: {
  items: ReorderItem[];
  total: number;
  store: string | null;
  stores: { id: string; name: string }[];
}) {
  const { t } = usePrefs();
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">{t("Reorder needed", "Hay que reordenar")}</h2>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
          {total.toLocaleString()} {t("at / below reorder point", "en / bajo el punto de reorden")}{store ? ` · ${store}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Link href="/erp/purchasing" className={chip(!store)}>{t("All", "Todas")}</Link>
          {stores.map((s) => (
            <Link key={s.id} href={`/erp/purchasing?store=${s.id}`} className={chip(store === s.id)} title={s.name}>{s.id}</Link>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">{t("Nothing at or below reorder point", "Nada en o bajo el punto de reorden")}{store ? ` ${t("for", "de")} ${store}` : ""}. ✓</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">{t("Product", "Producto")}</th>
                <th className="px-4 py-2 font-medium">{t("Vendor", "Proveedor")}</th>
                <th className="px-4 py-2 font-medium">{t("Store", "Tienda")}</th>
                <th className="px-4 py-2 text-right font-medium">QOH</th>
                <th className="px-4 py-2 text-right font-medium">{t("Reorder pt", "Pto. reorden")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("Suggested", "Sugerido")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("Cost", "Costo")}</th>
                <th className="px-4 py-2 text-center font-medium">ABC</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={`${it.product_id}-${it.store_id}`} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-2">
                    <Link href={`/erp/product/${it.product_id}`} className="font-medium text-clay-700 hover:underline">{it.name}</Link>
                    <span className="ml-1 font-mono text-xs text-slate-400">{it.sku}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{it.vendor ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-600">{it.store_id}</td>
                  <td className={cn("px-4 py-2 text-right tabular-nums", Number(it.qoh) < 0 ? "font-medium text-red-600" : "text-slate-500")}>{qty(it.qoh)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{qty(it.reorder_point)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums text-clay-700">{qty(it.suggested_qty)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{money(it.cost)}</td>
                  <td className="px-4 py-2 text-center">
                    {it.abc_class ? <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">{it.abc_class}</span> : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-xs leading-relaxed text-slate-400">
        {t("Reorder point = demand × lead time + safety stock (from the loaded planning data). Suggested = bring on-hand up to max level (or the reorder point). Showing up to 100, most urgent first. QOH is the real ledger on-hand.", "Punto de reorden = demanda × plazo + stock de seguridad (de los datos de planificación cargados). Sugerido = llevar la existencia al nivel máximo (o al punto de reorden). Se muestran hasta 100, primero los más urgentes. QOH es la existencia real del libro.")}
      </p>
    </section>
  );
}
