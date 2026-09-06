"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/erp/ui/button";
import {
  applyMasterImport,
  previewMasterImport,
  type MasterImportResult,
  type MasterImportRow,
  type MasterRowResult,
} from "@/lib/erp/master/actions";
import { buildHeaderMap, importableKeys, KEY_FIELD, VERSION_COL } from "@/lib/erp/master/fields";
import { usePrefs } from "@/lib/prefs";

// G-10 (D-204): texto de pantalla por pares inline (usePrefs). Las acciones del resultado
// (preview/new_draft/applied/skip/stale/error) son valores del servidor: la clase se queda en un
// mapa y la etiqueta pasa a una función con t(). SKU, columnas reconocidas y motivos son dato.

// Normalize an ExcelJS cell value to a trimmed string (handles Date, rich text, formula results).
function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text?: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text ?? "").join("").trim();
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return String(o.result).trim();
    return "";
  }
  return String(v).trim();
}

const ACTION_CLS: Record<string, string> = {
  preview: "text-clay-700",
  new_draft: "text-sky-700",
  applied: "text-emerald-700",
  skip: "text-slate-400",
  stale: "text-amber-700",
  error: "text-red-600",
};
type T = (en: string, es: string) => string;
const actionLabel = (t: T, a: string): string => {
  if (a === "preview") return t("will update", "se actualizará");
  if (a === "new_draft") return t("new → draft", "nuevo → borrador");
  if (a === "applied") return t("applied", "aplicado");
  if (a === "skip") return t("no change", "sin cambio");
  if (a === "stale") return t("stale — quarantined", "desfasado — en cuarentena");
  if (a === "error") return t("invalid — quarantined", "inválido — en cuarentena");
  return a;
};
const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const selectable = (a: string) => a === "preview" || a === "new_draft";

