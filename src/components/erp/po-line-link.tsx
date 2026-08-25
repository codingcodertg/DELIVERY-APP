"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/erp/supabase/client";
import { unwrap, dbErrorMessage } from "@/lib/erp/db-result";
import { getPoLineSuggestions, setPoLineProduct, type PoLineSuggestion } from "@/lib/erp/actions";

// Per-line product link for the reconcile table. Matched → clickable catalog link; unmatched (and a
// PO line exists) → a picker that suggests candidates (vendor_sku → MPN → name) and allows manual
// search, optionally writing a vendor_sku alias so future imports auto-match. mgr/admin only.
export function PoLineLink({
  poLineId,
  productId,
  label,
  canEdit,
}: {
  poLineId: number | null;
  productId: number | null;
  label: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<PoLineSuggestion[] | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PoLineSuggestion[]>([]);
  const [alias, setAlias] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function openPicker() {
    setErr(null);
    setOpen(true);
    if (poLineId && suggestions === null) {
      const res = await getPoLineSuggestions(poLineId);
      if (res.ok) setSuggestions(res.suggestions);
      else setErr(res.error);
    }
  }

  async function manualSearch(query: string) {
    setQ(query);
    const clean = query.replace(/[%_,()]/g, " ").trim();
    if (clean.length < 2) { setResults([]); return; }
    // ARC-02: a failed search used to render as "no candidates".
    try {
      const data = unwrap(
        await createClient().from("app_products").select("id,sku,name,size_in").ilike("name", `%${clean}%`).limit(8),
        "po-line-link: product search",
      );
      setResults(((data ?? []) as Array<{ id: number; sku: string; name: string; size_in: string | null }>).map((r) => ({ ...r, reason: "search" })));
    } catch (e) {
      setResults([]);
      setErr(`Search failed: ${dbErrorMessage(e)}`);
    }
  }

  function pick(id: number) {
    if (!poLineId) return;
    setErr(null);
    startTransition(async () => {
      const res = await setPoLineProduct(poLineId, id, alias);
      if (!res.ok) setErr(res.error);
      else { setOpen(false); setQ(""); setResults([]); router.refresh(); }
    });
  }

  const candidates = q.trim().length >= 2 ? results : suggestions ?? [];

  const picker = open && canEdit && (
    <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-lg">
      <input
        autoFocus
        value={q}
        onChange={(e) => manualSearch(e.target.value)}
        placeholder="Search products…"
        className="h-8 w-full rounded-md border border-slate-300 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
      />
      <ul className="mt-1 max-h-56 overflow-auto">
        {candidates.length === 0 ? (
          <li className="px-1 py-2 text-xs text-slate-400">{suggestions === null ? "Loading suggestions…" : "No candidates — type to search."}</li>
        ) : (
          candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => pick(c.id)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-clay-50 disabled:opacity-50"
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="font-mono text-[11px] text-slate-400">{c.sku}</span>
                {c.reason !== "search" && <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">{c.reason}</span>}
              </button>
            </li>
          ))
        )}
      </ul>
      <label className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-slate-500">
        <input type="checkbox" checked={alias} onChange={(e) => setAlias(e.target.checked)} />
        Remember this vendor SKU → product (auto-match future imports)
      </label>
      {err && <p className="px-1 text-xs text-red-600">{err}</p>}
      <button type="button" onClick={() => setOpen(false)} className="mt-1 px-1 text-[11px] text-slate-400 hover:text-slate-600">Cancel</button>
    </div>
  );

  if (productId) {
    return (
      <span className="relative inline-flex items-center gap-1">
        <Link href={`/product/${productId}`} className="text-clay-700 hover:underline">{label} ↗</Link>
        {canEdit && <button type="button" onClick={openPicker} className="text-[11px] text-slate-400 hover:text-slate-600">change</button>}
        {picker}
      </span>
    );
  }
  if (!poLineId) return <span className="text-slate-400">—</span>;
  if (!canEdit) return <span className="text-amber-600">unmatched</span>;
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={openPicker}
        className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
      >
        Link product
      </button>
      {picker}
    </span>
  );
}
