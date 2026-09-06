"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/erp/utils";
import { Button } from "@/components/erp/ui/button";
import { parseCsv, guessColumn } from "@/lib/erp/csv";
import { parseDocument, type ParsedDoc } from "@/lib/erp/domain/po-parse";
import { logPurchaseOrder, logAcknowledgment, parsePdfUpload } from "@/lib/erp/actions";
import { usePrefs } from "@/lib/prefs";

type DocType = "po" | "ack";
type Field = { key: string; label: string; kind?: "text" | "number" | "date" | "status" | "vendor"; wide?: boolean; required?: boolean };
type Row = Record<string, string>;
type Vendor = { id: number; name: string };
type T = (en: string, es: string) => string;

// G-10 (D-NEXT): texto de pantalla por pares inline (usePrefs). Las definiciones de campo pasan de
// constantes a funciones con t(): la `key` es la que viaja al servidor y no cambia; solo la etiqueta.
// Los estados del pedido (draft/sent/…) son valores guardados y se enseñan tal cual.
const poHeader = (t: T): Field[] => [
  { key: "po_number", label: t("PO number", "Número de OC"), required: true },
  { key: "vendor_id", label: t("Vendor", "Proveedor"), kind: "vendor", required: true },
  { key: "po_date", label: t("PO date", "Fecha de OC"), kind: "date" },
  { key: "buyer_user", label: t("Buyer", "Comprador") },
  { key: "currency", label: t("Currency", "Moneda") },
  { key: "status", label: t("Status", "Estado"), kind: "status" },
  { key: "ship_to_name", label: t("Ship to", "Enviar a"), wide: true },
  { key: "total", label: t("PO total", "Total de OC"), kind: "number" },
];
const poCols = (t: T): Field[] => [
  { key: "vendor_item_no", label: "MPN" },
  { key: "description", label: t("Description", "Descripción"), wide: true },
  { key: "qty", label: t("Qty", "Cant."), kind: "number" },
  { key: "uom", label: t("UoM", "UdM") },
  { key: "unit_rate", label: t("Rate", "Tarifa"), kind: "number" },
  { key: "amount", label: t("Amount", "Importe"), kind: "number" },
];
const ackHeader = (t: T): Field[] => [
  { key: "ack_document_no", label: t("Document no.", "N.º de documento"), required: true },
  { key: "po_number", label: t("Links to PO #", "Enlaza con OC #"), required: true },
  { key: "vendor_id", label: t("Vendor", "Proveedor"), kind: "vendor" },
  { key: "ack_date", label: t("Ack date", "Fecha de confirmación"), kind: "date" },
  { key: "currency", label: t("Currency", "Moneda") },
  { key: "incoterm", label: "Incoterm" },
  { key: "payment_terms", label: t("Payment terms", "Condiciones de pago") },
  { key: "salesperson", label: t("Salesperson", "Vendedor"), wide: true },
  { key: "merchandise_value", label: t("Merchandise", "Mercancía"), kind: "number" },
  { key: "freight", label: t("Freight", "Flete"), kind: "number" },
  { key: "iva_pct", label: "IVA %", kind: "number" },
  { key: "total", label: "Total", kind: "number" },
];
const ackCols = (t: T): Field[] => [
  { key: "item_no", label: "MPN" },
  { key: "description", label: t("Description", "Descripción"), wide: true },
  { key: "uom", label: t("UoM", "UdM") },
  { key: "quantity", label: t("Qty", "Cant."), kind: "number" },
  { key: "unit_price", label: t("Unit price", "Precio unitario"), kind: "number" },
  { key: "amount", label: t("Amount", "Importe"), kind: "number" },
  { key: "boxes", label: t("Boxes", "Cajas"), kind: "number" },
  { key: "pallets", label: t("Pallets", "Tarimas"), kind: "number" },
];
const STATUSES = ["draft", "sent", "acknowledged", "partial", "received", "closed"];
const CSV_SYNONYMS: Record<string, string[]> = {
  vendor_item_no: ["mpn", "item", "vendor", "part", "code", "sku"],
  item_no: ["mpn", "item", "part", "code", "sku"],
  description: ["desc", "name", "product"],
  qty: ["qty", "quantity", "count", "box"],
  quantity: ["qty", "quantity", "pi2", "sqft", "sf"],
  uom: ["uom", "u/m", "unit", "um"],
  unit_rate: ["rate", "unit price", "price", "cost"],
  unit_price: ["price", "rate", "unit"],
  amount: ["amount", "total", "ext"],
  boxes: ["box"],
  pallets: ["pallet"],
};

