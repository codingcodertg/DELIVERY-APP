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
const ACTION_LABEL: Record<string, string> = {
  preview: "will update",
  new_draft: "new → draft",
  applied: "applied",
  skip: "no change",
  stale: "stale — quarantined",
  error: "invalid — quarantined",
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
      if (!ws) return setErr("No 'Products' sheet found in the workbook.");

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
      if (!skuCol) return setErr(`No '${KEY_FIELD}' column found — re-export the round-trip workbook.`);
      const editableCols = [...colKey.values()].filter((k) => k !== KEY_FIELD && k !== VERSION_COL);
      if (editableCols.length === 0) return setErr("No editable columns recognized in the header row.");

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
      if (rows.length === 0) return setErr("No data rows with a SKU found.");
      setRecognized(seen);
      setParsed(rows);
    } catch (e) {
      setErr(`Couldn't read the workbook: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  function doPreview() {
    setErr(null); setReport(null);
    if (parsed.length === 0) return setErr("Nothing to preview.");
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
    if (rowsToApply.length === 0) return setErr("Select at least one clean row to apply.");
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
        <h2 className="text-sm font-semibold">1 · Export the round-trip workbook</h2>
        <p className="mt-1 text-sm text-slate-500">
          One row per product, keyed by the locked <code>SKU</code>. Edit only the unlocked (editable)
          columns, then re-import the same file. Cost columns appear only for managers/admins (#29).
        </p>
        <a href="/api/master-export" className="mt-3 inline-block">
          <Button>Download round-trip XLSX</Button>
        </a>
      </div>

      {/* 2) IMPORT */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold">2 · Re-import &amp; review</h2>
        <p className="mt-1 mb-3 text-sm text-slate-500">
          Upload the edited workbook (or the owner&rsquo;s master Excel). Rows changed in the DB since your
          export are <span className="text-amber-700">quarantined as stale</span>; invalid rows are flagged
          but never block the clean ones; an unknown SKU becomes a <span className="text-sky-700">draft for
          approval</span>. Removing a row never deletes a product.
        </p>
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} className="text-sm" />
        {recognized.length > 0 && (
          <div className="mt-3 text-sm">
            <span className="text-slate-500">Recognized editable columns{fileName ? ` (${fileName})` : ""}: </span>
            {recognized.map((k) => (
              <span key={k} className="mb-1 mr-1.5 inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">{k}</span>
            ))}
            <div className="mt-1 text-slate-500">{parsed.length.toLocaleString()} data rows.</div>
          </div>
        )}
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        {parsed.length > 0 && !report && (
          <div className="mt-3 flex items-center gap-3">
            <Button variant="outline" onClick={doPreview} disabled={pending}>
              {pending && !preview ? "Previewing…" : "Preview import (dry run)"}
            </Button>
            {preview && (
              <Button onClick={doApply} disabled={pending || selected.size === 0}>
                {pending ? "Applying…" : `Apply ${selected.size.toLocaleString()} selected`}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* PREVIEW / REPORT */}
      {preview && !report && (
        <ReviewCard
          title="Preview — nothing written yet"
          result={preview}
          selected={selected}
          onToggle={(i) => setSelected((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
          onToggleAll={() => setSelected(allSelected ? new Set() : new Set(selectableIdx))}
          allSelected={allSelected}
        />
      )}
      {report && <ReviewCard title="Applied" result={report} />}
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
        <Chip label={result.dry_run ? "will update" : "applied"} n={result.dry_run ? result.will_apply : result.applied} cls="border-emerald-200 bg-emerald-50 text-emerald-700" />
        <Chip label="new drafts" n={result.drafts} cls="border-sky-200 bg-sky-50 text-sky-700" />
        <Chip label="stale" n={result.stale} cls="border-amber-200 bg-amber-50 text-amber-700" />
        <Chip label="invalid" n={result.errored} cls="border-red-200 bg-red-50 text-red-700" />
        <Chip label="no change" n={result.skipped} cls="border-slate-200 bg-slate-50 text-slate-600" />
        <span className="text-xs text-slate-400">of {result.total.toLocaleString()} rows</span>
      </div>
      <div className="max-h-[32rem] overflow-auto rounded-md border border-slate-100">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {showSel && (
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" checked={!!allSelected} onChange={onToggleAll} aria-label="Select all clean rows" />
                </th>
              )}
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">{result.dry_run ? "DB now → your sheet" : "Change"}</th>
            </tr>
          </thead>
          <tbody>
            {display.map(({ r, i }) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                {showSel && (
                  <td className="px-3 py-1.5">
                    {selectable(r.action) ? (
                      <input type="checkbox" checked={selected?.has(i) ?? false} onChange={() => onToggle?.(i)} aria-label={`Select ${r.sku}`} />
                    ) : (
                      <span className="text-slate-300" title="Quarantined — not applied">🔒</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-1.5 font-mono text-xs">{r.sku ?? "—"}</td>
                <td className={`px-3 py-1.5 text-xs font-medium ${ACTION_CLS[r.action] ?? ""}`}>{ACTION_LABEL[r.action] ?? r.action}</td>
                <td className="px-3 py-1.5 text-slate-600"><Diff r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 && <p className="mt-2 text-xs text-slate-400">+{more.toLocaleString()} more rows not shown (the counts above are exact).</p>}
    </div>
  );
}
