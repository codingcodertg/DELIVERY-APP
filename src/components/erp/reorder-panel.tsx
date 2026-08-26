import Link from "next/link";
import { cn, money } from "@/lib/erp/utils";

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
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">Reorder needed</h2>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
          {total.toLocaleString()} at / below reorder point{store ? ` · ${store}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Link href="/erp/purchasing" className={chip(!store)}>All</Link>
          {stores.map((s) => (
            <Link key={s.id} href={`/erp/purchasing?store=${s.id}`} className={chip(store === s.id)} title={s.name}>{s.id}</Link>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">Nothing at or below reorder point{store ? ` for ${store}` : ""}. ✓</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">Vendor</th>
                <th className="px-4 py-2 font-medium">Store</th>
                <th className="px-4 py-2 text-right font-medium">QOH</th>
                <th className="px-4 py-2 text-right font-medium">Reorder pt</th>
                <th className="px-4 py-2 text-right font-medium">Suggested</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
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
        Reorder point = demand × lead time + safety stock (from the loaded planning data). Suggested = bring on-hand up to
        max level (or the reorder point). Showing up to 100, most urgent first. QOH is the real ledger on-hand.
      </p>
    </section>
  );
}
