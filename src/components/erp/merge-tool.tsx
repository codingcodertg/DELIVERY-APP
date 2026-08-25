"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/erp/ui/badge";
import { Button } from "@/components/erp/ui/button";
import { cn, money } from "@/lib/erp/utils";
import { commercialStatusClass, label } from "@/lib/erp/status";
import { mergeProducts } from "@/lib/erp/actions";

export type MergeProduct = {
  id: number;
  sku: string;
  name: string;
  mpn: string | null;
  status: string;
  category_path: string | null;
  vendor_name: string | null;
  size_in: string | null;
  base_unit: string | null;
  sf_per_box: number | null;
  price: number | null;
  cost: number | null;
  margin_pct: number | null;
};

export type MergePair = { loser: MergeProduct; candidates: MergeProduct[] };

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1 text-sm last:border-0">
      <span className="text-slate-500">{k}</span>
      <span className="text-right font-medium">{v ?? "—"}</span>
    </div>
  );
}

function Card({
  p,
  canSeeCost,
  chosen,
  onChoose,
  badge,
}: {
  p: MergeProduct;
  canSeeCost: boolean;
  chosen: boolean;
  onChoose: () => void;
  badge: string;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      className={cn(
        "flex-1 rounded-xl border bg-white p-4 text-left transition-colors",
        chosen ? "border-clay-400 ring-2 ring-clay-200" : "border-slate-200 hover:border-slate-300"
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{badge}</span>
        {chosen && <Badge className="border-clay-200 bg-clay-50 text-clay-700">survivor</Badge>}
      </div>
      <div className="font-medium text-slate-900">{p.name}</div>
      <div className="mb-2 font-mono text-xs text-slate-400">{p.sku}</div>
      <Row k="Status" v={<Badge className={commercialStatusClass(p.status)}>{label(p.status)}</Badge>} />
      <Row k="MPN" v={p.mpn} />
      <Row k="Category" v={p.category_path} />
      <Row k="Vendor" v={p.vendor_name} />
      <Row k="Size" v={p.size_in} />
      <Row k="SF/box" v={p.sf_per_box} />
      <Row k="Price" v={money(p.price)} />
      {canSeeCost && <Row k="Cost" v={money(p.cost)} />}
      {canSeeCost && <Row k="Margin" v={p.margin_pct == null ? "—" : `${p.margin_pct}%`} />}
    </button>
  );
}

function PairCard({ pair, canSeeCost }: { pair: MergePair; canSeeCost: boolean }) {
  const router = useRouter();
  const [candIdx, setCandIdx] = useState(0);
  const [survivor, setSurvivor] = useState<"loser" | "candidate">("candidate");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const candidate = pair.candidates[candIdx];

  function doMerge() {
    if (!candidate) return;
    const survivorId = survivor === "candidate" ? candidate.id : pair.loser.id;
    const loserId = survivor === "candidate" ? pair.loser.id : candidate.id;
    setErr(null);
    startTransition(async () => {
      const res = await mergeProducts(survivorId, loserId);
      if (!res.ok) setErr(res.error ?? "Merge failed");
      else router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
      {pair.candidates.length === 0 ? (
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">{pair.loser.name}</div>
            <div className="font-mono text-xs text-slate-400">{pair.loser.sku}</div>
          </div>
          <span className="text-sm text-slate-500">
            No MPN match found — resolve manually from the{" "}
            <span className="font-mono">{pair.loser.sku}</span> detail page.
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Card
              p={pair.loser}
              canSeeCost={canSeeCost}
              chosen={survivor === "loser"}
              onChoose={() => setSurvivor("loser")}
              badge="~MERGE candidate"
            />
            <Card
              p={candidate}
              canSeeCost={canSeeCost}
              chosen={survivor === "candidate"}
              onChoose={() => setSurvivor("candidate")}
              badge="MPN match"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {pair.candidates.length > 1 && (
              <select
                value={candIdx}
                onChange={(e) => setCandIdx(Number(e.target.value))}
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
              >
                {pair.candidates.map((c, i) => (
                  <option key={c.id} value={i}>
                    match: {c.sku}
                  </option>
                ))}
              </select>
            )}
            <Button onClick={doMerge} disabled={pending}>
              {pending ? "Merging…" : `Merge — keep ${survivor === "candidate" ? candidate.sku : pair.loser.sku}`}
            </Button>
            {err && <span className="text-sm text-red-600">{err}</span>}
          </div>
        </>
      )}
    </div>
  );
}

export function MergeTool({ pairs, canSeeCost }: { pairs: MergePair[]; canSeeCost: boolean }) {
  if (pairs.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No pending <span className="font-mono">~MERGE</span> pairs. 🎉
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {pairs.map((p) => (
        <PairCard key={p.loser.id} pair={p} canSeeCost={canSeeCost} />
      ))}
    </div>
  );
}
