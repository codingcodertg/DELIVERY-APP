"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import { Badge } from "@/components/erp/ui/badge";
import { Button } from "@/components/erp/ui/button";
import { Input } from "@/components/erp/ui/input";
import { cn, money } from "@/lib/erp/utils";
import { commercialStatusClass, label } from "@/lib/erp/status";
import { resolveTag } from "@/lib/erp/actions";
import { exportCsv, exportXlsx } from "@/lib/erp/export";
import { SavedViews, type SavedView } from "@/components/erp/saved-views";
import { ProductDrawer } from "@/components/erp/product-drawer";
import { BulkBar } from "@/components/erp/bulk-bar";
import { UomAssistant } from "@/components/erp/uom-assistant";
import { suggestUomFix } from "@/lib/erp/domain/uom";

export type ReviewRow = {
  id: number;
  sku: string;
  name: string;
  status: string;
  category_path: string | null;
  vendor_name: string | null;
  price: number | null;
  cost: number | null;
  margin_pct: number | null;
  review_tags: string[];
  sf_per_box: number | null;
  base_unit: string | null;
};

export type TagFacet = { tag: string; n: number };

const TAG_PILL = "border-amber-200 bg-amber-50 text-amber-700";
const BUILTINS = [
  { name: "Below cost", state: { issue: "BELOW COST", q: "" } },
  { name: "Unit mismatch", state: { issue: "UNIT MISMATCH?", q: "" } },
  { name: "SF/box corrupt", state: { issue: "SF/BOX CORRUPT", q: "" } },
  { name: "Possible dup", state: { issue: "POSSIBLE DUP", q: "" } },
  { name: "PO import", state: { issue: "PO IMPORT", q: "" } },
];

function BurnPill({ active, onClick, label: text, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors", active ? "border-clay-200 bg-clay-50 font-medium text-clay-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
      {active && <span className="h-1.5 w-1.5 rounded-full bg-clay-500" />}
      {text}
      <span className="text-xs text-slate-400">{count.toLocaleString()}</span>
    </button>
  );
}