const inp =
  "h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500";
const s = (v: unknown) => (v == null ? "" : String(v));
const blankLine = (cols: Field[]): Row => Object.fromEntries(cols.map((c) => [c.key, ""]));

export function PoIngest({ vendors }: { vendors: Vendor[] }) {
  const { t } = usePrefs();
  const PO_HEADER = poHeader(t), PO_COLS = poCols(t), ACK_HEADER = ackHeader(t), ACK_COLS = ackCols(t);
  const [docType, setDocType] = useState<DocType>("po");
  const [text, setText] = useState("");
  const [header, setHeader] = useState<Row>({ currency: "USD", status: "sent" });
  const [lines, setLines] = useState<Row[]>(() => [blankLine(poCols(t))]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [pdfPath, setPdfPath] = useState<string | null>(null); // stored original (source_pdf_ref) from a PDF drop
  const [pending, startTransition] = useTransition();

  const headerFields = docType === "po" ? PO_HEADER : ACK_HEADER;
  const lineCols = docType === "po" ? PO_COLS : ACK_COLS;

  function guessVendorId(name: string | null): string {
    if (!name) return "";
    const first = name.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/)[0];
    const hit = vendors.find((v) => first && v.name.toLowerCase().includes(first));
    return hit ? String(hit.id) : "";
  }

  function switchType(kind: DocType) {
    setDocType(kind);
    setResult(null);
    setErr(null);
    setHeader({ currency: "USD", ...(kind === "po" ? { status: "sent" } : {}) });
    setLines([blankLine(kind === "po" ? PO_COLS : ACK_COLS)]);
    setWarnings([]);
    setPdfPath(null);
  }

  function applyParsed(doc: ParsedDoc) {
    setDocType(doc.kind);
    const mapLines = (ls: Record<string, unknown>[]) =>
      ls.map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, s(v)])));
    if (doc.kind === "po") {
      const h = doc.header;
      setHeader({
        po_number: s(h.po_number), vendor_id: guessVendorId(h.vendor_name), po_date: s(h.po_date),
        buyer_user: s(h.buyer_user), currency: s(h.currency) || "USD", status: "sent",
        ship_to_name: s(h.ship_to_name), total: s(h.total),
      });
    } else {
      const h = doc.header;
      setHeader({
        ack_document_no: s(h.ack_document_no), po_number: s(h.po_number), vendor_id: guessVendorId(h.vendor_name),
        ack_date: s(h.ack_date), currency: s(h.currency) || "USD", incoterm: s(h.incoterm),
        payment_terms: s(h.payment_terms), salesperson: s(h.salesperson), order_type: s(h.order_type),
        customer_no: s(h.customer_no), ship_to_address: s(h.ship_to_address), merchandise_value: s(h.merchandise_value),
        handling: s(h.handling), handling_bonus: s(h.handling_bonus), freight: s(h.freight), subtotal: s(h.subtotal),
        iva_pct: s(h.iva_pct), total: s(h.total), special_instructions: s(h.special_instructions),
      });
    }
    setLines(mapLines(doc.lines));
    setWarnings(doc.warnings);
  }

  function onParse() {
    setErr(null);
    setResult(null);
    const doc = parseDocument(text);
    if (!doc) {
      setErr(t("Couldn't recognize this document. Drag the PDF, paste `pdftotext -layout` output, import a CSV, or fill it in manually below.", "No se reconoció este documento. Arrastra el PDF, pega la salida de `pdftotext -layout`, importa un CSV o rellénalo a mano abajo."));
      return;
    }
    setPdfPath(null); // pasted text isn't the stored PDF
    applyParsed(doc);
  }

  async function onPdf(file: File | null | undefined) {
    if (!file) return;
    setErr(null);
    setResult(null);
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await parsePdfUpload(fd);
      if (!res.ok) setErr(res.error);
      else {
        applyParsed(res.doc);
        setText("");
        setPdfPath(res.storagePath);
        // The parse itself is fine; only the archived copy failed. Say so, rather than let the
        // manager believe the original was kept when it was not.
        const note = res.storageNote;
        if (note) {
          setWarnings((w) => [
            ...w,
            t(`The original PDF was not archived (${note}). The parsed data below is still correct, but the order will save without an attached document.`, `El PDF original no se archivó (${note}). Los datos leídos abajo siguen siendo correctos, pero el pedido se guardará sin documento adjunto.`),
          ]);
        }
      }
    } catch {
      setErr(t("Couldn't read that PDF. Try paste / CSV / manual.", "No se pudo leer ese PDF. Prueba pegar texto, CSV o a mano."));
    } finally {
      setParsing(false);
    }
  }

  async function onCsv(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (rows.length < 2) { setErr(t("CSV needs a header row plus at least one data row.", "El CSV necesita una fila de cabecera y al menos una de datos.")); return; }
    const hdr = rows[0];
    const map = Object.fromEntries(lineCols.map((c) => [c.key, guessColumn(hdr, CSV_SYNONYMS[c.key] ?? [c.key])]));
    const mapped = rows.slice(1).map((r) =>
      Object.fromEntries(lineCols.map((c) => [c.key, map[c.key] >= 0 ? (r[map[c.key]] ?? "").trim() : ""]))
    );
    const usable = mapped.filter((l) => Object.values(l).some((v) => v !== ""));
    if (usable.length === 0) { setErr(t("No usable rows — check the CSV headers.", "No hay filas utilizables — revisa las cabeceras del CSV.")); return; }
    setLines(usable);
    e.target.value = "";
  }

  function onSubmit() {
    setErr(null);
    setResult(null);
    for (const f of headerFields) {
      if (f.required && !s(header[f.key]).trim()) { setErr(t(`${f.label} is required.`, `${f.label} es obligatorio.`)); return; }
    }
    const idKey = docType === "po" ? "vendor_item_no" : "item_no";
    const cleanLines = lines.filter((l) => Object.values(l).some((v) => s(v).trim() !== "")).filter((l) => s(l[idKey]).trim() || s(l.description).trim());
    if (cleanLines.length === 0) { setErr(t("Add at least one line item.", "Añade al menos una línea.")); return; }
    const headerToSend = pdfPath ? { ...header, source_pdf_ref: pdfPath } : header;
    startTransition(async () => {
      const res = docType === "po" ? await logPurchaseOrder(headerToSend, cleanLines) : await logAcknowledgment(headerToSend, cleanLines);
      if (!res.ok) setErr(res.error);
      else setResult(res.result);
    });
  }

  const setH = (k: string, v: string) => setHeader((p) => ({ ...p, [k]: v }));
  const setL = (i: number, k: string, v: string) => setLines((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const poId = result?.po_id as number | undefined;

  return (
    <div className="space-y-5">
      {/* Doc type tabs */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {(["po", "ack"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => switchType(kind)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm transition-colors",
              docType === kind ? "bg-clay-50 font-medium text-clay-700" : "text-slate-500 hover:text-slate-800"
            )}
          >
            {kind === "po" ? t("Purchase order", "Orden de compra") : t("Acknowledgment (proforma)", "Confirmación (proforma)")}
          </button>
        ))}
      </div>

      {/* Import */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-2 text-sm font-medium">{t("Import", "Importar")}</div>

        {/* Drag-and-drop PDF (parsed server-side via unpdf) */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onPdf(e.dataTransfer.files?.[0]); }}
          className={cn(
            "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors",
            dragOver ? "border-clay-400 bg-clay-50" : "border-slate-300 bg-slate-50"
          )}
        >
          <p className="text-sm font-medium text-slate-700">
            {parsing ? t("Reading PDF…", "Leyendo PDF…") : t("Drag a PO or acknowledgment PDF here", "Arrastra aquí el PDF de una OC o una confirmación")}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t("or", "o")}{" "}
            <label className="cursor-pointer font-medium text-clay-700 hover:underline">
              {t("browse", "examinar")}
              <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={parsing}
                onChange={(e) => { onPdf(e.target.files?.[0]); e.target.value = ""; }} />
            </label>{" "}
            {t("— auto-detects PO vs proforma. Everything is editable below before saving.", "— detecta sola si es OC o proforma. Todo se puede editar abajo antes de guardar.")}
          </p>
        </div>

        <div className="my-3 flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" /> {t("or paste text", "o pega el texto")} <span className="h-px flex-1 bg-slate-200" />
        </div>
        <p className="mb-2 text-xs text-slate-500">
          {t("Paste", "Pega")} <code className="rounded bg-slate-100 px-1 font-mono">pdftotext -layout file.pdf -</code> {t("output (or copy from your PDF viewer) and Parse, import a CSV of the line items, or just fill it in by hand.", "(o copia desde tu visor de PDF) y pulsa Leer, importa un CSV con las líneas, o rellénalo a mano.")}
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={t("Paste the PO / acknowledgment text here…", "Pega aquí el texto de la OC / confirmación…")}
          className="w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button onClick={onParse} disabled={!text.trim()}>{t("Parse", "Leer")}</Button>
          <label className="cursor-pointer text-sm text-clay-700 hover:underline">
            {t("Import line items from CSV", "Importar líneas desde CSV")}
            <input type="file" accept=".csv,text/csv" onChange={onCsv} className="hidden" />
          </label>
        </div>
        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
          </ul>
        )}
      </div>

      {/* Header fields */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-medium">{docType === "po" ? t("Purchase order header", "Cabecera de la orden de compra") : t("Acknowledgment header", "Cabecera de la confirmación")}</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {headerFields.map((f) => (
            <label key={f.key} className={cn("space-y-1", f.wide && "col-span-2")}>
              <span className="text-xs text-slate-500">
                {f.label}{f.required && <span className="text-red-500"> *</span>}
              </span>
              {f.kind === "vendor" ? (
                <select className={inp} value={header[f.key] ?? ""} onChange={(e) => setH(f.key, e.target.value)}>
                  <option value="">—</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              ) : f.kind === "status" ? (
                <select className={inp} value={header[f.key] ?? "sent"} onChange={(e) => setH(f.key, e.target.value)}>
                  {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              ) : (
                <input
                  className={inp}
                  type={f.kind === "date" ? "date" : "text"}
                  inputMode={f.kind === "number" ? "decimal" : undefined}
                  value={header[f.key] ?? ""}
                  onChange={(e) => setH(f.key, e.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Line items */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium">{t("Line items", "Líneas")} ({lines.length})</div>
          <button
            type="button"
            onClick={() => setLines((p) => [...p, blankLine(lineCols)])}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {t("+ Add line", "+ Añadir línea")}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                {lineCols.map((c) => <th key={c.key} className="px-2 py-1 font-medium">{c.label}</th>)}
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {lines.map((row, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {lineCols.map((c) => (
                    <td key={c.key} className={cn("px-1 py-1", c.wide ? "min-w-[14rem]" : "min-w-[5rem]")}>
                      <input
                        className={inp}
                        inputMode={c.kind === "number" ? "decimal" : undefined}
                        value={row[c.key] ?? ""}
                        onChange={(e) => setL(i, c.key, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                      className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={t("Remove line", "Quitar línea")}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {t("Lines are matched to catalog products by MPN (vendor SKU → product MPN). Unmatched lines are still saved and reported, so reconciliation never silently drops a line.", "Las líneas se casan con productos del catálogo por MPN (SKU del proveedor → MPN del producto). Las que no casan se guardan e informan igual, así la conciliación nunca pierde una línea en silencio.")}
        </p>
      </div>

      {/* Submit + result */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSubmit} disabled={pending}>
          {pending ? t("Saving…", "Guardando…") : docType === "po" ? t("Save purchase order", "Guardar orden de compra") : t("Save acknowledgment", "Guardar confirmación")}
        </Button>
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="font-semibold">{t("Saved.", "Guardado.")}</div>
          <div className="mt-1 space-y-0.5 text-emerald-700">
            <div>
              {docType === "po"
                ? t(`PO ${s(result.po_number)} — ${s(result.lines_inserted)} line(s), ${s(result.matched)} matched, ${s(result.unmatched)} unmatched.`, `OC ${s(result.po_number)} — ${s(result.lines_inserted)} línea(s), ${s(result.matched)} casadas, ${s(result.unmatched)} sin casar.`)
                : t(`Acknowledgment ${s(result.ack_document_no)} — ${s(result.lines_inserted)} line(s), ${s(result.matched_lines)} matched to PO line(s).`, `Confirmación ${s(result.ack_document_no)} — ${s(result.lines_inserted)} línea(s), ${s(result.matched_lines)} casadas con líneas de la OC.`)}
            </div>
            {Array.isArray(result.unmatched_mpns) && (result.unmatched_mpns as string[]).length > 0 && (
              <div className="text-amber-700">{t("Unmatched MPNs:", "MPN sin casar:")} {(result.unmatched_mpns as string[]).join(", ")}</div>
            )}
            {docType === "ack" && !result.po_id && (
              <div className="text-amber-700">{t("No PO matched this proforma's PO number — it won't reconcile until a PO with that number exists.", "Ninguna OC coincide con el número de OC de esta proforma — no se conciliará hasta que exista una OC con ese número.")}</div>
            )}
          </div>
          <div className="mt-3 flex gap-3">
            {poId != null && (
              <Link href={`/erp/purchasing/orders/${poId}`} className="rounded-md bg-clay-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-clay-700">
                {t("View reconciliation →", "Ver conciliación →")}
              </Link>
            )}
            <Link href="/erp/purchasing/orders" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
              {t("All orders", "Todos los pedidos")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
