"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/erp/supabase/client";
import { unwrap, dbErrorMessage } from "@/lib/erp/db-result";
import { Button } from "@/components/erp/ui/button";
import { Input } from "@/components/erp/ui/input";
import { bulkUpdate, bulkResolveTag } from "@/lib/erp/actions";
import { label } from "@/lib/erp/status";

const TAGS = ["BELOW COST", "UNIT MISMATCH?", "store conflict >5%", "POSSIBLE DUP", "SF/BOX CORRUPT", "NOT_FOUND", "PO IMPORT"];
const STATUSES = ["active", "special_order", "discontinued", "inactive"];
const selCls = "h-8 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500";

export function BulkBar({
  ids,
  canEdit,
  onClear,
  onExport,
}: {
  ids: number[];
  canEdit: boolean;
  onClear: () => void;
  onExport: (fmt: "csv" | "xlsx") => void;
}) {
  const router = useRouter();
  const [action, setAction] = useState("");
  const [val, setVal] = useState("");
  const [cats, setCats] = useState<{ id: number; path: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (canEdit && cats.length === 0) {
      (async () => {
        // ARC-02: a failed read used to leave the category picker silently empty.
        try {
          const rows = await createClient().from("categories").select("id,path").order("path");
          setCats(unwrap(rows, "bulk-bar: categories") ?? []);
        } catch (e) {
          setMsg(`Could not load categories: ${dbErrorMessage(e)}`);
        }
      })();
    }
  }, [canEdit, cats.length]);

  function apply() {
    if (!action || !val) {
      setMsg("Pick a value.");
      return;
    }
    const valueLabel = action === "category" ? cats.find((c) => String(c.id) === val)?.path ?? val : val;
    if (!window.confirm(`Apply "${action.replace("_", " ")} = ${valueLabel}" to ${ids.length} product(s)?`)) return;
    setMsg(null);
    startTransition(async () => {
      let res;
      if (action === "resolve") {
        res = await bulkResolveTag(ids, val);
      } else {
        const patch: Record<string, string> = {};
        if (action === "base_unit") patch.base_unit = val;
        else if (action === "category") patch.category_id = val;
        else if (action === "status") patch.status = val;
        res = await bulkUpdate(ids, patch);
      }
      if (!res.ok) setMsg(res.error);
      else {
        // v4_59 (COR-11): a row that failed used to be counted as "skipped" with no reason, so a
        // partial apply looked clean. Show the failures and the first reason.
        const firstErr = res.rows.find((r) => r.action === "error")?.reason;
        setMsg(
          `${res.updated} updated, ${res.skipped} skipped` +
            (res.errored ? `, ${res.errored} failed${firstErr ? ` — ${firstErr}` : ""}` : "")
        );
        router.refresh();
        onClear();
      }
    });
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 shadow-lg">
        <span className="text-sm font-medium">{ids.length} selected</span>
        {canEdit && (
          <>
            <select
              className={selCls}
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setVal("");
                setMsg(null);
              }}
            >
              <option value="">Bulk action…</option>
              <option value="resolve">Resolve tag</option>
              <option value="base_unit">Set base unit</option>
              <option value="category">Recategorize</option>
              <option value="status">Set status</option>
            </select>
            {action === "resolve" && (
              <select className={selCls} value={val} onChange={(e) => setVal(e.target.value)}>
                <option value="">tag…</option>
                {TAGS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
            {action === "base_unit" && <Input className="h-8 w-28" placeholder="e.g. BOX" value={val} onChange={(e) => setVal(e.target.value)} />}
            {action === "category" && (
              <select className={selCls} value={val} onChange={(e) => setVal(e.target.value)}>
                <option value="">category…</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.path}</option>
                ))}
              </select>
            )}
            {action === "status" && (
              <select className={selCls} value={val} onChange={(e) => setVal(e.target.value)}>
                <option value="">status…</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{label(s)}</option>
                ))}
              </select>
            )}
            {action && (
              <Button size="sm" onClick={apply} disabled={pending || !val}>
                Apply
              </Button>
            )}
            <span className="h-5 w-px bg-slate-200" />
          </>
        )}
        <Button size="sm" variant="outline" onClick={() => onExport("csv")}>Export CSV</Button>
        <Button size="sm" variant="outline" onClick={() => onExport("xlsx")}>Export XLSX</Button>
        <button onClick={onClear} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">
          Clear
        </button>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}
