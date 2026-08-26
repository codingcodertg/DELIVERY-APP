"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/erp/ui/input";
import { Badge } from "@/components/erp/ui/badge";
import { Button } from "@/components/erp/ui/button";
import { exportCsv, exportXlsx } from "@/lib/erp/export";
import { cn, money } from "@/lib/erp/utils";
import { productImageUrl } from "@/lib/erp/images";
import { commercialStatusClass, label } from "@/lib/erp/status";
import { priceUnitSuffix } from "@/lib/erp/domain/units";
import { SavedViews, type SavedView } from "@/components/erp/saved-views";
import { ProductDrawer } from "@/components/erp/product-drawer";
import { BulkBar } from "@/components/erp/bulk-bar";
import { CatalogCards } from "@/components/erp/catalog-cards";
import { queryCatalog, exportCatalogRows } from "@/lib/erp/actions";
import type { CatalogFacets, CatalogQuery, CatalogRow } from "@/lib/erp/catalog";

export type { CatalogRow };

/** Small product thumbnail with a graceful placeholder when there's no image. */
function Thumb({ path, alt }: { path?: string | null; alt: string }) {
  const url = productImageUrl(path);
  if (!url) return <div className="h-8 w-8 rounded bg-slate-100 ring-1 ring-slate-200" aria-hidden />;
  return <img src={url} alt={alt} loading="lazy" className="h-8 w-8 rounded object-cover ring-1 ring-slate-200" />;
}

const COMMERCIAL = ["all", "active", "special_order", "discontinued", "inactive"];
const RECORD_TABS = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Draft" },
  { value: "pending_approval", label: "Pending" },
  { value: "archived", label: "Archived" },
] as const;
const BUILTINS = [
  { name: "Active", state: { statusFilter: "active", recordTab: "all", reviewOnly: false, globalFilter: "" } },
  { name: "Needs review", state: { reviewOnly: true, statusFilter: "all", recordTab: "all", globalFilter: "" } },
  { name: "Special order", state: { statusFilter: "special_order", recordTab: "all", reviewOnly: false, globalFilter: "" } },
  { name: "Drafts", state: { recordTab: "draft", statusFilter: "all", reviewOnly: false, globalFilter: "" } },
];

