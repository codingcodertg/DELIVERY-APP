"use client";

import { useState } from "react";
import { money } from "@/lib/erp/utils";

export interface StoreQoh {
  store_id: string;
  store_name: string;
  qoh: number | null;
  sq_ft: number | null;
  qb_code: string | null;
  qb_description: string | null;
  assortment_active: boolean;
  store_price: number | null;
  qoh_verified: boolean;
  store_cost: number | null;
  store_margin_pct: number | null;
}

const num = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));

// Collapsed: unified code + description + total QOH (boxes AND sq ft).
// Expanded: per-store rows (qb_code / qb_description / qoh / sq ft / price [+ cost/margin for mgr]).
export function QohPanel({
  unifiedCode,
  description,
  totalBoxes,
  totalSqFt,
  stores,
  showCost,
}: {
  unifiedCode: string;
  description: string;
  totalBoxes: number | null;
  totalSqFt: number | null;
  stores: StoreQoh[];
  showCost: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cols = showCost ? 7 : 5;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-slate-50"
      >
        <span className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        <span className="font-mono text-sm font-medium text-slate-700">{unifiedCode}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-500">{description}</span>
        <span className="text-right">
          <span className="block text-sm font-semibold tabular-nums text-slate-900">{num(totalBoxes)} <span className="text-xs font-normal text-slate-400">boxes</span></span>
          <span className="block text-xs tabular-nums text-slate-500">{num(totalSqFt)} <span className="text-slate-400">sq ft</span></span>
        </span>
      </button>

      {open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1.5 pr-4 font-medium">Store</th>
                <th className="py-1.5 pr-4 font-medium">QB code / description</th>
                <th className="py-1.5 pr-4 text-right font-medium">QOH</th>
                <th className="py-1.5 pr-4 text-right font-medium">Sq ft</th>
                <th className="py-1.5 pr-4 text-right font-medium">Price</th>
                {showCost && <th className="py-1.5 pr-4 text-right font-medium">Cost</th>}
                {showCost && <th className="py-1.5 pr-4 text-right font-medium">Margin</th>}
              </tr>
            </thead>
            <tbody>
              {stores.length === 0 && (
                <tr><td colSpan={cols} className="py-3 text-slate-500">No store assortment rows.</td></tr>
              )}
              {stores.map((s) => (
                <tr key={s.store_id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-4 font-medium">
                    {s.store_name}
                    {!s.assortment_active && <span className="ml-1.5 text-[10px] uppercase text-slate-400">off</span>}
                  </td>
                  <td className="py-1.5 pr-4">
                    <span className="font-mono text-xs text-slate-500">{s.qb_code ?? "—"}</span>
                    {s.qb_description && <span className="block text-xs text-slate-400">{s.qb_description}</span>}
                  </td>
                  <td className="py-1.5 pr-4 text-right">
                    <span className={Number(s.qoh) < 0 ? "tabular-nums font-medium text-red-600" : "tabular-nums"}>{num(s.qoh)}</span>
                    {!s.qoh_verified && s.qoh != null && Number(s.qoh) !== 0 && (
                      <span title="Opening balance seeded from the QB import — unverified until a physical count confirms it" className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">opening</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">{num(s.sq_ft)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{money(s.store_price)}</td>
                  {showCost && <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">{money(s.store_cost)}</td>}
                  {showCost && <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">{s.store_margin_pct == null ? "—" : `${s.store_margin_pct}%`}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