export function ReviewQueue({
  rows,
  matching,
  flaggedTotal,
  facets,
  issue,
  q,
  page,
  pageSize,
  canSeeCost,
  savedViews = [],
}: {
  rows: ReviewRow[];
  /** exact server count for the CURRENT filter (PRF-01) */
  matching: number;
  /** exact server count of everything flagged, filter-independent */
  flaggedTotal: number;
  /** per-tag counts over the WHOLE flagged set, not just this page (PRF-01) */
  facets: TagFacet[];
  issue: string;
  q: string;
  page: number;
  pageSize: number;
  canSeeCost: boolean;
  savedViews?: SavedView[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uomMode, setUomMode] = useState(false);
  const [qDraft, setQDraft] = useState(q);

  // Filtering, search and paging are SERVER-side now (PRF-01): the client can only see one page, so
  // filtering here would filter a window rather than the queue. State lives in the URL.
  const setParams = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "" || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    startTransition(() => router.push(`/review?${sp.toString()}`, { scroll: false }));
  };
  const setIssue = (t: string) => setParams({ issue: t, page: null });

  useEffect(() => setQDraft(q), [q]);
  useEffect(() => {
    if (qDraft === q) return;
    const t = setTimeout(() => setParams({ q: qDraft, page: null }), 400);
    return () => clearTimeout(t);
  }, [qDraft]);

  // Page-scoped: this is a client-side heuristic over cost, so it can only speak for loaded rows.
  const uomCount = useMemo(
    () => (canSeeCost ? rows.reduce((n, r) => (suggestUomFix(r).flag.severity === "high" ? n + 1 : n), 0) : 0),
    [rows, canSeeCost]
  );

  const issues = useMemo(() => facets.map((f) => [f.tag, f.n] as const), [facets]);
  const filtered = rows; // the server already applied issue + q
  const pageCount = Math.max(1, Math.ceil(matching / pageSize));

  // PRF-06: virtualize the rendered rows. Spacer <tr>s rather than a div-grid rewrite, so the existing
  // table markup and styling are untouched; measureElement handles the variable row height that
  // wrapping issue-tags produce.
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });
  const vItems = virtualizer.getVirtualItems();
  const padTop = vItems.length ? vItems[0].start : 0;
  const padBottom = vItems.length ? virtualizer.getTotalSize() - vItems[vItems.length - 1].end : 0;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  }
  function applyState(s: Record<string, unknown>) {
    setParams({
      issue: typeof s.issue === "string" ? s.issue : null,
      q: typeof s.q === "string" ? s.q : null,
      page: null,
    });
  }
  function doResolve(id: number, tag: string) {
    setErr(null);
    startTransition(async () => {
      const res = await resolveTag(id, tag);
      if (!res.ok) setErr(res.error ?? "Action failed");
      else router.refresh();
    });
  }
  function exportSelection(fmt: "csv" | "xlsx") {
    const sel = filtered.filter((r) => selected.has(r.id));
    const headers = ["SKU", "Name", "Status", "Category", "Vendor", "Price", ...(canSeeCost ? ["Cost", "Margin %"] : []), "Issues"];
    const data = sel.map((r) => [r.sku, r.name, r.status, r.category_path ?? "", r.vendor_name ?? "", r.price ?? "", ...(canSeeCost ? [r.cost ?? "", r.margin_pct ?? ""] : []), r.review_tags.join("; ")]);
    if (fmt === "csv") exportCsv("rtg-review-selection.csv", headers, data);
    else exportXlsx("rtg-review-selection.xlsx", "Review", headers, data);
  }

  const cols = canSeeCost ? 8 : 6;

  return (
    <div>
      <SavedViews scope="review" saved={savedViews} builtins={BUILTINS} currentState={{ issue, q }} onApply={applyState} />

      <div className="mb-4 flex flex-wrap gap-2">
        <BurnPill active={issue === "all"} onClick={() => setIssue("all")} label="All" count={flaggedTotal} />
        {issues.map(([t, n]) => (
          <BurnPill key={t} active={issue === t} onClick={() => setIssue(t)} label={t} count={n} />
        ))}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <Input placeholder="Search name, SKU, vendor…" value={qDraft} onChange={(e) => setQDraft(e.target.value)} className="max-w-xs" />
        {canSeeCost && (
          <Button
            variant={uomMode ? "default" : "outline"}
            size="sm"
            onClick={() => setUomMode((v) => !v)}
            title="Likely unit-of-measure errors (cost ≥ 1.5× price)"
          >
            ⚠ UoM check{uomCount ? ` (${uomCount} on page)` : ""}
          </Button>
        )}
        {pending && <span className="text-sm text-slate-400">saving…</span>}
        <span className="ml-auto text-sm text-slate-500">
          {matching.toLocaleString()} flagged{issue !== "all" || q ? " matching" : ""}
          {matching > pageSize && (
            <> · showing {((page - 1) * pageSize + 1).toLocaleString()}–
              {Math.min(page * pageSize, matching).toLocaleString()}</>
          )}
        </span>
      </div>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}

      {uomMode ? (
        <UomAssistant rows={rows} onEdit={(id) => setDrawerId(id)} />
      ) : (
      <div ref={parentRef} className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-clay-500" aria-label="Select all" />
              </th>
              <th className="px-3 py-2.5 font-medium">Product</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Issues</th>
              <th className="px-3 py-2.5 text-right font-medium">Price</th>
              {canSeeCost && <th className="px-3 py-2.5 text-right font-medium">Cost</th>}
              {canSeeCost && <th className="px-3 py-2.5 text-right font-medium">Margin</th>}
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && <tr aria-hidden style={{ height: padTop }} />}
            {vItems.map((vi) => {
              const r = filtered[vi.index];
              return (
              <tr key={r.id} data-index={vi.index} ref={virtualizer.measureElement} className={cn("border-t border-slate-100 align-top", selected.has(r.id) ? "bg-clay-50/50" : "hover:bg-slate-50/60")}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="accent-clay-500" />
                </td>
                <td className="px-3 py-2">
                  <Link href={`/product/${r.id}`} className="font-medium text-slate-900 hover:text-clay-700">{r.name}</Link>
                  <div className="font-mono text-xs text-slate-400">{r.sku}</div>
                </td>
                <td className="px-3 py-2">
                  <Badge className={commercialStatusClass(r.status)}>{label(r.status)}</Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {r.review_tags.map((t) => (
                      <button key={t} type="button" disabled={pending} onClick={() => doResolve(r.id, t)} title="Resolve (clear this tag)" className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium hover:line-through disabled:opacity-50", TAG_PILL)}>
                        {t} <span className="text-amber-500">×</span>
                      </button>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.price)}</td>
                {canSeeCost && <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(r.cost)}</td>}
                {canSeeCost && <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.margin_pct == null ? "—" : `${r.margin_pct}%`}</td>}
                <td className="px-3 py-2 text-right">
                  <Button variant="outline" size="sm" onClick={() => setDrawerId(r.id)}>Edit</Button>
                </td>
              </tr>
              );
            })}
            {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }} />}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={cols} className="p-8 text-center text-slate-500">Nothing flagged here. 🎉</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {pageCount > 1 && !uomMode && (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-slate-500">
            Page {page.toLocaleString()} of {pageCount.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || pending}
              onClick={() => setParams({ page: page - 1 <= 1 ? null : String(page - 1) })}
            >
              ← Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount || pending}
              onClick={() => setParams({ page: String(page + 1) })}
            >
              Next →
            </Button>
          </div>
        </div>
      )}

      {drawerId !== null && <ProductDrawer productId={drawerId} canEdit={canSeeCost} canSeeCost={canSeeCost} onClose={() => setDrawerId(null)} />}
      {selected.size > 0 && <BulkBar ids={[...selected]} canEdit={canSeeCost} onClear={() => setSelected(new Set())} onExport={exportSelection} />}
    </div>
  );
}
