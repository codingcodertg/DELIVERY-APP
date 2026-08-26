"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/erp/ui/button";
import { money } from "@/lib/erp/utils";
import { inlineFix } from "@/lib/erp/actions";
import { suggestUomFix, isCostOutlier, medianOf, type UomSuggestion } from "@/lib/erp/domain/uom";
import type { ReviewRow } from "@/components/erp/review-queue";

// Group line-mates by vendor + the first token of the name (a collection like "ACUARELA").
function lineKey(name: string, vendor: string | null): string {
  const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return `${vendor ?? ""}|${first}`;
}

type Candidate = { r: ReviewRow; s: UomSuggestion; mates: number[]; outlier: boolean };

export function UomAssistant({ rows, onEdit }: { rows: ReviewRow[]; onEdit: (id: number) => void }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const groupCosts = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of rows) {
      if (r.cost == null || r.cost <= 0) continue;
      const k = lineKey(r.name, r.vendor_name);
      const arr = m.get(k);
      if (arr) arr.push(r.cost);
      else m.set(k, [r.cost]);
    }
    return m;
  }, [rows]);

  const candidates = useMemo(() => {
    const out: Candidate[] = [];
    for (const r of rows) {
      const s = suggestUomFix(r);
      if (s.flag.severity !== "high") continue;
      const mates = (groupCosts.get(lineKey(r.name, r.vendor_name)) ?? []).filter((c) => c !== r.cost);
      const outlier = r.cost != null ? isCostOutlier(r.cost, mates) : false;
      out.push({ r, s, mates, outlier });
    }
    out.sort((a, b) => (b.s.flag.ratio ?? 0) - (a.s.flag.ratio ?? 0));
    return out;
  }, [rows, groupCosts]);

  const visible = candidates.filter((c) => !done.has(c.r.id));

  function apply(c: Candidate) {
    if (c.s.proposedCost == null) return;
    setErr(null);
    setPendingId(c.r.id);
    startTransition(async () => {
      const patch: Record<string, string> = { cost: String(c.s.proposedCost) };
      if (c.s.proposedBaseUnit) patch.base_unit = c.s.proposedBaseUnit;
      const res = await inlineFix(c.r.id, patch);
      setPendingId(null);
      if (!res.ok) setErr(res.error);
      else {
        setDone((d) => new Set(d).add(c.r.id));
        router.refresh();
      }
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
        <strong>Unit-of-measure check.</strong> A cost ≥ 1.5× the price across a line is the signature of a per-box
        cost stapled to a per-unit price. These are <em>suggestions</em> — review and apply; nothing changes on its
        own, and every applied fix goes through the audited update path (price_history captured).
      </div>
      {err && <p className="px-4 py-2 text-sm text-red-600">{err}</p>}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2.5 font-medium">Product</th>
            <th className="px-3 py-2.5 text-right font-medium">Price</th>
            <th className="px-3 py-2.5 text-right font-medium">Cost</th>
            <th className="px-3 py-2.5 text-right font-medium">Cost÷Price</th>
            <th className="px-3 py-2.5 font-medium">Suggested fix</th>
            <th className="px-3 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {visible.map(({ r, s, mates, outlier }) => (
            <tr key={r.id} className="border-t border-slate-100 align-top hover:bg-slate-50/60">
              <td className="px-3 py-2">
                <Link href={`/erp/product/${r.id}`} className="font-medium text-slate-900 hover:text-clay-700">{r.name}</Link>
                <div className="font-mono text-xs text-slate-400">{r.sku}</div>
                {outlier && (
                  <div className="mt-0.5 text-xs text-amber-700">
                    Outlier vs {mates.length} line-mate{mates.length === 1 ? "" : "s"} (median {money(medianOf(mates))})
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.price)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(r.cost)}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums text-amber-700">
                {s.flag.ratio == null ? "—" : `${s.flag.ratio.toFixed(1)}×`}
              </td>
              <td className="max-w-sm px-3 py-2 text-slate-600">
                {s.proposedCost != null ? (
                  <>
                    Set cost → <span className="font-medium">{money(s.proposedCost)}</span>
                    {s.proposedBaseUnit ? (
                      <>
                        , unit → <span className="font-medium">{s.proposedBaseUnit}</span>
                      </>
                    ) : null}
                    <div className="text-xs text-slate-400">{s.rationale}</div>
                  </>
                ) : (
                  <span className="text-slate-500">{s.rationale}</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                {s.proposedCost != null ? (
                  <Button size="sm" disabled={isPending && pendingId === r.id} onClick={() => apply({ r, s, mates, outlier })}>
                    {isPending && pendingId === r.id ? "Applying…" : "Apply fix"}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => onEdit(r.id)}>Review</Button>
                )}
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={6} className="p-8 text-center text-slate-500">No likely unit-of-measure errors. 🎉</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
