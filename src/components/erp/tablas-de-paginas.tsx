"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { rotulo } from "@/components/erp/rotulo";
import { cn, money } from "@/lib/erp/utils";

/**
 * Las tablas de las páginas SERVIDOR del ERP con el estándar de columnas de Órdenes (D-1022,
 * docs/ESTANDAR-DE-TABLAS.md). La consulta y los permisos se quedan en la página (servidor); aquí solo va la tabla:
 * las columnas llevan funciones (`valor`, `celda`) y eso no cruza del servidor al cliente, así que cada página le pasa
 * sus FILAS ya leídas a su tabla de cliente.
 */
const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

export interface FilaDeAnalitica {
  /** Categoría o proveedor. */
  nombre: string;
  clave: string;
  /** A dónde lleva el nombre (categorías L1 → L2). Sin esto, texto. */
  href?: string;
  net_sales: number; units: number; gm: number; margin_pct: number | null;
  product_count: number; inventory_value: number; avg_margin_pct: number | null;
  below_cost: number; needs_review: number;
}

/** Analítica por categoría y por proveedor: las mismas diez columnas. */
export function TablaDeAnalitica({ id, filas, de }: { id: string; filas: FilaDeAnalitica[]; de: "categoria" | "proveedor" }) {
  const { t } = usePrefs();
  const columnas = useMemo<ColumnaEstandar<FilaDeAnalitica>[]>(() => [
    { key: "nombre", ...rotulo(de === "categoria" ? t("Category", "Categoría") : t("Vendor", "Proveedor")), ancho: 240, fija: true, valor: (r) => r.nombre,
      celda: (r) => r.href ? <Link href={r.href} className="font-medium text-clay-700 hover:underline">{r.nombre}</Link> : <span className="font-medium">{r.nombre}</span> },
    { key: "net_sales", ...rotulo(t("Net sales", "Ventas netas")), ancho: 130, numerico: true, valor: (r) => r.net_sales, celda: (r) => money(r.net_sales) },
    { key: "units", ...rotulo(t("Units", "Unidades")), ancho: 100, numerico: true, valor: (r) => r.units, celda: (r) => r.units.toLocaleString() },
    { key: "gm", ...rotulo(t("GM", "GM")), ancho: 120, numerico: true, valor: (r) => r.gm, celda: (r) => money(r.gm) },
    { key: "margin_pct", ...rotulo(t("Sales margin", "Margen de ventas")), ancho: 130, numerico: true, valor: (r) => r.margin_pct, celda: (r) => pct(r.margin_pct) },
    { key: "product_count", ...rotulo(t("Products", "Productos")), ancho: 110, numerico: true, valor: (r) => r.product_count, celda: (r) => r.product_count.toLocaleString() },
    { key: "inventory_value", ...rotulo(t("Inv. value", "Valor inv.")), ancho: 130, numerico: true, valor: (r) => r.inventory_value, celda: (r) => money(r.inventory_value) },
    { key: "avg_margin_pct", ...rotulo(t("List margin", "Margen de lista")), ancho: 130, numerico: true, valor: (r) => r.avg_margin_pct, celda: (r) => pct(r.avg_margin_pct) },
    { key: "below_cost", ...rotulo(t("Below cost", "Bajo costo")), ancho: 110, numerico: true, valor: (r) => r.below_cost,
      celda: (r) => <span className={r.below_cost > 0 ? "text-red-600" : "text-slate-400"}>{r.below_cost}</span> },
    { key: "needs_review", ...rotulo(t("Needs review", "Requiere revisión")), ancho: 140, numerico: true, valor: (r) => r.needs_review,
      celda: (r) => <span className={r.needs_review > 0 ? "text-amber-700" : "text-slate-400"}>{r.needs_review}</span> },
  ], [de, t]);
  return (
    <TablaEstandar id={id} filas={filas} claveDe={(r) => r.clave} columnas={columnas} sinCaja
      vacio={de === "categoria" ? t("No category data.", "Sin datos de categorías.") : t("No vendor data.", "Sin datos de proveedores.")} />
  );
}

export interface FilaDeOc {
  id: number; po_number: string; vendor_name: string | null; po_date: string | null; status: string;
  total: number | null; po_line_count: number; ack_count: number; ack_document_no: string | null; ack_date: string | null;
  merch_gap: number | null; flagged_lines: number; has_discrepancies: boolean;
}

const estiloDeEstado: Record<string, string> = {
  draft: "border-slate-200 bg-slate-100 text-slate-600",
  sent: "border-sky-200 bg-sky-50 text-sky-700",
  acknowledged: "border-clay-200 bg-clay-50 text-clay-700",
  partial: "border-amber-200 bg-amber-50 text-amber-700",
  received: "border-emerald-200 bg-emerald-50 text-emerald-700",
  closed: "border-slate-200 bg-slate-100 text-slate-500",
};

