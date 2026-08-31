"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { stageInfo, stageLabel } from "@/lib/constants";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/data-provider";
import { fmtDate, fmtDateShort, fmtMilitary, fmtMoney, fmtWindows, isOverdue, orderLabel, palletVariance, storeTag } from "@/lib/utils";
import { useColWidthMap } from "@/lib/use-col-widths";
import type { Delivery } from "@/lib/types";

type Ctx = {
  lang: "en" | "es";
  t: (en: string, es: string) => string;
  /** Drivers identify a load by the invoice on the paperwork in their hand,
   * not by the system's order code — so their ID column shows that instead. */
  byInvoice?: boolean;
};
type CellValue = string | number | null;

// ---- Column registry (#13 column customization) ---------------------------
// "ID" is always shown; everything else can be toggled by the user.
export interface OrderColumn {
  key: string;
  en: string;
  es: string;
  cell: (d: Delivery, ctx: Ctx) => React.ReactNode;
  /** Raw comparable value used for sorting + the Excel-style filter checklist.
   * Numbers sort numerically; everything else sorts as text. */
  value: (d: Delivery, ctx: Ctx) => CellValue;
  /** Optional override for how a raw value is labeled in the filter checklist
   * (e.g. a date column keeps its ISO value as the sort/filter key but shows
   * the formatted date to the user). Defaults to String(value). */
  filterLabel?: (v: CellValue) => string;
}

