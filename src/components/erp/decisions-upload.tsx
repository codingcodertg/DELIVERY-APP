"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/erp/ui/button";
import { parseCsv } from "@/lib/erp/csv";
import { runDecisions, type DecisionResult, type DecisionRow } from "@/lib/erp/actions";

// CSV header (lowercased) → canonical product field. Unrecognized columns are ignored.
const ALIASES: Record<string, string> = {
  sku: "sku", "unified code": "sku", code: "sku",
  price: "price", retail: "price",
  cost: "cost", "unit cost": "cost",
  base_unit: "base_unit", "base unit": "base_unit", uom: "base_unit",
  sf_per_box: "sf_per_box", sf_box: "sf_per_box", "sf/box": "sf_per_box", "sf per box": "sf_per_box", sfbox: "sf_per_box",
  size: "size_in", size_in: "size_in", "size (in)": "size_in", "size in": "size_in",
  size_cm: "size_cm", "size (cm)": "size_cm", "size cm": "size_cm",
  material: "material", finish: "finish",
  category: "category_path", category_path: "category_path", "category path": "category_path",
  status: "status",
};
const EDITABLE = ["price", "cost", "base_unit", "sf_per_box", "size_in", "size_cm", "material", "finish", "category_path", "status"];

const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

function Chip({ label, n, cls }: { label: string; n: number; cls: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{n.toLocaleString()} {label}</span>;
}
const ACTION_CLS: Record<string, string> = {
  preview: "text-clay-700", applied: "text-emerald-700", skip: "text-slate-400", error: "text-red-600",
};

function ResultCard({ title, result }: { title: string; result: DecisionResult }) {
  const display = useMemo(() => {
    const order: Record<string, number> = { error: 0, applied: 1, preview: 2, skip: 3 };
    return [...result.rows].sort((a, b) => (order[a.action] ?? 9) - (order[b.action] ?? 9)).slice(0, 500);
  }, [result]);
  const more = result.rows.length - display.length;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-sm font-semibold">{title}</h2>
        <Chip label={result.dry_run ? "will apply" : "applied"} n={result.dry_run ? result.will_apply : result.applied} cls="border-emerald-200 bg-emerald-50 text-emerald-700" />
        <Chip label="skipped" n={result.skipped} cls="border-slate-200 bg-slate-50 text-slate-600" />
        <Chip label="errored" n={result.errored} cls="border-red-200 bg-red-50 text-red-700" />
        <span className="text-xs text-slate-400">of {result.total.toLocaleString()} rows</span>
      </div>
      <div className="max-h-[28rem] overflow-auto rounded-md border border-slate-100">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {display.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                <td className="px-3 py-1.5 font-mono text-xs">{r.sku ?? "—"}</td>
                <td className={`px-3 py-1.5 text-xs font-medium ${ACTION_CLS[r.action] ?? ""}`}>{r.action}</td>
                <td className="px-3 py-1.5 text-slate-600">
                  {r.reason ? (
                    <span className={r.action === "error" ? "text-red-600" : ""}>{r.reason}</span>
                  ) : (
                    (r.changes ?? []).map((c, j) => (
                      <span key={j} className="mr-3 inline-block whitespace-nowrap">
                        <span className="text-slate-400">{c.field}</span> {fmt(c.from)} → <span className="font-medium">{fmt(c.to)}</span>
                      </span>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 && <p className="mt-2 text-xs text-slate-400">+{more.toLocaleString()} more rows not shown (the counts above are exact).</p>}
    </div>
  );
}

export function DecisionsUpload() {
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [headerMap, setHeaderMap] = useState<{ col: string; field: string }[]>([]);
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [preview, setPreview] = useState<DecisionResult | null>(null);
  const [report, setReport] = useState<DecisionResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null); setPreview(null); setReport(null); setRows([]); setHeaderMap([]); setFileName(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const grid = parseCsv(await file.text());
    if (grid.length < 2) return setErr("CSV needs a header row plus at least one data row.");
    const headers = grid[0].map((h) => h.trim());
    const canon = headers.map((h) => ALIASES[h.toLowerCase()] ?? null);
    setHeaderMap(headers.map((h, i) => ({ col: h || `col ${i + 1}`, field: canon[i] ?? "(ignored)" })).filter((m) => m.field !== "(ignored)"));
    const skuIdx = canon.indexOf("sku");
    if (skuIdx < 0) return setErr("No 'sku' column found — the CSV must have a sku column.");
    const editableIdx = canon.map((c, i) => ({ c, i })).filter((x) => x.c && x.c !== "sku" && EDITABLE.includes(x.c));
    if (editableIdx.length === 0) return setErr("No editable columns found (price, cost, base_unit, sf_per_box, size_in/size_cm, material, finish, category_path, status).");
    const built: DecisionRow[] = [];
    for (const r of grid.slice(1)) {
      const sku = (r[skuIdx] ?? "").trim();
      if (!sku) continue;
      const obj: DecisionRow = { sku };
      for (const { c, i } of editableIdx) {
        const v = (r[i] ?? "").trim();
        if (v) obj[c as string] = v;
      }
      built.push(obj);
    }
    if (built.length === 0) return setErr("No data rows with a SKU found.");
    setRows(built);
  }

  function doPreview() {
    setErr(null); setReport(null);
    if (rows.length === 0) return setErr("No rows to preview.");
    startTransition(async () => {
      const res = await runDecisions(rows, true);
      if (!res.ok) setErr(res.error);
      else setPreview(res.result);
    });
  }
  function doApply() {
    setErr(null);
    startTransition(async () => {
      const res = await runDecisions(rows, false);
      if (!res.ok) setErr(res.error);
      else {
        setReport(res.result);
        setPreview(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
        {headerMap.length > 0 && (
          <div className="mt-3 text-sm">
            <span className="text-slate-500">Recognized columns{fileName ? ` (${fileName})` : ""}: </span>
            {headerMap.map((m) => (
              <span key={m.col} className="mb-1 mr-2 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs">
                <span className="font-mono">{m.col}</span> → {m.field}
              </span>
            ))}
            <div className="mt-1 text-slate-500">{rows.length.toLocaleString()} data rows.</div>
          </div>
        )}
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        {rows.length > 0 && !report && (
          <div className="mt-3 flex items-center gap-3">
            <Button variant="outline" onClick={doPreview} disabled={pending}>
              {pending && !preview ? "Previewing…" : "Preview (dry run)"}
            </Button>
            {preview && preview.will_apply > 0 && (
              <Button onClick={doApply} disabled={pending}>
                {pending ? "Applying…" : `Apply ${preview.will_apply.toLocaleString()} change${preview.will_apply === 1 ? "" : "s"}`}
              </Button>
            )}
            {preview && preview.will_apply === 0 && <span className="text-sm text-slate-500">Nothing to apply.</span>}
          </div>
        )}
      </div>

      {preview && !report && <ResultCard title="Preview — nothing applied yet" result={preview} />}
      {report && <ResultCard title="Applied" result={report} />}
    </div>
  );
}