/** Órdenes de compra y su proforma. La fila con discrepancias sigue en rojo. */
export function TablaDeOrdenesDeCompra({ filas }: { filas: FilaDeOc[] }) {
  const { t } = usePrefs();
  const columnas = useMemo<ColumnaEstandar<FilaDeOc>[]>(() => [
    { key: "po_number", ...rotulo(t("PO #", "OC #")), ancho: 150, fija: true, valor: (o) => o.po_number, envuelve: true,
      celda: (o) => <>
        <Link href={`/erp/purchasing/orders/${o.id}`} className="font-medium text-clay-700 hover:underline">{o.po_number}</Link>
        <div className="text-xs text-slate-400">{o.po_line_count} {o.po_line_count === 1 ? t("line", "línea") : t("lines", "líneas")}</div>
      </> },
    { key: "vendor", ...rotulo(t("Vendor", "Proveedor")), ancho: 200, valor: (o) => o.vendor_name },
    { key: "po_date", ...rotulo(t("PO date", "Fecha de OC")), ancho: 120, valor: (o) => o.po_date },
    { key: "status", ...rotulo(t("Status", "Estado")), ancho: 130, valor: (o) => o.status,
      celda: (o) => <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", estiloDeEstado[o.status] ?? estiloDeEstado.draft)}>{o.status}</span> },
    { key: "total", ...rotulo(t("PO total", "Total de OC")), ancho: 130, numerico: true, valor: (o) => o.total, celda: (o) => money(o.total) },
    { key: "proforma", ...rotulo(t("Proforma", "Proforma")), ancho: 160, valor: (o) => o.ack_document_no, envuelve: true,
      celda: (o) => o.ack_document_no
        ? <><span className="font-mono text-xs">{o.ack_document_no}</span><div className="text-xs text-slate-400">{o.ack_date ?? "—"}</div></>
        : <span className="text-xs text-slate-400">{t("— none —", "— ninguna —")}</span> },
    { key: "gap", ...rotulo(t("Gap", "Diferencia")), ancho: 120, numerico: true, valor: (o) => o.merch_gap,
      celda: (o) => <span title={t("merchandise vs PO (excl. tax & freight)", "mercancía contra la OC (sin impuestos ni flete)")}
        className={o.merch_gap != null && Math.abs(o.merch_gap) >= 0.005 ? "font-medium text-red-600" : "text-slate-400"}>
        {o.merch_gap == null ? "—" : `${o.merch_gap > 0 ? "+" : ""}${money(o.merch_gap)}`}</span> },
    { key: "discrepancias", ...rotulo(t("Discrepancies", "Discrepancias")), ancho: 170, valor: (o) => (o.has_discrepancies ? o.flagged_lines : o.ack_count > 0 ? 0 : null),
      celda: (o) => o.has_discrepancies
        ? <Link href={`/erp/purchasing/orders/${o.id}`} className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100">⚑ {o.flagged_lines} {t("flagged", "marcadas")}</Link>
        : o.ack_count > 0 ? <span className="text-xs text-emerald-600">✓ {t("clean", "limpia")}</span>
        : <span className="text-xs text-slate-400">{t("awaiting proforma", "esperando proforma")}</span> },
  ], [t]);
  return <TablaEstandar id="erp-ordenes-de-compra" filas={filas} claveDe={(o) => String(o.id)} columnas={columnas} sinCaja
    claseDeFila={(o) => (o.has_discrepancies ? "bg-red-50/40" : undefined)} />;
}

export interface FilaDeDaltile {
  id: number; product_id: number; nombre: string; sku: string | null; mpn: string | null;
  /** Las acciones de servidor (o el aviso del demo) ya decididas por la página. */
  confirmar: React.ComponentProps<"form">["action"]; rechazar: React.ComponentProps<"form">["action"];
  external_sku: string | null; external_url: string | null; external_title: string | null;
  series_name: string | null; nominal_size: string | null; match_method: string | null; match_confidence: number | null;
}

/** Revisión de coincidencias Daltile: confirmar / rechazar siguen siendo las acciones de servidor de siempre. */
export function TablaDeDaltile({ id, filas }: { id: string; filas: FilaDeDaltile[] }) {
  const { t } = usePrefs();
  const columnas = useMemo<ColumnaEstandar<FilaDeDaltile>[]>(() => [
    { key: "producto", ...rotulo(t("ERP product", "Producto ERP")), ancho: 300, fija: true, envuelve: true, valor: (r) => r.nombre,
      celda: (r) => <>
        <Link href={`/erp/product/${r.product_id}`} className="font-medium text-clay-600 hover:underline">{r.nombre}</Link>
        <div className="font-mono text-xs text-slate-400">{r.sku}{r.mpn ? ` · mpn ${r.mpn}` : ` · ${t("no mpn", "sin mpn")}`}</div>
      </> },
    { key: "daltile", ...rotulo(t("→ Daltile", "→ Daltile")), ancho: 300, envuelve: true, valor: (r) => r.external_title,
      celda: (r) => <>
        <div className="font-medium">{r.external_title ?? "—"}</div>
        <div className="text-xs text-slate-500">{[r.series_name, r.nominal_size].filter(Boolean).join(" · ")}</div>
        {r.external_url && <a href={r.external_url} target="_blank" rel="noopener nofollow" className="text-xs text-clay-600 hover:underline">daltile.com ↗</a>}
      </> },
    { key: "metodo", ...rotulo(t("Method", "Método")), ancho: 150, valor: (r) => r.match_method },
    { key: "codigo", ...rotulo(t("Code", "Código")), ancho: 130, valor: (r) => r.external_sku },
    { key: "confianza", ...rotulo(t("Confidence", "Confianza")), ancho: 110, numerico: true, valor: (r) => (r.match_confidence == null ? null : Math.round(r.match_confidence * 100)),
      celda: (r) => (r.match_confidence == null ? "—" : `${Math.round(r.match_confidence * 100)}%`) },
  ], [t]);
  return (
    <TablaEstandar id={id} filas={filas} claveDe={(r) => String(r.id)} columnas={columnas} sinCaja anchoDeAcciones={190}
      acciones={(r) => (
        <div className="flex justify-end gap-2">
          <form action={r.confirmar}>
            <button className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700">{t("Confirm", "Confirmar")}</button>
          </form>
          <form action={r.rechazar}>
            <button className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">{t("Reject", "Rechazar")}</button>
          </form>
        </div>
      )} />
  );
}
