"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/erp/ui/badge";
import { Button } from "@/components/erp/ui/button";
import { cn, money } from "@/lib/erp/utils";
import { commercialStatusClass, statusLabel } from "@/lib/erp/status";
import { usePrefs } from "@/lib/prefs";

// G-10 (D-204): texto de pantalla por pares inline (usePrefs). SKU, nombre, MPN, categoría, proveedor
// y tamaño son dato; el estado es enumerado fijo (statusLabel). "~MERGE" es la etiqueta guardada.
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
  const { t } = usePrefs();
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
        {chosen && <Badge className="border-clay-200 bg-clay-50 text-clay-700">{t("survivor", "sobrevive")}</Badge>}
      </div>
      <div className="font-medium text-slate-900">{p.name}</div>
      <div className="mb-2 font-mono text-xs text-slate-400">{p.sku}</div>
      <Row k={t("Status", "Estado")} v={<Badge className={commercialStatusClass(p.status)}>{t(statusLabel(p.status).en, statusLabel(p.status).es)}</Badge>} />
      <Row k="MPN" v={p.mpn} />
      <Row k={t("Category", "Categoría")} v={p.category_path} />
      <Row k={t("Vendor", "Proveedor")} v={p.vendor_name} />
      <Row k={t("Size", "Tamaño")} v={p.size_in} />
      <Row k="SF/box" v={p.sf_per_box} />
      <Row k={t("Price", "Precio")} v={money(p.price)} />
      {canSeeCost && <Row k={t("Cost", "Costo")} v={money(p.cost)} />}
      {canSeeCost && <Row k={t("Margin", "Margen")} v={p.margin_pct == null ? "—" : `${p.margin_pct}%`} />}
    </button>
  );
}

function PairCard({ pair, canSeeCost }: { pair: MergePair; canSeeCost: boolean }) {
  const router = useRouter();
  const { t } = usePrefs();
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
      if (!res.ok) setErr(res.error ?? t("Merge failed", "La fusión falló"));
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
            {t("No MPN match found — resolve manually from the", "Sin coincidencia por MPN — resuélvelo a mano desde la ficha de")}{" "}
            <span className="font-mono">{pair.loser.sku}</span>{t(" detail page.", ".")}
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
              badge={t("~MERGE candidate", "candidato ~MERGE")}
            />
            <Card
              p={candidate}
              canSeeCost={canSeeCost}
              chosen={survivor === "candidate"}
              onChoose={() => setSurvivor("candidate")}
              badge={t("MPN match", "coincidencia MPN")}
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
                    {t("match:", "coincidencia:")} {c.sku}
                  </option>
                ))}
              </select>
            )}
            <Button onClick={doMerge} disabled={pending}>
              {pending ? t("Merging…", "Fusionando…") : t(`Merge — keep ${survivor === "candidate" ? candidate.sku : pair.loser.sku}`, `Fusionar — conservar ${survivor === "candidate" ? candidate.sku : pair.loser.sku}`)}
            </Button>
            {err && <span className="text-sm text-red-600">{err}</span>}
          </div>
        </>
      )}
    </div>
  );
}

export function MergeTool({ pairs, canSeeCost }: { pairs: MergePair[]; canSeeCost: boolean }) {
  const { t } = usePrefs();
  if (pairs.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        {t("No pending", "Sin pares")} <span className="font-mono">~MERGE</span> {t("pairs. 🎉", "pendientes. 🎉")}
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