export const ORDER_COLUMNS: OrderColumn[] = [
  { key: "stage", en: "Stage", es: "Etapa", value: (d, { lang }) => stageLabel(d.stage, lang), cell: (d, { lang }) => {
      const s = stageInfo(d.stage);
      return <span className="sema" style={{ background: s.color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>;
    } },
  { key: "type", en: "Type", es: "Tipo", value: (d) => d.order_type, cell: (d) => d.order_type || "—" },
  { key: "store", en: "Store", es: "Tienda", value: (d) => d.store, cell: (d) => d.store || "—" },
  { key: "account", en: "Account", es: "Cuenta", value: (d) => d.account, cell: (d) => d.account || "—" },
  { key: "so", en: "SO #", es: "SO #", value: (d) => d.so_num, cell: (d) => d.so_num || "—" },
  { key: "po", en: "PO #", es: "PO #", value: (d) => d.po2, cell: (d) => d.po2 || "—" },
  { key: "invoice", en: "Invoice #", es: "Factura #", value: (d) => d.invoice_num, cell: (d) => d.invoice_num || "—" },
  {
    key: "date", en: "Delivery Date", es: "Fecha entrega",
    value: (d) => d.delivery_date,
    filterLabel: (v) => fmtDate(v as string | null),
    cell: (d, { t }) => {
      const late = isOverdue(d);
      return (
        <span style={late ? { color: "var(--red)", fontWeight: 700 } : undefined}>
          {fmtDate(d.delivery_date)}
          {late && <span className="sema" style={{ background: "var(--red)", color: "#fff", marginLeft: 6 }}>{t("Late", "Tarde")}</span>}
          {d.morning_priority && <span className="sema" title={t("Priority — deliver first thing in the morning", "Prioridad — entregar a primera hora")} style={{ background: "var(--amber)", color: "#3a2a00", marginLeft: 6 }}>⏰ {t("AM", "AM")}</span>}
        </span>
      );
    },
  },
  { key: "windows", en: "Windows", es: "Ventanas", value: (d) => d.delivery_windows, cell: (d) => fmtWindows(d.delivery_windows) },
  { key: "pallets", en: "Pallets", es: "Pallets", value: (d) => d.actual_pallets ?? d.est_pallets ?? null, cell: (d, { t }) => {
      const v = palletVariance(d);
      const val = d.actual_pallets ?? d.est_pallets ?? "—";
      if (!v) return <>{val}</>;
      return (
        <span style={{ color: "var(--amber)", fontWeight: 700 }}
          title={t(`Actual ${v.actual} vs estimated ${v.est} (${v.diff > 0 ? "+" : ""}${v.diff})`, `Real ${v.actual} vs estimado ${v.est} (${v.diff > 0 ? "+" : ""}${v.diff})`)}>
          {val} ⚠
        </span>
      );
    } },
  {
    // Sin tarifa NO se pinta como una raya (D-148). Un "—" se lee como "aquí no aplica",
    // que es justo lo contrario de lo que pasa: aplica y falta. En rojo y con la palabra
    // delante, porque el almacén tiene que verlo en la cola sin abrir nada.
    //
    // El $0 se enseña como importe, pero también en rojo: es un valor legítimo —cortesía,
    // una reentrega que se come la casa— y por eso hay que mirarlo, no esconderlo.
    key: "fee", en: "Fee", es: "Costo",
    value: (d) => d.delivery_fee,
    filterLabel: (v) => (v == null ? "—" : fmtMoney(Number(v))),
    cell: (d, { t }) => {
      if (d.delivery_fee == null) return <span className="no-fee">🚩 {t("NO FEE", "SIN TARIFA")}</span>;
      if (Number(d.delivery_fee) === 0) return <span className="no-fee">🚩 {fmtMoney(0)}</span>;
      return fmtMoney(d.delivery_fee);
    },
  },
  { key: "driver", en: "Driver", es: "Chofer", value: (d) => d.assigned_driver, cell: (d) => d.assigned_driver || "—" },
  { key: "contact", en: "Contact", es: "Contacto", value: (d) => d.contact, cell: (d) => d.contact || "—" },
  { key: "address", en: "Delivery Address", es: "Dirección", value: (d) => d.delivery_address, cell: (d) => d.delivery_address || "—" },
];

export const DEFAULT_COLUMNS = ["stage", "type", "store", "account", "so", "date", "windows", "pallets", "driver"];

// Pseudo-column for the always-visible ID, so it gets the same sort/filter UI.
//
// On a phone the table collapses to one card per order, and this cell is the
// card's header — so it carries the three things a driver needs to triage a
// stop without opening it: what state it's in, what kind of order it is, and
// which branch it ships out of. The extra badges are hidden on desktop, where
// those already have their own columns.
const ID_COLUMN: OrderColumn = {
  key: "__id",
  en: "ID",
  es: "ID",
  value: (d, { byInvoice }) => (byInvoice ? (d.invoice_num || orderLabel(d)) : orderLabel(d)),
  cell: (d, { lang, byInvoice }) => {
    const s = stageInfo(d.stage);
    const tag = storeTag(d.store);
    const late = isOverdue(d);
    // An order can carry several invoices ("177987, 177986") or none at all.
    // Falling back to the order code keeps the row from ever going blank.
    const invoice = (d.invoice_num || "").trim();
    // An order can carry several invoices ("178137, 178138, 178139"). Showing
    // them all is right on a phone card, where the driver matches paperwork
    // against every one of them and there is a line to spare — but on the
    // desktop table it stretched the column wide enough to squeeze every other
    // column. There, two are shown and the rest are a "+N" the full list hovers
    // out of.
    const invParts = invoice ? invoice.split(",").map((x) => x.trim()).filter(Boolean) : [];
    const invHead = invParts.slice(0, 2).join(", ");
    const invRest = invParts.length - 2;
    return (
      <>
        {/* The number is the thing being looked up, so it never truncates —
            an order can carry several invoices ("177966, 177987") and a driver
            matching paperwork needs to read all of them. It wraps instead. */}
        {byInvoice ? (
          // The driver's card header, three paired lines. Each line answers a
          // question on the left and gives the matching number on the right,
          // so the whole card can be read down one edge instead of hunted
          // through: what state / which invoice, what kind / which day, which
          // branch / which order.
          <span className="drv-head">
            <span className="drv-l">
              <span className="sema" style={{ background: s.color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>
            </span>
            {/* An order can carry several invoices ("177966, 177987"). A driver
                matches paperwork against this, so it wraps rather than
                truncating — all of them have to be readable. */}
            <span className="drv-r drv-inv" title={invParts.length > 2 ? invoice : undefined}>
              {invoice ? (
                <>
                  {/* Phone: every number, wrapping. */}
                  <span className="inv-all">INV {invoice}</span>
                  {/* Desktop: two, then a count that the title reveals. */}
                  <span className="inv-short">
                    INV {invHead}
                    {invRest > 0 && <span className="inv-more">+{invRest}</span>}
                  </span>
                </>
              ) : "—"}
            </span>

            <span className="drv-l"><span className="row-type">{d.order_type || "—"}</span></span>
            <span className="drv-r">
              {d.delivery_date ? (
                <span className={"row-date" + (late ? " late" : "")} title={fmtDate(d.delivery_date)}>
                  {lang === "es" ? "Entrega: " : "Del Date: "}{fmtDateShort(d.delivery_date, lang)}
                </span>
              ) : "—"}
            </span>

            <span className="drv-l">
              {/* The full store name, not "BRO". The three-letter tag exists
                  for cramped desktop columns; this line has room, and a
                  driver shouldn't have to decode an abbreviation. */}
              {d.store && <span className="store-tag">{d.store}</span>}
            </span>
            <span className="drv-r drv-code">ID #{orderLabel(d)}</span>
          </span>
        ) : (
          <>
            #{orderLabel(d)}
            {/* Status stack, right-aligned: where the order stands, then what
                it is. Mobile-only; desktop has its own Stage/Type/Store
                columns. */}
            <span className="row-badges">
              <span className="row-badge-line">
                <span className="sema" style={{ background: s.color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>
              </span>
              <span className="row-badge-line">
                {d.delivery_date && (
                  <span className={"row-date" + (late ? " late" : "")} title={fmtDate(d.delivery_date)}>
                    {fmtDateShort(d.delivery_date, lang)}
                  </span>
                )}
                {tag && <span className="store-tag" title={d.store ?? undefined}>{tag}</span>}
              </span>
              <span className="row-badge-line">
                <span className="row-type">{d.order_type || "—"}</span>
              </span>
            </span>
          </>
        )}
      </>
    );
  },
};

const NO_VALUE = " —"; // internal key for null/blank, kept out of user-typed territory

function filterKey(v: CellValue): string {
  return v == null || v === "" ? NO_VALUE : String(v);
}

/** Excel-style checklist filter for one column header: search box, select-all,
 * one checkbox per distinct value present in the (other-filters-applied) rows. */
function ColumnFilterMenu({
  col, options, active, onApply, onClear, onClose, lang, t, style, menuRef,
}: {
  col: OrderColumn;
  options: { key: string; label: string }[];
  active: Set<string> | undefined;
  onApply: (next: Set<string>) => void;
  onClear: () => void;
  onClose: () => void;
  lang: "en" | "es";
  t: (en: string, es: string) => string;
  /** Screen position — this renders in a portal, so it can't rely on a
   * positioned ancestor the way the Columns picker menu does. */
  style?: React.CSSProperties;
  menuRef?: React.Ref<HTMLDivElement>;
}) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Set<string>>(() => new Set(active ?? options.map((o) => o.key)));

  const visible = options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()));
  const allVisibleChecked = visible.length > 0 && visible.every((o) => draft.has(o.key));

  const toggle = (key: string) =>
    setDraft((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const toggleAllVisible = () =>
    setDraft((prev) => {
      const n = new Set(prev);
      if (allVisibleChecked) visible.forEach((o) => n.delete(o.key));
      else visible.forEach((o) => n.add(o.key));
      return n;
    });

  return (
    <div ref={menuRef} className="col-menu" style={style} onClick={(e) => e.stopPropagation()}>
      <div className="col-menu-head">
        <b>{lang === "es" ? col.es : col.en}</b>
        <button className="notif-clear" onClick={onClose}>✕</button>
      </div>
      <input
        className="col-menu-search"
        placeholder={t("Search values…", "Buscar valores…")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <label className="col-opt">
        <input type="checkbox" checked={allVisibleChecked} onChange={toggleAllVisible} />
        <b>{t("Select all", "Seleccionar todo")}</b>
      </label>
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {visible.map((o) => (
          <label key={o.key} className="col-opt">
            <input type="checkbox" checked={draft.has(o.key)} onChange={() => toggle(o.key)} />
            {o.label}
          </label>
        ))}
        {visible.length === 0 && <div className="hint" style={{ padding: "6px 8px" }}>{t("No matches.", "Sin coincidencias.")}</div>}
      </div>
      <div className="col-menu-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => { onClear(); }}>{t("Clear", "Limpiar")}</button>
        <button className="btn btn-primary btn-sm" onClick={() => onApply(draft)}>{t("Apply", "Aplicar")}</button>
      </div>
    </div>
  );
}

/** Compact, horizontally-scrollable table of orders. Click a row to open it.
 * Every column supports click-to-sort and an Excel-style value checklist
 * filter; optionally supports row selection (bulk actions) and custom
 * columns. */
export function OrdersTable({
  rows,
  onOpen,
  empty = "No orders here.",
  visible = DEFAULT_COLUMNS,
  selectable = false,
  selected,
  onToggle,
  onToggleAll,
  isUrgent,
  resizeKey = "orders",
  collapsible = false,
}: {
  rows: Delivery[];
  onOpen: (d: Delivery) => void;
  empty?: string;
  visible?: string[];
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
  /** Rows this returns true for get a red "needs immediate action" highlight
   * (e.g. still pending approval past today's cutoff). */
  isUrgent?: (d: Delivery) => boolean;
  /** Namespaces the per-column widths in localStorage (e.g. per view/role). */
  resizeKey?: string;
  /** Phone layout only: each order starts collapsed to its header row (id +
   * stage + type + branch) with a chevron to open the rest. Used by the driver
   * view, where a whole day of stops otherwise means endless scrolling.
   * Desktop is unaffected — the table there shows every column as usual. */
  collapsible?: boolean;
}) {
  const { lang, t } = usePrefs();
  const { me } = useData();
  // Which rows the driver has opened. Collapsed is the default, so this only
  // ever holds the handful they're actively looking at.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const colw = useColWidthMap(`rtg_colw_${resizeKey}`);
  // Drivers read the invoice number off the paperwork; everyone else works
  // from the order code. Driven by the VIEWER's role, so it follows the
  // person across the driver view and the orders board alike.
  // The invoice is what everyone actually quotes — the customer on the phone,
  // the warehouse on the paperwork, the driver at the tailgate. The order code
  // is still shown, just as the second line rather than the headline.
  const byInvoice = true;
  const ctx: Ctx = { lang, t, byInvoice };
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  // The filter menu renders in a portal (see below) so a short table with
  // few rows can't clip it — .tbl-scroll's horizontal scrollbar makes it
  // clip vertical overflow too, which used to hide the menu almost
  // entirely. Portaling needs the trigger button's on-screen position.
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const filterBtnRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuRef = useRef<HTMLDivElement>(null);

  const cols = useMemo(() => {
    // Relabel the first column when it holds an invoice — a header reading
    // "ID" over an invoice number is worse than no header at all.
    // Just "#" — the value itself already says whether it's an invoice or an
    // SO, and the word was eating the width the number needs.
    const idCol = byInvoice ? { ...ID_COLUMN, en: "#", es: "#" } : ID_COLUMN;
    return [idCol, ...ORDER_COLUMNS.filter((c) => visible.includes(c.key))];
  }, [visible, byInvoice]);

  const openFilterMenu = (key: string) => {
    if (openFilter === key) { setOpenFilter(null); return; }
    const btn = filterBtnRefs.current.get(key);
    if (btn) setMenuAnchor(btn.getBoundingClientRect());
    setOpenFilter(key);
  };

  // Keep the menu pinned to its trigger button while scrolling/resizing, and
  // close it on an outside click (it's portaled out of the header cell now,
  // so the header's own click-catching no longer covers it).
  useEffect(() => {
    if (!openFilter) return;
    const reposition = () => {
      const btn = filterBtnRefs.current.get(openFilter);
      if (btn) setMenuAnchor(btn.getBoundingClientRect());
    };
    const onOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenFilter(null);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onOutside);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [openFilter]);

  // Rows matching every active column filter, optionally ignoring one column's
  // own filter — used so that column's own checklist still offers every value
  // that would remain visible if you cleared just that filter (Excel-style
  // cascading options), while other columns' choices still narrow it down.
  const applyFilters = (data: Delivery[], skipKey?: string) =>
    data.filter((d) =>
      cols.every((c) => {
        if (c.key === skipKey) return true;
        const active = filters[c.key];
        if (!active || active.size === 0) return true;
        return active.has(filterKey(c.value(d, ctx)));
      }),
    );

  const filteredRows = useMemo(() => applyFilters(rows), [rows, filters, cols, lang]);

  const sortedRows = useMemo(() => {
    if (!sortKey || !sortDir) return filteredRows;
    const col = cols.find((c) => c.key === sortKey);
    if (!col) return filteredRows;
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const va = col.value(a, ctx);
      const vb = col.value(b, ctx);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filteredRows, sortKey, sortDir, cols, lang]);

  if (!rows.length) return <div className="empty">{empty}</div>;

  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortKey(null); setSortDir(null); }
  };

  const optionsFor = (col: OrderColumn) => {
    const base = applyFilters(rows, col.key);
    const map = new Map<string, string>();
    for (const d of base) {
      const raw = col.value(d, ctx);
      const key = filterKey(raw);
      if (map.has(key)) continue;
      map.set(key, key === NO_VALUE ? "—" : col.filterLabel ? col.filterLabel(raw) : key);
    }
    return [...map.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  };

  const allChecked = !!selected && rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <>
    <div className="tbl-scroll orders-scroll">
      <table className="orders tbl-resize orders-responsive">
        <colgroup>
          {selectable && <col style={{ width: 34 }} />}
          {cols.map((c) => <col key={c.key} style={{ width: colw.widthOf(c.key) }} />)}
        </colgroup>
        <thead>
          <tr>
            {selectable && (
              <th>
                <input type="checkbox" checked={allChecked} onChange={onToggleAll} style={{ width: 15, height: 15 }} />
              </th>
            )}
            {cols.map((c) => {
              const activeCount = filters[c.key]?.size;
              const hasFilter = activeCount != null && activeCount > 0;
              return (
                <th key={c.key}>
                  <div className="th-cell">
                    <button className="th-sort" onClick={() => toggleSort(c.key)} title={t("Sort", "Ordenar")}>
                      {lang === "es" ? c.es : c.en}
                      {sortKey === c.key && (sortDir === "asc" ? " ▲" : " ▼")}
                    </button>
                    <button
                      ref={(el) => { if (el) filterBtnRefs.current.set(c.key, el); else filterBtnRefs.current.delete(c.key); }}
                      className={"th-filter-btn " + (hasFilter ? "on" : "")}
                      onClick={(e) => { e.stopPropagation(); openFilterMenu(c.key); }}
                      title={t("Filter", "Filtrar")}
                    >
                      ▾
                    </button>
                  </div>
                  {/* Drag to resize; double-click to reset this column. */}
                  <span className="col-resizer" onMouseDown={colw.startResize(c.key)} onDoubleClick={() => colw.resetCol(c.key)} />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr><td colSpan={cols.length + (selectable ? 1 : 0)} className="empty">{t("No rows match the current filters.", "Ninguna fila coincide con los filtros actuales.")}</td></tr>
          ) : sortedRows.map((d) => (
            <tr
              key={d.id}
              className={"clickable"
                + (isUrgent?.(d) ? " row-urgent" : "")
                + (collapsible && !expanded.has(d.id) ? " row-collapsed" : "")}
              onClick={() => onOpen(d)}
            >
              {selectable && (
                <td className="sel-cell" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={!!selected?.has(d.id)} onChange={() => onToggle?.(d.id)} style={{ width: 15, height: 15 }} />
                </td>
              )}
              {cols.map((c) => (
                <td key={c.key} data-label={lang === "es" ? c.es : c.en} className={c.key === "__id" ? (byInvoice ? "ordno ordno-drv" : "ordno") : undefined}>
                  {c.cell(d, ctx)}
                  {/* The chevron is only offered where the extra rows are
                      worth unfolding. On the invoice-led card the header
                      already carries stage, type, store, date, invoice and
                      order id — everything else is one tap away in the order
                      itself, so the chevron was a fourth line that opened
                      what nobody was asking for.
                      It stops the click, so expanding never opens the order. */}
                  {collapsible && !byInvoice && c.key === "__id" && (
                    <button
                      className="row-expand"
                      onClick={(e) => { e.stopPropagation(); toggleExpanded(d.id); }}
                      aria-expanded={expanded.has(d.id)}
                      title={expanded.has(d.id) ? t("Show less", "Ver menos") : t("Show details", "Ver detalles")}
                    >
                      {expanded.has(d.id) ? "▾" : "▸"}
                    </button>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {openFilter && menuAnchor && createPortal(
      (() => {
        const MENU_WIDTH = 210;
        const MENU_BUDGET = 400; // rough max height (search + list + actions)
        const spaceBelow = window.innerHeight - menuAnchor.bottom;
        const openUpward = spaceBelow < MENU_BUDGET && menuAnchor.top > spaceBelow;
        const col = cols.find((c) => c.key === openFilter);
        if (!col) return null;
        return (
          <ColumnFilterMenu
            menuRef={menuRef}
            col={col}
            options={optionsFor(col)}
            active={filters[openFilter]}
            lang={lang}
            t={t}
            style={{
              position: "fixed",
              right: "auto",
              left: Math.max(8, Math.min(menuAnchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
              top: openUpward ? undefined : menuAnchor.bottom + 6,
              bottom: openUpward ? window.innerHeight - menuAnchor.top + 6 : undefined,
            }}
            onApply={(next) => {
              setFilters((f) => ({ ...f, [openFilter]: next }));
              setOpenFilter(null);
            }}
            onClear={() => {
              setFilters((f) => { const n = { ...f }; delete n[openFilter]; return n; });
              setOpenFilter(null);
            }}
            onClose={() => setOpenFilter(null)}
          />
        );
      })(),
      document.body,
    )}
    </>
  );
}

export { fmtMilitary };
