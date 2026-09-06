"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/erp/ui/button";
import { money } from "@/lib/erp/utils";
import { statusLabel } from "@/lib/erp/status";
import { parseCsv, guessColumn } from "@/lib/erp/csv";
import { matchPoLines, createPoDrafts, type PoLine, type PoMatch } from "@/lib/erp/actions";
import { usePrefs } from "@/lib/prefs";

// G-10 (D-204): texto de pantalla por pares inline (usePrefs). Los tipos de producto son un
// enumerado fijo y su etiqueta sale de statusLabel (status.ts); el valor que se guarda no cambia.
const PRODUCT_TYPES = ["tile", "trim", "setting_material", "tool", "accessory", "other"];
type T = (en: string, es: string) => string;
const fields = (t: T): { key: keyof Mapping; label: string }[] => [
  { key: "mpn", label: t("MPN / item code", "MPN / código de artículo") },
  { key: "name", label: t("Description / name", "Descripción / nombre") },
  { key: "size", label: t("Size", "Tamaño") },
  { key: "cost", label: t("Unit cost", "Costo unitario") },
  { key: "qty", label: t("Qty", "Cant.") },
];
type Mapping = { mpn: number; name: number; size: number; cost: number; qty: number };
const sel = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500";

export function PoUpload({ vendors }: { vendors: { id: number; name: string }[] }) {
  const router = useRouter();
  const { t } = usePrefs();
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({ mpn: -1, name: -1, size: -1, cost: -1, qty: -1 });
  const [vendorId, setVendorId] = useState("");
  const [productType, setProductType] = useState("tile");
  const [matched, setMatched] = useState<PoMatch[] | null>(null);
  const [unmatched, setUnmatched] = useState<PoLine[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null);
    setResult(null);
    setMatched(null);
    setUnmatched(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return setErr(t("CSV needs a header row plus at least one data row.", "El CSV necesita una fila de cabecera y al menos una de datos."));
    const hdr = rows[0];
    setHeaders(hdr);
    setDataRows(rows.slice(1));
    setMapping({
      mpn: guessColumn(hdr, ["mpn", "item", "part", "code", "sku"]),
      name: guessColumn(hdr, ["desc", "name", "product"]),
      size: guessColumn(hdr, ["size", "dimension"]),
      cost: guessColumn(hdr, ["cost", "unit price", "price", "unit"]),
      qty: guessColumn(hdr, ["qty", "quantity", "count"]),
    });
  }

  function buildLines(): PoLine[] {
    const g = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    return dataRows
      .map((r) => ({ mpn: g(r, mapping.mpn), name: g(r, mapping.name), size: g(r, mapping.size), cost: g(r, mapping.cost), qty: g(r, mapping.qty) }))
      .filter((l) => (l.mpn || l.name).length > 0);
  }

  function runMatch() {
    setErr(null);
    setResult(null);
    if (mapping.mpn < 0 && mapping.name < 0) return setErr(t("Map at least the MPN or Description column.", "Asigna al menos la columna MPN o Descripción."));
    const lines = buildLines();
    if (lines.length === 0) return setErr(t("No usable lines found.", "No se encontraron líneas utilizables."));
    startTransition(async () => {
      const res = await matchPoLines(lines);
      setMatched(res.matched);
      setUnmatched(res.unmatched);
    });
  }

  function createDrafts() {
    if (!unmatched || unmatched.length === 0) return;
    setErr(null);
    startTransition(async () => {
      const res = await createPoDrafts(vendorId ? Number(vendorId) : null, productType, unmatched);
      if (!res.ok) setErr(res.error);
      else {
        setResult(t(`Created ${res.count} draft product(s) — flagged "PO IMPORT" in the review queue.`, `Creados ${res.count} producto(s) en borrador — marcados "PO IMPORT" en la cola de revisión.`));
        setUnmatched([]);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
          <label className="flex items-center gap-1 text-sm text-slate-600">
            {t("Vendor", "Proveedor")}
            <select className={sel} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">—</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-sm text-slate-600">
            {t("Default type", "Tipo por defecto")}
            <select className={sel} value={productType} onChange={(e) => setProductType(e.target.value)}>
              {PRODUCT_TYPES.map((pt) => (
                <option key={pt} value={pt}>{t(statusLabel(pt).en, statusLabel(pt).es)}</option>
              ))}
            </select>
          </label>
        </div>

        {headers.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-sm font-medium">{t("Map columns", "Asignar columnas")} ({dataRows.length} {t("rows", "filas")})</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {fields(t).map((f) => (
                <label key={f.key} className="space-y-1">
                  <span className="text-xs text-slate-500">{f.label}</span>
                  <select
                    className={`${sel} w-full`}
                    value={mapping[f.key]}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}
                  >
                    <option value={-1}>{t("— none —", "— ninguna —")}</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>{h || `${t("col", "col")} ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <Button className="mt-3" onClick={runMatch} disabled={pending}>
              {pending ? t("Matching…", "Casando…") : t("Match lines", "Casar líneas")}
            </Button>
          </div>
        )}
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        {result && <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{result}</p>}
      </div>

      {matched && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">{t("Matched", "Casadas")} ({matched.length})</h2>
          {matched.length === 0 ? (
            <p className="text-sm text-slate-500">{t("No lines matched existing products.", "Ninguna línea casó con productos existentes.")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1 pr-4 font-medium">{t("PO line", "Línea de OC")}</th>
                  <th className="py-1 pr-4 font-medium">{t("Matched product", "Producto casado")}</th>
                  <th className="py-1 pr-4 text-right font-medium">{t("PO cost", "Costo OC")}</th>
                  <th className="py-1 pr-4 text-right font-medium">{t("Current cost", "Costo actual")}</th>
                </tr>
              </thead>
              <tbody>
                {matched.map((m, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1 pr-4">
                      {m.line.name || m.line.mpn}
                      {m.line.mpn && <span className="ml-1 font-mono text-xs text-slate-400">{m.line.mpn}</span>}
                    </td>
                    <td className="py-1 pr-4">
                      <span className="font-mono text-xs text-slate-500">{m.product.sku}</span> — {m.product.name}
                    </td>
                    <td className="py-1 pr-4 text-right tabular-nums">{money(m.line.cost ? Number(m.line.cost) : null)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums text-slate-500">{money(m.product.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {unmatched && unmatched.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("Unmatched", "Sin casar")} ({unmatched.length}) → {t("new drafts", "nuevos borradores")}</h2>
            <Button onClick={createDrafts} disabled={pending}>
              {pending ? t("Creating…", "Creando…") : t(`Create ${unmatched.length} draft(s)`, `Crear ${unmatched.length} borrador(es)`)}
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 pr-4 font-medium">{t("Name", "Nombre")}</th>
                <th className="py-1 pr-4 font-medium">MPN</th>
                <th className="py-1 pr-4 font-medium">{t("Size", "Tamaño")}</th>
                <th className="py-1 pr-4 text-right font-medium">{t("Cost", "Costo")}</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((l, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 pr-4">{l.name || "—"}</td>
                  <td className="py-1 pr-4 font-mono text-xs text-slate-500">{l.mpn || "—"}</td>
                  <td className="py-1 pr-4">{l.size || "—"}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{money(l.cost ? Number(l.cost) : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