function Chip({ label, n, cls }: { label: string; n: number; cls: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{n.toLocaleString()} {label}</span>;
}

function Diff({ r }: { r: MasterRowResult }) {
  if (r.reason && (!r.changes || r.changes.length === 0)) {
    return <span className={r.action === "error" ? "text-red-600" : "text-slate-500"}>{r.reason}</span>;
  }
  return (
    <span>
      {(r.changes ?? []).map((c, j) => (
        <span key={j} className="mr-3 inline-block whitespace-nowrap">
          <span className="text-slate-400">{c.field}</span> {fmt(c.from)} → <span className="font-medium">{fmt(c.to)}</span>
        </span>
      ))}
    </span>
  );
}

export function MasterRoundTrip() {
  const router = useRouter();
  const { t } = usePrefs();
  const [fileName, setFileName] = useState<string | null>(null);
  const [recognized, setRecognized] = useState<string[]>([]);
  const [parsed, setParsed] = useState<MasterImportRow[]>([]);
  const [preview, setPreview] = useState<MasterImportResult | null>(null);
  const [report, setReport] = useState<MasterImportResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setRecognized([]); setParsed([]); setPreview(null); setReport(null); setSelected(new Set()); setErr(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    reset();
    setFileName(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.getWorksheet("Products") ?? wb.worksheets.find((w) => w.state !== "veryHidden");
      if (!ws) return setErr(t("No 'Products' sheet found in the workbook.", "No hay hoja 'Products' en el libro."));

      const headerMap = buildHeaderMap();
      const allowed = importableKeys();
      const headerVals = ws.getRow(1).values as unknown[]; // 1-indexed; [0] is empty
      const colKey = new Map<number, string>();
      const seen: string[] = [];
      for (let c = 1; c < headerVals.length; c++) {
        const key = headerMap.get(cellText(headerVals[c]).toLowerCase());
        if (key && allowed.has(key) && !colKey.has(c)) {
          // first column wins for a given canonical key (export emits each once)
          if (![...colKey.values()].includes(key)) {
            colKey.set(c, key);
            if (key !== VERSION_COL) seen.push(key);
          }
        }
      }
      const skuCol = [...colKey.entries()].find(([, k]) => k === KEY_FIELD)?.[0];
      if (!skuCol) return setErr(t(`No '${KEY_FIELD}' column found — re-export the round-trip workbook.`, `No hay columna '${KEY_FIELD}' — vuelve a exportar el libro de ida y vuelta.`));
      const editableCols = [...colKey.values()].filter((k) => k !== KEY_FIELD && k !== VERSION_COL);
      if (editableCols.length === 0) return setErr(t("No editable columns recognized in the header row.", "No se reconoció ninguna columna editable en la cabecera."));

      const rows: MasterImportRow[] = [];
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const sku = cellText(row.getCell(skuCol).value);
        if (!sku) continue;
        const obj: MasterImportRow = { sku };
        for (const [c, key] of colKey) {
          if (key === KEY_FIELD) continue;
          const text = cellText(row.getCell(c).value);
          if (key === VERSION_COL) {
            if (text) obj[VERSION_COL] = text;
          } else if (text !== "") {
            obj[key] = text; // blank cell = no change
          }
        }
        rows.push(obj);
      }
      if (rows.length === 0) return setErr(t("No data rows with a SKU found.", "No hay filas de datos con SKU."));
      setRecognized(seen);
      setParsed(rows);
    } catch (e) {
      setErr(t(`Couldn't read the workbook: ${e instanceof Error ? e.message : "unknown error"}`, `No se pudo leer el libro: ${e instanceof Error ? e.message : "error desconocido"}`));
    }
  }

  function doPreview() {
    setErr(null); setReport(null);
    if (parsed.length === 0) return setErr(t("Nothing to preview.", "Nada que previsualizar."));
    startTransition(async () => {
      const res = await previewMasterImport(parsed);
      if (!res.ok) return setErr(res.error);
      setPreview(res.result);
      // default-select every clean / new-draft row (stale + invalid stay quarantined)
      const next = new Set<number>();
      res.result.rows.forEach((r, i) => { if (selectable(r.action)) next.add(i); });
      setSelected(next);
    });
  }

  function doApply() {
    setErr(null);
    const rowsToApply = [...selected].sort((a, b) => a - b).map((i) => parsed[i]).filter(Boolean);
    if (rowsToApply.length === 0) return setErr(t("Select at least one clean row to apply.", "Selecciona al menos una fila limpia para aplicar."));
    startTransition(async () => {
      const res = await applyMasterImport(rowsToApply);
      if (!res.ok) return setErr(res.error);
      setReport(res.result);
      setPreview(null);
      setSelected(new Set());
      router.refresh();
    });
  }

  const selectableIdx = useMemo(
    () => (preview ? preview.rows.map((r, i) => (selectable(r.action) ? i : -1)).filter((i) => i >= 0) : []),
    [preview]
  );
  const allSelected = selectableIdx.length > 0 && selectableIdx.every((i) => selected.has(i));

  return (
    <div className="space-y-5">
      {/* 1) EXPORT */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold">{t("1 · Export the round-trip workbook", "1 · Exportar el libro de ida y vuelta")}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {t("One row per product, keyed by the locked", "Una fila por producto, con clave en la columna bloqueada")} <code>SKU</code>. {t("Edit only the unlocked (editable) columns, then re-import the same file. Cost columns appear only for managers/admins (#29).", "Edita solo las columnas desbloqueadas (editables) y vuelve a importar el mismo fichero. Las columnas de costo solo aparecen para gerentes/admins (#29).")}
        </p>
        <a href="/api/erp/master-export" className="mt-3 inline-block">
          <Button>{t("Download round-trip XLSX", "Descargar XLSX de ida y vuelta")}</Button>
        </a>
      </div>

      {/* 2) IMPORT */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold">{t("2 · Re-import & review", "2 · Reimportar y revisar")}</h2>
        <p className="mt-1 mb-3 text-sm text-slate-500">
          {t("Upload the edited workbook (or the owner's master Excel). Rows changed in the DB since your export are", "Sube el libro editado (o el Excel maestro del dueño). Las filas que cambiaron en la base desde tu exportación quedan")} <span className="text-amber-700">{t("quarantined as stale", "en cuarentena por desfasadas")}</span>; {t("invalid rows are flagged but never block the clean ones; an unknown SKU becomes a", "las filas inválidas se marcan pero nunca bloquean las limpias; un SKU desconocido se convierte en")} <span className="text-sky-700">{t("draft for approval", "borrador para aprobación")}</span>. {t("Removing a row never deletes a product.", "Quitar una fila nunca borra un producto.")}
        </p>
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} className="text-sm" />
        {recognized.length > 0 && (
          <div className="mt-3 text-sm">
            <span className="text-slate-500">{t("Recognized editable columns", "Columnas editables reconocidas")}{fileName ? ` (${fileName})` : ""}: </span>
            {recognized.map((k) => (
              <span key={k} className="mb-1 mr-1.5 inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">{k}</span>
            ))}
            <div className="mt-1 text-slate-500">{parsed.length.toLocaleString()} {t("data rows.", "filas de datos.")}</div>
          </div>
        )}
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        {parsed.length > 0 && !report && (
          <div className="mt-3 flex items-center gap-3">
            <Button variant="outline" onClick={doPreview} disabled={pending}>
              {pending && !preview ? t("Previewing…", "Previsualizando…") : t("Preview import (dry run)", "Previsualizar importación (sin escribir)")}
            </Button>
            {preview && (
              <Button onClick={doApply} disabled={pending || selected.size === 0}>
                {pending ? t("Applying…", "Aplicando…") : t(`Apply ${selected.size.toLocaleString()} selected`, `Aplicar ${selected.size.toLocaleString()} seleccionadas`)}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* PREVIEW / REPORT */}
      {preview && !report && (
        <ReviewCard
          title={t("Preview — nothing written yet", "Previsualización — aún no se escribió nada")}
          result={preview}
          selected={selected}
          onToggle={(i) => setSelected((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
          onToggleAll={() => setSelected(allSelected ? new Set() : new Set(selectableIdx))}
          allSelected={allSelected}
        />
      )}
      {report && <ReviewCard title={t("Applied", "Aplicado")} result={report} />}
    </div>
  );
}

function ReviewCard({
  title, result, selected, onToggle, onToggleAll, allSelected,
}: {
  title: string;
  result: MasterImportResult;
  selected?: Set<number>;
  onToggle?: (i: number) => void;
  onToggleAll?: () => void;
  allSelected?: boolean;
}) {
  const { t } = usePrefs();
  const display = useMemo(() => {
    const order: Record<string, number> = { error: 0, stale: 1, new_draft: 2, preview: 3, applied: 4, skip: 5 };
    return result.rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (order[a.r.action] ?? 9) - (order[b.r.action] ?? 9))
      .slice(0, 1000);
  }, [result]);
  const more = result.rows.length - display.length;
  const showSel = !!onToggle;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-sm font-semibold">{title}</h2>
        <Chip label={result.dry_run ? t("will update", "se actualizarán") : t("applied", "aplicadas")} n={result.dry_run ? result.will_apply : result.applied} cls="border-emerald-200 bg-emerald-50 text-emerald-700" />
        <Chip label={t("new drafts", "borradores nuevos")} n={result.drafts} cls="border-sky-200 bg-sky-50 text-sky-700" />
        <Chip label={t("stale", "desfasadas")} n={result.stale} cls="border-amber-200 bg-amber-50 text-amber-700" />
        <Chip label={t("invalid", "inválidas")} n={result.errored} cls="border-red-200 bg-red-50 text-red-700" />
        <Chip label={t("no change", "sin cambio")} n={result.skipped} cls="border-slate-200 bg-slate-50 text-slate-600" />
        <span className="text-xs text-slate-400">{t("of", "de")} {result.total.toLocaleString()} {t("rows", "filas")}</span>
      </div>
      <div className="max-h-[32rem] overflow-auto rounded-md border border-slate-100">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {showSel && (
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" checked={!!allSelected} onChange={onToggleAll} aria-label={t("Select all clean rows", "Seleccionar todas las filas limpias")} />
                </th>
              )}
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 font-medium">{t("Action", "Acción")}</th>
              <th className="px-3 py-2 font-medium">{result.dry_run ? t("DB now → your sheet", "Base ahora → tu hoja") : t("Change", "Cambio")}</th>
            </tr>
          </thead>
          <tbody>
            {display.map(({ r, i }) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                {showSel && (
                  <td className="px-3 py-1.5">
                    {selectable(r.action) ? (
                      <input type="checkbox" checked={selected?.has(i) ?? false} onChange={() => onToggle?.(i)} aria-label={t(`Select ${r.sku}`, `Seleccionar ${r.sku}`)} />
                    ) : (
                      <span className="text-slate-300" title={t("Quarantined — not applied", "En cuarentena — no se aplica")}>🔒</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-1.5 font-mono text-xs">{r.sku ?? "—"}</td>
                <td className={`px-3 py-1.5 text-xs font-medium ${ACTION_CLS[r.action] ?? ""}`}>{actionLabel(t, r.action)}</td>
                <td className="px-3 py-1.5 text-slate-600"><Diff r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 && <p className="mt-2 text-xs text-slate-400">+{more.toLocaleString()} {t("more rows not shown (the counts above are exact).", "filas más sin mostrar (los recuentos de arriba son exactos).")}</p>}
    </div>
  );
}