function Kpi({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

export function CatalogTable({
  initialRows,
  initialTotal,
  facets,
  pageSize,
  canSeeCost,
  initialReviewOnly = false,
  savedViews = [],
  initialError = null,
  lockedCategory,
  compact = false,
  initialView = "table",
}: {
  initialRows: CatalogRow[];
  initialTotal: number;
  facets?: CatalogFacets;
  pageSize: number;
  canSeeCost: boolean;
  initialReviewOnly?: boolean;
  savedViews?: SavedView[];
  initialError?: string | null;
  lockedCategory?: string;
  compact?: boolean;
  initialView?: "table" | "cards";
}) {
  const [rows, setRows] = useState<CatalogRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [globalFilter, setGlobalFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [recordTab, setRecordTab] = useState("all");
  const [reviewOnly, setReviewOnly] = useState(initialReviewOnly);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState<string | null>(initialError);
  // Table ⇄ Cards view. Persisted in a cookie (read back server-side as initialView);
  // toggling does NOT refetch — both views render the same already-loaded rows.
  const [view, setView] = useState<"table" | "cards">(compact ? "table" : initialView);
  function changeView(v: "table" | "cards") {
    setView(v);
    document.cookie = `catalog_view=${v}; path=/; max-age=31536000; samesite=lax`;
  }

  const parentRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const filters = useMemo<CatalogQuery>(
    () => ({
      q: debouncedFilter,
      status: statusFilter,
      recordTab,
      reviewOnly,
      sortId: sorting[0]?.id ?? "name",
      sortDesc: sorting[0]?.desc ?? false,
      categoryPath: lockedCategory,
    }),
    [debouncedFilter, statusFilter, recordTab, reviewOnly, sorting, lockedCategory]
  );
  const filterKey = JSON.stringify(filters);
  const hasMore = rows.length < total;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function applyState(s: Record<string, unknown>) {
    const gf = typeof s.globalFilter === "string" ? s.globalFilter : "";
    setGlobalFilter(gf);
    setDebouncedFilter(gf); // saved views apply immediately (no debounce lag)
    setStatusFilter(typeof s.statusFilter === "string" ? s.statusFilter : "all");
    setRecordTab(typeof s.recordTab === "string" ? s.recordTab : "all");
    setReviewOnly(Boolean(s.reviewOnly));
    setSorting(Array.isArray(s.sorting) ? (s.sorting as SortingState) : [{ id: "name", desc: false }]);
  }

  // Debounce the search box (300ms) into the query filter.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilter(globalFilter), 300);
    return () => clearTimeout(t);
  }, [globalFilter]);

  // Re-query from page 1 whenever the filter/sort changes. Skip the first render — the server already
  // sent page 1 for the initial filter (reviewOnly from the URL).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    queryCatalog({ ...filters, offset: 0, limit: pageSize }).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) {
        setErr(res.error);
        setRows([]);
        setTotal(0);
        return;
      }
      setErr(null);
      setRows(res.rows);
      setTotal(res.total);
      parentRef.current?.scrollTo({ top: 0 });
    });
    return () => {
      cancelled = true;
    };
  }, [filterKey, pageSize]);

  async function loadMore() {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    const res = await queryCatalog({ ...filters, offset: rows.length, limit: pageSize });
    setLoadingMore(false);
    if (res.error) {
      setErr(res.error);
      return;
    }
    setRows((prev) => [...prev, ...res.rows]);
    setTotal(res.total);
  }

  const columns = useMemo<ColumnDef<CatalogRow>[]>(() => {
    const cols: ColumnDef<CatalogRow>[] = [
      { id: "thumb", header: "", size: 48, enableSorting: false, cell: (c) => <Thumb path={c.row.original.image_path} alt={c.row.original.sku} /> },
      { accessorKey: "sku", header: "SKU", size: 140, cell: (c) => <span className="font-mono text-xs text-slate-600">{c.getValue<string>()}</span> },
      { accessorKey: "name", header: "Name", size: 300, cell: (c) => <span className="font-medium text-slate-900">{c.getValue<string>()}</span> },
      { accessorKey: "status", header: "Status", size: 130, cell: (c) => <Badge className={commercialStatusClass(c.getValue<string>())}>{label(c.getValue<string>())}</Badge> },
      { accessorKey: "product_type", header: "Type", size: 100, cell: (c) => <span className="text-slate-500">{c.getValue<string>() ?? "—"}</span> },
      { accessorKey: "category_path", header: "Category", size: 190, cell: (c) => <span className="text-slate-500">{c.getValue<string>() ?? "—"}</span> },
      { accessorKey: "vendor_name", header: "Vendor", size: 180, cell: (c) => <span className="text-slate-500">{c.getValue<string>() ?? "—"}</span> },
      { accessorKey: "price", header: "Price", size: 116, cell: (c) => (
        <span className="tabular-nums">{money(c.getValue<number | null>())}<span className="text-xs text-slate-400">{priceUnitSuffix(c.row.original.sell_unit)}</span></span>
      ) },
    ];
    if (canSeeCost) {
      cols.push({ accessorKey: "cost", header: "Cost/box", size: 92, cell: (c) => <span className="tabular-nums text-slate-500">{money(c.getValue<number | null>())}</span> });
      cols.push({ accessorKey: "margin_pct", header: "Margin", size: 80, cell: (c) => { const v = c.getValue<number | null>(); return <span className="tabular-nums text-slate-500">{v == null ? "—" : `${v}%`}</span>; } });
    }
    cols.push({ accessorKey: "qoh", header: "QOH", size: 84, cell: (c) => { const v = c.getValue<number | null>(); return <span className="tabular-nums text-slate-600">{v == null ? "—" : Number(v).toLocaleString()}</span>; } });
    cols.push({ id: "review", header: "", size: 36, enableSorting: false, cell: (c) => (c.row.original.needs_review ? <span title="Needs review" className="inline-block h-2 w-2 rounded-full bg-amber-400" /> : null) });
    return cols;
  }, [canSeeCost]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => String(r.id),
    manualSorting: true,
    manualFiltering: true,
  });

  const tableRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({ count: tableRows.length, getScrollElement: () => parentRef.current, estimateSize: () => 44, overscan: 12 });
  const totalWidth = table.getTotalSize() + 40;
  const allSelected = tableRows.length > 0 && tableRows.every((r) => selected.has(r.original.id));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(tableRows.map((r) => r.original.id)));
  }

  function buildExport(list: CatalogRow[]) {
    const headers = ["SKU", "Name", "Status", "Record", "Type", "Category", "Vendor", "Price", "Sell unit", ...(canSeeCost ? ["Cost/box", "Margin %"] : []), "QOH", "Needs review", "SEO title", "SEO description"];
    const out = list.map((o) => [o.sku, o.name, o.status, o.record_status, o.product_type ?? "", o.category_path ?? "", o.vendor_name ?? "", o.price ?? "", o.sell_unit ?? "", ...(canSeeCost ? [o.cost ?? "", o.margin_pct ?? ""] : []), o.qoh ?? "", o.needs_review ? "yes" : "no", o.seo_title ?? "", o.seo_description ?? ""]);
    return { headers, data: out };
  }
  // Export the FULL filtered set (server-side, not just the loaded page).
  async function exportView(fmt: "csv" | "xlsx") {
    setExporting(true);
    const res = await exportCatalogRows(filters);
    setExporting(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    const e = buildExport(res.rows);
    if (fmt === "csv") exportCsv("rtg-catalog.csv", e.headers, e.data);
    else exportXlsx("rtg-catalog.xlsx", "Catalog", e.headers, e.data);
  }
  function exportSelection(fmt: "csv" | "xlsx") {
    const e = buildExport(rows.filter((r) => selected.has(r.id)));
    if (fmt === "csv") exportCsv("rtg-selection.csv", e.headers, e.data);
    else exportXlsx("rtg-selection.xlsx", "Selection", e.headers, e.data);
  }

  // Shared by both views — same lazy-load (100/page) on scroll-near-bottom.
  const loadMoreFooter =
    loadingMore || hasMore ? (
      <div className="flex items-center justify-center gap-3 border-t border-slate-100 py-3 text-sm text-slate-500">
        {loadingMore ? (
          "Loading more…"
        ) : (
          <button type="button" onClick={loadMore} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
            Load more ({(total - rows.length).toLocaleString()} left)
          </button>
        )}
      </div>
    ) : null;

  return (
    <div>
      {!compact && (
        <SavedViews scope="catalog" saved={savedViews} builtins={BUILTINS} currentState={{ globalFilter, statusFilter, recordTab, reviewOnly, sorting }} onApply={applyState} />
      )}

      {!compact && facets && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Products" value={facets.total} dot="bg-slate-300" />
          <Kpi label="Active" value={facets.active} dot="bg-emerald-400" />
          <Kpi label="Needs review" value={facets.needs_review} dot="bg-amber-400" />
          <Kpi label="Special order" value={facets.special_order} dot="bg-sky-400" />
        </div>
      )}

      {!compact && facets && (
        <div className="mb-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {RECORD_TABS.map((t) => {
            const active = recordTab === t.value;
            const count = facets.by_record[t.value as keyof CatalogFacets["by_record"]] ?? 0;
            return (
              <button key={t.value} type="button" onClick={() => setRecordTab(t.value)} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors", active ? "bg-clay-50 font-medium text-clay-700" : "text-slate-500 hover:text-slate-800")}>
                {active && <span className="h-1.5 w-1.5 rounded-full bg-clay-500" />}
                {t.label}
                <span className="text-xs text-slate-400">{count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input placeholder="Search name, SKU, vendor…" value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} className="max-w-xs" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500">
          {COMMERCIAL.map((s) => (
            <option key={s} value={s}>{s === "all" ? "All statuses" : label(s)}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} className="accent-clay-500" />
          Needs review
        </label>
        <div className="ml-auto flex items-center gap-2">
          {!compact && (
            <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5" role="group" aria-label="View mode">
              {(["table", "cards"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => changeView(v)}
                  aria-pressed={view === v}
                  className={cn(
                    "rounded px-2.5 py-1 text-sm capitalize transition-colors",
                    view === v ? "bg-clay-50 font-medium text-clay-700" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => exportView("csv")} disabled={exporting}>{exporting ? "Exporting…" : "CSV"}</Button>
          <Button variant="outline" size="sm" onClick={() => exportView("xlsx")} disabled={exporting}>XLSX</Button>
          <span className="text-sm text-slate-500">
            {loading ? "Searching…" : `${rows.length.toLocaleString()} of ${total.toLocaleString()}`}
          </span>
        </div>
      </div>

      {err && <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">Failed to load catalog: {err}</p>}

      <div
        ref={parentRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) loadMore();
        }}
        className="h-[calc(100vh-340px)] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm"
      >
        {view === "cards" ? (
          <>
            <CatalogCards rows={rows} />
            {loadMoreFooter}
          </>
        ) : (
          <div style={{ minWidth: totalWidth }}>
            <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <div className="flex w-10 shrink-0 items-center justify-center py-2.5">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-clay-500" aria-label="Select all loaded" />
              </div>
              {table.getHeaderGroups()[0].headers.map((h) => {
                const sorted = h.column.getIsSorted();
                return (
                  <div key={h.id} style={{ width: h.getSize() }} className="px-3 py-2.5 font-medium">
                    {h.isPlaceholder ? null : (
                      <button type="button" className={cn("inline-flex items-center gap-1", h.column.getCanSort() && "cursor-pointer select-none hover:text-slate-800", sorted && "text-clay-700")} onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const row = tableRows[vi.index];
                const isSel = selected.has(row.original.id);
                return (
                  <div
                    key={row.id}
                    onClick={() => setDrawerId(row.original.id)}
                    className={cn("absolute flex w-full cursor-pointer border-b border-slate-100", isSel ? "bg-clay-50/60" : "hover:bg-clay-50/40")}
                    style={{ transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }}
                  >
                    <div className="flex w-10 shrink-0 items-center justify-center" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggle(row.original.id)} className="accent-clay-500" />
                    </div>
                    {row.getVisibleCells().map((cell) => (
                      <div key={cell.id} style={{ width: cell.column.getSize() }} className="flex items-center overflow-hidden whitespace-nowrap px-3">
                        <span className="truncate">{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {tableRows.length === 0 && !loading && <div className="p-8 text-center text-sm text-slate-500">No products match these filters.</div>}
            </div>

            {loadMoreFooter}
          </div>
        )}
      </div>

      {drawerId !== null && <ProductDrawer productId={drawerId} canEdit={canSeeCost} canSeeCost={canSeeCost} onClose={() => setDrawerId(null)} />}
      {selected.size > 0 && (
        <BulkBar ids={[...selected]} canEdit={canSeeCost} onClear={() => setSelected(new Set())} onExport={exportSelection} />
      )}
    </div>
  );
}
