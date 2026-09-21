"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { stageInfo, stageLabel } from "@/lib/constants";
import { motivoDeAnulacion, motivosDeAnulacion } from "@/lib/cancel-reasons";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/data-provider";
import { fmtDate, fmtDateShort, fmtMilitary, fmtMoney, fmtWindows, isOverdue, orderLabel, palletVariance, storeTag } from "@/lib/utils";
import { anchoDeTabla, useColWidthMap } from "@/lib/use-col-widths";
import { ANCHO_MINIMO } from "@/lib/user-prefs";
import { columnasEnOrden, enOrdenDePartida, ordenEfectivo } from "@/lib/orden-de-columnas";
import { posicionDelMenu, useCierraAlSalir } from "@/lib/menu-desplegable";
import { columnasFiltradas, textoDeColumnas } from "@/lib/filtros-activos";
import { gruposPorTienda } from "@/lib/documento-pendiente";
import { DocumentoPendiente } from "@/components/DocumentoPendiente";
import type { CancelReason, Delivery } from "@/lib/types";

type Ctx = {
  lang: "en" | "es";
  t: (en: string, es: string) => string;
  /** Drivers identify a load by the invoice on the paperwork in their hand,
   * not by the system's order code — so their ID column shows that instead. */
  byInvoice?: boolean;
  /** Los motivos de anulación vigentes, para traducir la clave que guarda la orden (122). */
  motivos?: CancelReason[];
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
  { key: "stage", en: "Stage", es: "Etapa", value: (d, { lang }) => stageLabel(d.stage, lang), cell: (d, { lang, motivos }) => {
      const s = stageInfo(d.stage);
      // Una anulada lleva su motivo al lado, no escondido en la ficha: en la lista es donde se ve que
      // media tarde de órdenes se cayó por duplicadas (122).
      const porQue = d.stage === "canceled" ? motivoDeAnulacion(d, motivos ?? [], lang) : "";
      return (
        <>
          <span className="sema" style={{ background: s.color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>
          {porQue && <span style={{ color: "var(--gray)", marginLeft: 6, fontSize: 12 }}>{porQue}</span>}
        </>
      );
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
  { key: "address", en: "Delivery Address", es: "Dirección de entrega", value: (d) => d.delivery_address, cell: (d) => d.delivery_address || "—" },
];

// El orden de partida (D-347) vive en `lib/orden-de-columnas`, donde se puede probar. Se ordena EN SU SITIO: el catálogo
// de arriba se queda escrito como estaba, porque hay pruebas que lo leen del fuente.
enOrdenDePartida(ORDER_COLUMNS);

/** Las de la captura del dueño (D-347), para todo rol sin juego propio. */
export const DEFAULT_COLUMNS = ["po", "type", "account", "stage", "store", "date", "pallets", "driver", "address", "windows"];

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
              ) : null}
              {/* El documento que el tipo exige y falta (D-310): pastilla, y para quien puede, el
                  número escrito aquí mismo. Ocupa el sitio del «—»: la fila no crece. Va aparte de la
                  factura porque a una Intertienda le puede faltar el PO teniendo factura. */}
              <DocumentoPendiente d={d} vacio={invoice ? null : "—"} />
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

/** One column header's menu: sort it, then an Excel-style checklist filter (search box,
 * select-all, one checkbox per distinct value present in the other-filters-applied rows).
 * Sorting sits in the same menu so both are one click away (D-275). */
function ColumnFilterMenu({
  col, options, active, orden, onOrdenar, onApply, onClear, onClose, lang, t, style, menuRef,
}: {
  col: OrderColumn;
  options: { key: string; label: string }[];
  active: Set<string> | undefined;
  /** How THIS column is sorted right now; null when the table is sorted by another or not at all. */
  orden: "asc" | "desc" | null;
  onOrdenar: (dir: "asc" | "desc" | null) => void;
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
      <div className="col-menu-orden">
        <button className={"col-opt col-orden" + (orden === "asc" ? " on" : "")} onClick={() => onOrdenar("asc")}>
          ↑ {t("Sort ascending", "Orden ascendente")}
        </button>
        <button className={"col-opt col-orden" + (orden === "desc" ? " on" : "")} onClick={() => onOrdenar("desc")}>
          ↓ {t("Sort descending", "Orden descendente")}
        </button>
        {orden && (
          <button className="col-opt col-orden" onClick={() => onOrdenar(null)}>
            ✕ {t("Remove sort", "Quitar orden")}
          </button>
        )}
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
 * Clicking a column header opens one menu with both sorting and an Excel-style value
 * checklist filter (D-275); optionally supports row selection (bulk actions) and
 * custom columns. */
export function OrdersTable({
  rows,
  onOpen,
  empty = "No orders here.",
  visible = DEFAULT_COLUMNS,
  orden,
  selectable = false,
  selected,
  onToggle,
  onToggleAll,
  isUrgent,
  resizeKey = "orders",
  collapsible = false,
  porTienda = false,
  tiendasPrimero,
  anchos,
  onAnchos,
}: {
  rows: Delivery[];
  onOpen: (d: Delivery) => void;
  empty?: string;
  visible?: string[];
  /** El orden de columnas que eligió la persona (todas las claves, visibles o no). Sin él, el canónico. */
  orden?: readonly string[] | null;
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
  /** Agrupa las filas por tienda, con un encabezado y su cuenta por grupo (D-310). Es el orden de
   * ENTRADA: en cuanto la persona ordena por una columna, manda su orden y los encabezados se van,
   * porque un encabezado de tienda sobre filas ordenadas por fecha mentiría. Los filtros de columna
   * se aplican antes, así que cada cuenta es la de lo que se ve. */
  porTienda?: boolean;
  /** Con `porTienda`: las tiendas de quien mira; sus grupos salen primero (D-338). */
  tiendasPrimero?: readonly string[];
  /** El ancho de las columnas de ESTA persona, leído de la base, y el aviso al soltar para guardarlo (D-338). */
  anchos?: Record<string, number> | null;
  onAnchos?: (anchos: Record<string, number>) => void;
}) {
  const { lang, t } = usePrefs();
  const { me, settings } = useData();
  // Which rows the driver has opened. Collapsed is the default, so this only
  // ever holds the handful they're actively looking at.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const colw = useColWidthMap(`rtg_colw_${resizeKey}`, 150, { deLaPersona: anchos, alCambiar: onAnchos, minimo: ANCHO_MINIMO });
  // Drivers read the invoice number off the paperwork; everyone else works
  // from the order code. Driven by the VIEWER's role, so it follows the
  // person across the driver view and the orders board alike.
  // The invoice is what everyone actually quotes — the customer on the phone,
  // the warehouse on the paperwork, the driver at the tailgate. The order code
  // is still shown, just as the second line rather than the headline.
  const byInvoice = true;
  const ctx: Ctx = { lang, t, byInvoice, motivos: motivosDeAnulacion(settings) };
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  // The filter menu renders in a portal (see below) so a short table with
  // few rows can't clip it — .tbl-scroll's horizontal scrollbar makes it
  // clip vertical overflow too, which used to hide the menu almost
  // entirely. Portaling needs the header cell's on-screen position.
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  // The whole header cell (name + ▾) of each column: the menu anchors to it, and it counts as
  // "inside" the open menu, so clicking it again closes the menu instead of reopening it.
  const celdaRefs = useRef(new Map<string, HTMLDivElement>());
  const menuRef = useRef<HTMLDivElement>(null);

  const cols = useMemo(() => {
    // Relabel the first column when it holds an invoice — a header reading
    // "ID" over an invoice number is worse than no header at all.
    // Just "#" — the value itself already says whether it's an invoice or an
    // SO, and the word was eating the width the number needs.
    const idCol = byInvoice ? { ...ID_COLUMN, en: "#", es: "#" } : ID_COLUMN;
    // La `#` va SIEMPRE primera y no se mueve. Las demás, las visibles, en el orden de la persona (D-332); sin orden
    // elegido, el canónico — el de `ORDER_COLUMNS` —, como siempre.
    const enOrden = columnasEnOrden(visible, ordenEfectivo(ORDER_COLUMNS.map((c) => c.key), orden));
    return [idCol, ...enOrden.map((k) => ORDER_COLUMNS.find((c) => c.key === k)!)];
  }, [visible, orden, byInvoice]);

  const openFilterMenu = (key: string) => {
    if (openFilter === key) { setOpenFilter(null); return; }
    const celda = celdaRefs.current.get(key);
    if (celda) setMenuAnchor(celda.getBoundingClientRect());
    setOpenFilter(key);
  };

  // Keep the menu pinned to its header cell while scrolling/resizing.
  useEffect(() => {
    if (!openFilter) return;
    const reposition = () => {
      const celda = celdaRefs.current.get(openFilter);
      if (celda) setMenuAnchor(celda.getBoundingClientRect());
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [openFilter]);

  // A click outside or Escape closes it (D-275). The menu is portaled out of the header, so
  // "outside" is checked by hand: the menu itself and the open column's header cell are inside.
  useCierraAlSalir(!!openFilter, () => setOpenFilter(null), () => [
    menuRef.current,
    openFilter ? celdaRefs.current.get(openFilter) : null,
  ]);

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

  // Un solo grupo sin nombre cuando no se agrupa: el cuerpo de la tabla se pinta igual en los dos casos.
  const agrupada = porTienda && !sortKey;
  const grupos = useMemo(
    () => (agrupada ? gruposPorTienda(sortedRows, tiendasPrimero) : [{ tienda: "", filas: sortedRows }]),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la lista llega nueva en cada render; lo que cuenta es su contenido
    [agrupada, sortedRows, (tiendasPrimero ?? []).join("|")],
  );

  if (!rows.length) return <div className="empty">{empty}</div>;

  // Sorting is chosen in the header menu: ascending, descending, or none. Choosing closes it.
  const ordenar = (key: string, dir: "asc" | "desc" | null) => {
    setSortKey(dir ? key : null);
    setSortDir(dir);
    setOpenFilter(null);
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

  // Qué filtros hay puestos, en el orden de las columnas (D-297). Se queda vacío casi siempre, y
  // entonces la barra no se pinta: una barra que sale siempre deja de leerse.
  const filtradas = columnasFiltradas(filters, cols.map((c) => c.key));
  const nombresFiltrados = filtradas.map((k) => {
    const col = cols.find((c) => c.key === k);
    return col ? (lang === "es" ? col.es : col.en) : k;
  });

  return (
    <>
    {/* Que se vea que hay un filtro puesto, y quitarlo de una (D-297). Lo pidió almacén: el filtro
        funcionaba, pero lo único que lo delataba era el ▾ de su cabecera en color, y en una tabla
        que se desplaza a lo ancho esa columna puede ni estar en pantalla. Se nombran las columnas
        filtradas, no solo cuántas, para saber dónde ir si se quiere ajustar en vez de limpiar. */}
    {filtradas.length > 0 && (
      <div className="filtros-puestos">
        <span>
          🔎 <b>{t("Filtered by", "Filtrado por")}:</b>{" "}
          {textoDeColumnas(nombresFiltrados, t("and", "y"), (n) => t(`${n} more`, `${n} más`))}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setFilters({})}
          title={t("Remove every column filter on this table", "Quitar todos los filtros de columna de esta tabla")}
        >✕ {t("Clear filters", "Limpiar filtros")}</button>
      </div>
    )}
    <div className="tbl-scroll tbl-fit orders-scroll">
      <table className="orders tbl-resize orders-responsive" style={anchoDeTabla([selectable ? 34 : 0, ...cols.map((c) => colw.widthOf(c.key))])}>
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
                  {/* The name and the ▾ open the same menu, with sorting and the filter (D-275).
                      The name used to sort straight away, and the filter was only the small ▾ next to it. */}
                  <div
                    className="th-cell"
                    ref={(el) => { if (el) celdaRefs.current.set(c.key, el); else celdaRefs.current.delete(c.key); }}
                  >
                    <button
                      className="th-sort"
                      onClick={(e) => { e.stopPropagation(); openFilterMenu(c.key); }}
                      title={t("Sort and filter", "Ordenar y filtrar")}
                    >
                      {lang === "es" ? c.es : c.en}
                      {sortKey === c.key && (sortDir === "asc" ? " ▲" : " ▼")}
                    </button>
                    <button
                      className={"th-filter-btn " + (hasFilter ? "on" : "")}
                      onClick={(e) => { e.stopPropagation(); openFilterMenu(c.key); }}
                      title={t("Sort and filter", "Ordenar y filtrar")}
                    >
                      ▾
                    </button>
                  </div>
                  {/* Drag to resize; double-click to reset this column. */}
                  <span className="col-resizer" title={t("Drag to change the width; double-click to reset", "Arrastra para cambiar el ancho; doble clic para restablecer")} onMouseDown={colw.startResize(c.key)} onDoubleClick={() => colw.resetCol(c.key)} />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr><td colSpan={cols.length + (selectable ? 1 : 0)} className="empty">{t("No rows match the current filters.", "Ninguna fila coincide con los filtros actuales.")}</td></tr>
          ) : grupos.flatMap((g) => [
            agrupada && (
              <tr key={"tienda:" + g.tienda} className="grupo-tienda">
                <td colSpan={cols.length + (selectable ? 1 : 0)}>{g.tienda || t("No store", "Sin tienda")} <span className="cnt">{g.filas.length}</span></td>
              </tr>
            ),
            ...g.filas.map((d) => (
            <tr
              key={d.id}
              className={"clickable"
                + (isUrgent?.(d) ? " row-urgent" : "")
                // `con-casilla` = esta fila lleva casilla de selección. Lo usa la tarjeta del
                // teléfono para anclarla en la primera línea (D-298) y reservarle ese hueco solo
                // donde la hay: la vista del chofer no tiene casillas y no debe perder ancho.
                + (selectable ? " con-casilla" : "")
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
            )),
          ])}
        </tbody>
      </table>
    </div>
    {openFilter && menuAnchor && createPortal(
      (() => {
        const col = cols.find((c) => c.key === openFilter);
        if (!col) return null;
        return (
          <ColumnFilterMenu
            menuRef={menuRef}
            col={col}
            options={optionsFor(col)}
            active={filters[openFilter]}
            orden={sortKey === openFilter ? sortDir : null}
            onOrdenar={(dir) => ordenar(openFilter, dir)}
            lang={lang}
            t={t}
            style={posicionDelMenu(menuAnchor, { ancho: window.innerWidth, alto: window.innerHeight })}
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
