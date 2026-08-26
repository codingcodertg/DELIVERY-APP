"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn, money } from "@/lib/erp/utils";
import { productImageUrl } from "@/lib/erp/images";

export type PMember = {
  id: number;
  sku: string;
  name: string;
  vendor: string | null;
  cost: number | null;
  last_price: number | null;
  last_price_date: string | null;
  lead_time_days: number | null;
  moq: number | null;
  qoh: number | null;
  reorder_point: number | null;
  min_level: number | null;
  max_level: number | null;
  size_in: string | null;
  shape: string | null;
  color: string | null;
  finish: string | null;
  material: string | null;
  image: string | null;
};
export type PGroup = { group_key: string; member_count: number; label: string; members: PMember[] };

const num = (v: number | null) => (v == null ? "—" : v.toLocaleString());
const dateStr = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");
function reorderText(m: PMember): string {
  const parts: string[] = [];
  if (m.reorder_point != null) parts.push(`RP ${num(m.reorder_point)}`);
  if (m.min_level != null) parts.push(`min ${num(m.min_level)}`);
  if (m.max_level != null) parts.push(`max ${num(m.max_level)}`);
  return parts.length ? parts.join(" · ") : "—";
}
const belowReorder = (m: PMember) =>
  m.qoh != null && m.reorder_point != null && Number(m.reorder_point) > 0 && Number(m.qoh) <= Number(m.reorder_point);

function Thumb({ path, alt }: { path: string | null; alt: string }) {
  const url = productImageUrl(path);
  return url ? (
    <img src={url} alt={alt} loading="lazy" className="h-10 w-10 shrink-0 rounded object-cover ring-1 ring-slate-200" />
  ) : (
    <div className="h-10 w-10 shrink-0 rounded bg-slate-100 ring-1 ring-slate-200" aria-hidden />
  );
}

export function PurchasingGroups({
  groups,
  page,
  pages,
  canSeeCost,
}: {
  groups: PGroup[];
  page: number;
  pages: number;
  canSeeCost: boolean;
}) {
  const [sort, setSort] = useState<"cost" | "lead">("cost");
  const sorted = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        members: [...g.members].sort((a, b) => {
          const av = sort === "cost" ? a.cost : a.lead_time_days;
          const bv = sort === "cost" ? b.cost : b.lead_time_days;
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          return av - bv;
        }),
      })),
    [groups, sort]
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Sort suppliers by</span>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {(["cost", "lead"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={cn(
                "rounded-md px-3 py-1 transition-colors",
                sort === s ? "bg-clay-50 font-medium text-clay-700" : "text-slate-500 hover:text-slate-800"
              )}
            >
              {s === "cost" ? "Cost" : "Lead time"}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No comparison groups on this page.
        </p>
      ) : (
        <div className="space-y-4">
          {sorted.map((g) => (
            <section key={g.group_key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-slate-800">{g.label || "Group"}</h2>
                <span className="rounded-full border border-clay-200 bg-clay-50 px-2 py-0.5 text-xs font-medium text-clay-700">
                  {g.member_count} sources
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 font-medium">Vendor</th>
                      {canSeeCost && <th className="px-3 py-2 text-right font-medium">Cost</th>}
                      <th className="px-3 py-2 text-right font-medium">Last price</th>
                      <th className="px-3 py-2 text-right font-medium">Lead time</th>
                      <th className="px-3 py-2 text-right font-medium">MOQ</th>
                      <th className="px-3 py-2 text-right font-medium">QOH*</th>
                      <th className="px-3 py-2 font-medium">Reorder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.members.map((m, i) => {
                      const cheapest = canSeeCost && sort === "cost" && i === 0 && m.cost != null;
                      return (
                        <tr key={m.id} className={cn("border-t border-slate-100", cheapest && "bg-emerald-50/50")}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Thumb path={m.image} alt={m.sku} />
                              <div className="min-w-0">
                                <Link href={`/erp/product/${m.id}`} className="block truncate font-medium text-slate-900 hover:text-clay-700">
                                  {m.name}
                                </Link>
                                <div className="font-mono text-xs text-slate-400">
                                  {m.sku}
                                  {cheapest && <span className="ml-2 rounded bg-emerald-100 px-1 font-sans text-emerald-700">cheapest</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-600">{m.vendor ?? "—"}</td>
                          {canSeeCost && <td className="px-3 py-2 text-right font-medium tabular-nums">{money(m.cost)}</td>}
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                            {money(m.last_price)}
                            <div className="text-xs text-slate-400">{dateStr(m.last_price_date)}</div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.lead_time_days == null ? "—" : `${m.lead_time_days}d`}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{num(m.moq)}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={cn("tabular-nums", belowReorder(m) ? "font-medium text-amber-700" : "text-slate-400")}>{num(m.qoh)}</span>
                            {belowReorder(m) && (
                              <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200" title={`At/below reorder point (${num(m.reorder_point)})`}>reorder</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-500">{reorderText(m)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={`/erp/purchasing?page=${page - 1}`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
              ← Prev
            </Link>
          ) : (
            <span className="rounded-md border border-slate-100 px-3 py-1.5 text-slate-300">← Prev</span>
          )}
          <span className="text-slate-500">Page {page} of {pages}</span>
          {page < pages ? (
            <Link href={`/erp/purchasing?page=${page + 1}`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
              Next →
            </Link>
          ) : (
            <span className="rounded-md border border-slate-100 px-3 py-1.5 text-slate-300">Next →</span>
          )}
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-400">
        * QOH is the ledger opening balance (M3) — seeded from the QB snapshot and unverified until a
        physical count confirms it; below-reorder-point alerts are a later pass. Grouping is attribute-based
        (size · shape · color/finish/material, plus bros family links); image-based similarity is a future
        enhancement. This is a comparison view only — it never merges or dup-flags (that&apos;s the separate review tool).
      </p>
    </div>
  );
}
