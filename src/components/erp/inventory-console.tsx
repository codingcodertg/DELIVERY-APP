"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/erp/utils";
import {
  searchProducts,
  adjustInventory,
  recordCycleCount,
  reconcileCycleCount,
  listCycleCounts,
  getNegativeBalances,
  getProductStoreQoh,
  type ProductSearchHit,
  type CycleCountRow,
  type NegativeBalance,
} from "@/lib/erp/actions";

export type StoreOption = { id: string; name: string };

const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const qty = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString());

function Banner({ kind, children }: { kind: "ok" | "err"; children: React.ReactNode }) {
  return (
    <p className={cn("rounded-md border p-3 text-sm", kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700")}>
      {children}
    </p>
  );
}

/** Reusable product search-and-pick box. */
function ProductPicker({ picked, onPick }: { picked: ProductSearchHit | null; onPick: (p: ProductSearchHit | null) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProductSearchHit[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onQuery(v: string) {
    setQuery(v);
    onPick(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => setHits(await searchProducts(v)), 200);
  }
  return (
    <div className="relative">
      <span className="mb-1 block text-sm text-slate-500">Product</span>
      <input
        value={picked ? `${picked.name} (${picked.sku})` : query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search name or SKU…"
        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
      />
      {hits.length > 0 && !picked && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => { onPick(h); setHits([]); }} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-clay-50">
                <span className="truncate">{h.name}</span>
                <span className="shrink-0 font-mono text-xs text-slate-400">{h.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StoreSelect({ stores, value, onChange }: { stores: StoreOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-slate-500">Store</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500">
        {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>
  );
}

export function InventoryConsole({
  stores,
  initialCounts,
  initialNegatives,
}: {
  stores: StoreOption[];
  initialCounts: CycleCountRow[];
  initialNegatives: NegativeBalance[];
}) {
  const [counts, setCounts] = useState<CycleCountRow[]>(initialCounts);
  const [negatives, setNegatives] = useState<NegativeBalance[]>(initialNegatives);
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? id;

  async function refresh() {
    const [c, n] = await Promise.all([listCycleCounts(50, 0), getNegativeBalances()]);
    setCounts(c);
    setNegatives(n);
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <CycleCountCard stores={stores} onDone={refresh} />
        <AdjustCard stores={stores} onDone={refresh} />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-800">Negative balances {negatives.length > 0 && <span className="ml-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{negatives.length}</span>}</h2>
        </div>
        {negatives.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No negative on-hand balances. ✓</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                <tr><th className="px-4 py-2 font-medium">Product</th><th className="px-4 py-2 font-medium">Store</th><th className="px-4 py-2 text-right font-medium">QOH</th></tr>
              </thead>
              <tbody>
                {negatives.map((n) => (
                  <tr key={`${n.product_id}-${n.store_id}`} className="border-t border-slate-100">
                    <td className="px-4 py-2"><Link href={`/erp/product/${n.product_id}`} className="font-medium text-clay-700 hover:underline">{n.name}</Link> <span className="font-mono text-xs text-slate-400">{n.sku}</span></td>
                    <td className="px-4 py-2 text-slate-600">{storeName(n.store_id)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-red-600">{qty(n.qoh)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-800">Recent cycle counts</h2>
        </div>
        {counts.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No cycle counts recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Product</th><th className="px-4 py-2 font-medium">Store</th>
                  <th className="px-4 py-2 text-right font-medium">System</th><th className="px-4 py-2 text-right font-medium">Counted</th>
                  <th className="px-4 py-2 text-right font-medium">Variance</th><th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-4 py-2"><Link href={`/erp/product/${c.product_id}`} className="font-medium text-clay-700 hover:underline">{c.name}</Link> <span className="font-mono text-xs text-slate-400">{c.sku}</span></td>
                    <td className="px-4 py-2 text-slate-600">{storeName(c.store_id)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{qty(c.system_qty)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{qty(c.counted_qty)}</td>
                    <td className={cn("px-4 py-2 text-right tabular-nums", Number(c.variance) !== 0 ? "font-medium text-amber-700" : "text-slate-400")}>{Number(c.variance) > 0 ? "+" : ""}{qty(c.variance)}</td>
                    <td className="px-4 py-2">
                      <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", c.status === "reconciled" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>{c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ----------------------------- Cycle count ----------------------------- */
function CycleCountCard({ stores, onDone }: { stores: StoreOption[]; onDone: () => void }) {
  const [picked, setPicked] = useState<ProductSearchHit | null>(null);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [systemQoh, setSystemQoh] = useState<number | null>(null);
  const [counted, setCounted] = useState("");
  const [tolerance, setTolerance] = useState("");
  const [open, setOpen] = useState<{ count_id: number; system_qty: number; counted_qty: number; variance: number; within_tolerance: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function pick(p: ProductSearchHit | null) {
    setPicked(p);
    setOpen(null);
    setSystemQoh(null);
    if (p) {
      const rows = await getProductStoreQoh(p.id);
      const row = rows.find((r) => r.store_id === storeId);
      setSystemQoh(row?.qoh != null ? Number(row.qoh) : 0);
    }
  }
  async function onStore(v: string) {
    setStoreId(v);
    setOpen(null);
    if (picked) {
      const rows = await getProductStoreQoh(picked.id);
      const row = rows.find((r) => r.store_id === v);
      setSystemQoh(row?.qoh != null ? Number(row.qoh) : 0);
    }
  }
  async function record() {
    if (!picked || !storeId || counted === "") return;
    setBusy(true); setMsg(null);
    const res = await recordCycleCount({ productId: picked.id, storeId, countedQty: num(counted), tolerancePct: tolerance === "" ? null : num(tolerance) });
    setBusy(false);
    if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
    setOpen(res.result as { count_id: number; system_qty: number; counted_qty: number; variance: number; within_tolerance: boolean });
    onDone();
  }
  async function reconcile() {
    if (!open) return;
    setBusy(true); setMsg(null);
    const res = await reconcileCycleCount(open.count_id);
    setBusy(false);
    if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
    const r = res.result as { delta_posted?: number; new_qoh?: number };
    setMsg({ kind: "ok", text: `Reconciled — posted ${Number(r.delta_posted ?? 0) > 0 ? "+" : ""}${r.delta_posted ?? 0}, on-hand is now ${r.new_qoh ?? "?"} and verified.` });
    setOpen(null); setPicked(null); setCounted(""); setTolerance(""); setSystemQoh(null);
    onDone();
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">Cycle count</h2>
        <p className="text-xs text-slate-500">Count → variance vs the ledger → reconcile posts the delta and marks on-hand verified.</p>
      </div>
      <div className="space-y-3 p-4">
        <ProductPicker picked={picked} onPick={pick} />
        <div className="flex flex-wrap items-end gap-3">
          <StoreSelect stores={stores} value={storeId} onChange={onStore} />
          <div className="text-sm">
            <span className="mb-1 block text-slate-500">System (ledger)</span>
            <div className="flex h-9 items-center rounded-md bg-slate-50 px-3 text-sm tabular-nums text-slate-600">{systemQoh == null ? "—" : systemQoh.toLocaleString()}</div>
          </div>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Counted</span>
            <input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" className="h-9 w-28 rounded-md border border-slate-300 bg-white px-2 text-right text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Tolerance %</span>
            <input value={tolerance} onChange={(e) => setTolerance(e.target.value)} inputMode="decimal" placeholder="exact" className="h-9 w-24 rounded-md border border-slate-300 bg-white px-2 text-right text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500" />
          </label>
        </div>

        {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

        {open ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span>System <b className="tabular-nums">{open.system_qty.toLocaleString()}</b></span>
              <span>Counted <b className="tabular-nums">{open.counted_qty.toLocaleString()}</b></span>
              <span>Variance <b className={cn("tabular-nums", open.variance !== 0 ? "text-amber-700" : "text-slate-500")}>{open.variance > 0 ? "+" : ""}{open.variance.toLocaleString()}</b></span>
              {open.variance !== 0 && <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", open.within_tolerance ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{open.within_tolerance ? "within tolerance" : "out of tolerance"}</span>}
            </div>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={reconcile} disabled={busy} className="rounded-lg bg-clay-600 px-4 py-2 text-sm font-medium text-white hover:bg-clay-700 disabled:opacity-50">
                {busy ? "Reconciling…" : "Reconcile & verify"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <button type="button" onClick={record} disabled={busy || !picked || counted === ""} className="rounded-lg bg-clay-600 px-4 py-2 text-sm font-medium text-white hover:bg-clay-700 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? "Recording…" : "Record count"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/* ----------------------------- Manual adjustment ----------------------------- */
function AdjustCard({ stores, onDone }: { stores: StoreOption[]; onDone: () => void }) {
  const [picked, setPicked] = useState<ProductSearchHit | null>(null);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [reason, setReason] = useState<"adjustment" | "damage" | "shrinkage">("adjustment");
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function post() {
    if (!picked || !storeId || num(delta) === 0) return;
    setBusy(true); setMsg(null);
    const res = await adjustInventory({ productId: picked.id, storeId, qtyDelta: num(delta), reason, note: note || undefined });
    setBusy(false);
    if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
    const r = res.result as { new_qoh?: number; negative?: boolean };
    setMsg({ kind: "ok", text: `Posted ${reason} ${num(delta) > 0 ? "+" : ""}${num(delta)} — on-hand is now ${r.new_qoh ?? "?"}${r.negative ? " (negative — flagged)" : ""}.` });
    setDelta(""); setNote(""); setPicked(null);
    onDone();
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">Manual adjustment</h2>
        <p className="text-xs text-slate-500">A signed correction with a reason + note. Posts an append-only movement (the audit trail).</p>
      </div>
      <div className="space-y-3 p-4">
        <ProductPicker picked={picked} onPick={setPicked} />
        <div className="flex flex-wrap items-end gap-3">
          <StoreSelect stores={stores} value={storeId} onChange={setStoreId} />
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Reason</span>
            <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500">
              <option value="adjustment">adjustment</option>
              <option value="damage">damage</option>
              <option value="shrinkage">shrinkage</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Qty (signed)</span>
            <input value={delta} onChange={(e) => setDelta(e.target.value)} inputMode="decimal" placeholder="-5" className="h-9 w-28 rounded-md border border-slate-300 bg-white px-2 text-right text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500" />
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-500">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="reason / reference" className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500" />
        </label>

        {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

        <div className="flex justify-end">
          <button type="button" onClick={post} disabled={busy || !picked || num(delta) === 0} className="rounded-lg bg-clay-600 px-4 py-2 text-sm font-medium text-white hover:bg-clay-700 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "Posting…" : "Post adjustment"}
          </button>
        </div>
      </div>
    </section>
  );
}
