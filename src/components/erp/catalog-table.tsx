"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type ColumnOrderState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/erp/ui/input";
import { Badge } from "@/components/erp/ui/badge";
import { Button } from "@/components/erp/ui/button";
import { exportCsv, exportXlsx } from "@/lib/erp/export";
import { cn, money } from "@/lib/erp/utils";
import { productImageUrl } from "@/lib/erp/images";
import { commercialStatusClass, statusLabel } from "@/lib/erp/status";
import { priceUnitSuffix } from "@/lib/erp/domain/units";
import { SavedViews, type SavedView } from "@/components/erp/saved-views";
import { ProductDrawer } from "@/components/erp/product-drawer";
import { BulkBar } from "@/components/erp/bulk-bar";
import { CatalogCards } from "@/components/erp/catalog-cards";
import { RequestDrawer } from "@/components/erp/request-drawer";
import { ColumnHeaderMenu } from "@/components/erp/catalog-column-menu";
import { SelectorDeColumnas } from "@/components/SelectorDeColumnas";
import { queryCatalog, exportCatalogRows } from "@/lib/erp/actions";
import type { CatalogFacets, CatalogQuery, CatalogRow } from "@/lib/erp/catalog";
import type { RequestPickers } from "@/lib/erp/request-pickers";
import {
  DEFAULT_SORTING, catalogColumns, columnStateFromView, canMoveColumn, moveColumn, inOrder, visibleIds,
  toggleColumn, hideColumn, isCustomOrder, type CatalogColumn,
} from "@/lib/erp/catalog-columns";
import { usePrefs } from "@/lib/prefs";

export type { CatalogRow };

/** Small product thumbnail with a graceful placeholder when there's no image. */
function Thumb({ path, alt }: { path?: string | null; alt: string }) {
  const url = productImageUrl(path);
  if (!url) return <div className="h-8 w-8 rounded bg-slate-100 ring-1 ring-slate-200" aria-hidden />;
  return <img src={url} alt={alt} loading="lazy" className="h-8 w-8 rounded object-cover ring-1 ring-slate-200" />;
}

const COMMERCIAL = ["all", "active", "special_order", "discontinued", "inactive"];
type T = (en: string, es: string) => string;

// G-10 (D-203): texto de pantalla por pares inline (usePrefs). Lo que se construye con t() va en
// funciones y no en constantes de módulo, porque una constante no cambia de idioma. Los VALORES
// (value, state) son los que se guardan y filtran, y no se tocan; solo cambia la etiqueta.
const recordTabs = (t: T) => [
  { value: "all", label: t("All", "Todos") },
  { value: "published", label: t("Published", "Publicados") },
  { value: "draft", label: t("Draft", "Borrador") },
  { value: "pending_approval", label: t("Pending", "Pendientes") },
  { value: "archived", label: t("Archived", "Archivados") },
] as const;
const builtins = (t: T) => [
  { name: t("Active", "Activos"), state: { statusFilter: "active", recordTab: "all", reviewOnly: false, globalFilter: "" } },
  { name: t("Needs review", "Requiere revisión"), state: { reviewOnly: true, statusFilter: "all", recordTab: "all", globalFilter: "" } },
  { name: t("Special order", "Pedido especial"), state: { statusFilter: "special_order", recordTab: "all", reviewOnly: false, globalFilter: "" } },
  { name: t("Drafts", "Borradores"), state: { recordTab: "draft", statusFilter: "all", reviewOnly: false, globalFilter: "" } },
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
  requestPickers,
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
  /**
   * D-NEXT: los desplegables del formulario de solicitud, cargados UNA vez por la página
   * (`loadRequestPickers`). Con ellos aparece «Request» en cada fila (columna tras Name, y botón en
   * la tarjeta), que abre el formulario en un panel lateral sobre ese producto. Sin ellos, no.
   */
  requestPickers?: RequestPickers;
}) {
  const { t } = usePrefs();
  const [rows, setRows] = useState<CatalogRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [globalFilter, setGlobalFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  // D-NEXT: qué columnas se ven y en qué orden (⚙ Columnas y el menú de cada cabecera). Viajan en la
  // vista guardada; sin guardar, se pierden al recargar (como los filtros).
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [requestRow, setRequestRow] = useState<CatalogRow | null>(null);
  const canRequest = !!requestPickers;
  const colInfo = useMemo(() => catalogColumns({ canSeeCost, canRequest }), [canSeeCost, canRequest]);
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
    // D-NEXT: una vista (o un chip prefijado) es una foto completa. Las guardadas antes no traen
    // columnOrder/columnVisibility y abren en la disposición por defecto; columnStateFromView además
    // tira toda columna que esta sesión no tiene —costo y margen para staff, aunque la vista los nombre—.
    const cols = columnStateFromView(s, colInfo);
    setSorting(cols.sorting);
    setColumnOrder(cols.columnOrder);
    setColumnVisibility(cols.columnVisibility);
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

  // D-NEXT: QUÉ columnas hay (y si se ordenan u ocultan) lo decide `catalogColumns`
  // (lib/erp/catalog-columns.ts, probado importándolo); aquí solo cómo se pinta cada una. Costo y
  // margen ni se construyen para quien no ve costo (#29), así que ningún control puede enseñarlos.
  const columns = useMemo<ColumnDef<CatalogRow>[]>(() => {
    const celdas: Record<string, Partial<ColumnDef<CatalogRow>> & { size: number }> = {
      thumb: { size: 48, cell: (c) => <Thumb path={c.row.original.image_path} alt={c.row.original.sku} /> },
      sku: { accessorKey: "sku", size: 140, cell: (c) => <span className="font-mono text-xs text-slate-600">{c.getValue<string>()}</span> },
      name: { accessorKey: "name", size: 300, cell: (c) => <span className="font-medium text-slate-900">{c.getValue<string>()}</span> },
      request: { size: 104, cell: (c) => (
        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setRequestRow(c.row.original); }}>{t("Request", "Solicitar")}</Button>
      ) },
      status: { accessorKey: "status", size: 130, cell: (c) => <Badge className={commercialStatusClass(c.getValue<string>())}>{t(statusLabel(c.getValue<string>()).en, statusLabel(c.getValue<string>()).es)}</Badge> },
      product_type: { accessorKey: "product_type", size: 100, cell: (c) => <span className="text-slate-500">{c.getValue<string>() ?? "—"}</span> },
      category_path: { accessorKey: "category_path", size: 190, cell: (c) => <span className="text-slate-500">{c.getValue<string>() ?? "—"}</span> },
      vendor_name: { accessorKey: "vendor_name", size: 180, cell: (c) => <span className="text-slate-500">{c.getValue<string>() ?? "—"}</span> },
      price: { accessorKey: "price", size: 116, cell: (c) => (
        <span className="tabular-nums">{money(c.getValue<number | null>())}<span className="text-xs text-slate-400">{priceUnitSuffix(c.row.original.sell_unit)}</span></span>
      ) },
      cost: { accessorKey: "cost", size: 92, cell: (c) => <span className="tabular-nums text-slate-500">{money(c.getValue<number | null>())}</span> },
      margin_pct: { accessorKey: "margin_pct", size: 80, cell: (c) => { const v = c.getValue<number | null>(); return <span className="tabular-nums text-slate-500">{v == null ? "—" : `${v}%`}</span>; } },
      qoh: { accessorKey: "qoh", size: 84, cell: (c) => { const v = c.getValue<number | null>(); return <span className="tabular-nums text-slate-600">{v == null ? "—" : Number(v).toLocaleString()}</span>; } },
      review: { size: 36, cell: (c) => (c.row.original.needs_review ? <span title={t("Needs review", "Requiere revisión")} className="inline-block h-2 w-2 rounded-full bg-amber-400" /> : null) },
    };
    // Imagen, Request y el punto de revisión van sin título (como antes): sin menú de cabecera; el
    // ⚙ Columnas los nombra igual y los oculta o mueve.
    const sinTitulo = new Set(["thumb", "request", "review"]);
    return colInfo.map(
      (c) => ({ ...celdas[c.id], id: c.id, header: sinTitulo.has(c.id) ? "" : t(c.en, c.es), enableSorting: c.canSort, enableHiding: c.canHide }) as ColumnDef<CatalogRow>,
    );
  }, [colInfo, t]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility, columnOrder },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => String(r.id),
    manualSorting: true,
    manualFiltering: true,
  });

  // Lo que el ⚙ Columnas enseña: las columnas en el orden de la persona, cuáles se ven y cómo moverlas.
  const ordenPorDefecto = colInfo.map((c) => c.id);
  const columnasEnOrden = inOrder(colInfo, columnOrder);
  const ordenActual = columnasEnOrden.map((c) => c.id);
  const paraElSelector = columnasEnOrden.map((c) => ({ key: c.id, en: c.en, es: c.es, ...(c.canHide ? {} : { fija: true as const }) }));
  const infoDe = (id: string) => colInfo.find((c) => c.id === id) as CatalogColumn;

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
          t("Loading more…", "Cargando más…")
        ) : (
          <button type="button" onClick={loadMore} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
            {t("Load more", "Cargar más")} ({(total - rows.length).toLocaleString()} {t("left", "restantes")})
          </button>
        )}
      </div>
    ) : null;

  return (
    <div>
      {!compact && (
        <SavedViews scope="catalog" saved={savedViews} builtins={builtins(t)} currentState={{ globalFilter, statusFilter, recordTab, reviewOnly, sorting, columnVisibility, columnOrder }} onApply={applyState} />
      )}

      {!compact && facets && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label={t("Products", "Productos")} value={facets.total} dot="bg-slate-300" />
          <Kpi label={t("Active", "Activos")} value={facets.active} dot="bg-emerald-400" />
          <Kpi label={t("Needs review", "Requiere revisión")} value={facets.needs_review} dot="bg-amber-400" />
          <Kpi label={t("Special order", "Pedido especial")} value={facets.special_order} dot="bg-sky-400" />
        </div>
      )}

      {!compact && facets && (
        <div className="mb-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {recordTabs(t).map((tab) => {
            const active = recordTab === tab.value;
            const count = facets.by_record[tab.value as keyof CatalogFacets["by_record"]] ?? 0;
            return (
              <button key={tab.value} type="button" onClick={() => setRecordTab(tab.value)} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors", active ? "bg-clay-50 font-medium text-clay-700" : "text-slate-500 hover:text-slate-800")}>
                {active && <span className="h-1.5 w-1.5 rounded-full bg-clay-500" />}
                {tab.label}
                <span className="text-xs text-slate-400">{count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input placeholder={t("Search name, SKU, vendor…", "Buscar nombre, SKU, proveedor…")} value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} className="max-w-xs" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500">
          {COMMERCIAL.map((s) => (
            <option key={s} value={s}>{s === "all" ? t("All statuses", "Todos los estados") : t(statusLabel(s).en, statusLabel(s).es)}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} className="accent-clay-500" />
          {t("Needs review", "Requiere revisión")}
        </label>
        <div className="ml-auto flex items-center gap-2">
          {/* D-NEXT: el ⚙ Columnas de la casa (SelectorDeColumnas, el de Órdenes y el Gestor), no uno
              segundo: mostrar/ocultar, subir/bajar y «Restablecer orden». Solo en la vista de tabla. */}
          {view === "table" && (
            <SelectorDeColumnas
              columnas={paraElSelector}
              elegidas={visibleIds(colInfo, columnVisibility)}
              onAlterna={(key) => setColumnVisibility((v) => toggleColumn(v, infoDe(key)))}
              rotulo={(c) => t(c.en, c.es)}
              titulo={t("Columns", "Columnas")}
              nota={t("Saved with the view (+ Save view).", "Se guarda con la vista (+ Guardar vista).")}
              t={t}
              mover={{
                seMueve: (key, delta) => canMoveColumn(ordenActual, key, delta),
                onMueve: (key, delta) => setColumnOrder(moveColumn(ordenActual, key, delta)),
                ordenPropio: isCustomOrder(columnOrder, ordenPorDefecto),
                onRestablece: () => setColumnOrder([]),
              }}
            />
          )}
          {!compact && (
            <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5" role="group" aria-label={t("View mode", "Modo de vista")}>
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
                  {v === "table" ? t("table", "tabla") : t("cards", "tarjetas")}
                </button>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => exportView("csv")} disabled={exporting}>{exporting ? t("Exporting…", "Exportando…") : "CSV"}</Button>
          <Button variant="outline" size="sm" onClick={() => exportView("xlsx")} disabled={exporting}>XLSX</Button>
          <span className="text-sm text-slate-500">
            {loading ? t("Searching…", "Buscando…") : `${rows.length.toLocaleString()} ${t("of", "de")} ${total.toLocaleString()}`}
          </span>
        </div>
      </div>

      {err && <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{t("Failed to load catalog:", "No se pudo cargar el catálogo:")} {err}</p>}

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
            <CatalogCards rows={rows} onRequest={canRequest ? setRequestRow : undefined} />
            {loadMoreFooter}
          </>
        ) : (
          <div style={{ minWidth: totalWidth }}>
            <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <div className="flex w-10 shrink-0 items-center justify-center py-2.5">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-clay-500" aria-label={t("Select all loaded", "Seleccionar todo lo cargado")} />
              </div>
              {/* D-NEXT: pulsar una cabecera abre su menú (ordenar ↑/↓, ocultar) en vez de alternar el
                  orden. Ordenar escribe el MISMO `sorting` que lee la consulta (sortId/sortDesc): el
                  servidor vuelve a pedir desde la página 1; nada se ordena en el navegador. */}
              {table.getHeaderGroups()[0].headers.map((h) => (
                <div key={h.id} style={{ width: h.getSize() }} className="px-3 py-2.5 font-medium">
                  {h.isPlaceholder || !h.column.columnDef.header ? null : (
                    <ColumnHeaderMenu
                      label={t(infoDe(h.column.id).en, infoDe(h.column.id).es)}
                      sorted={h.column.getIsSorted()}
                      canSort={h.column.getCanSort()}
                      canHide={h.column.getCanHide()}
                      onSort={(desc) => setSorting([{ id: h.column.id, desc }])}
                      onHide={() => setColumnVisibility((v) => hideColumn(v, infoDe(h.column.id)))}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </ColumnHeaderMenu>
                  )}
                </div>
              ))}
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
              {tableRows.length === 0 && !loading && <div className="p-8 text-center text-sm text-slate-500">{t("No products match these filters.", "Ningún producto coincide con estos filtros.")}</div>}
            </div>

            {loadMoreFooter}
          </div>
        )}
      </div>

      {drawerId !== null && <ProductDrawer productId={drawerId} canEdit={canSeeCost} canSeeCost={canSeeCost} onClose={() => setDrawerId(null)} />}
      {requestRow && requestPickers && (
        <RequestDrawer product={requestRow} pickers={requestPickers} canSeeCost={canSeeCost} onClose={() => setRequestRow(null)} />
      )}
      {selected.size > 0 && (
        <BulkBar ids={[...selected]} canEdit={canSeeCost} onClear={() => setSelected(new Set())} onExport={exportSelection} />
      )}
    </div>
  );
}
