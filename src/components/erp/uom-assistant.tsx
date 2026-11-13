"use client";

import { useMemo, useState, useTransition } from "react";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { rotulo } from "@/components/erp/rotulo";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/erp/ui/button";
import { money } from "@/lib/erp/utils";
import { inlineFix } from "@/lib/erp/actions";
import { failText } from "@/lib/erp/messages";
import { suggestUomFix, isCostOutlier, medianOf, type UomSuggestion } from "@/lib/erp/domain/uom";
import type { ReviewRow } from "@/components/erp/review-queue";
import { usePrefs } from "@/lib/prefs";

// G-10 (D-204): texto de pantalla por pares inline (usePrefs). La justificación de cada sugerencia
// (s.rationale, de domain/uom.ts) y la unidad propuesta vienen de la lógica y salen tal cual.

// Group line-mates by vendor + the first token of the name (a collection like "ACUARELA").
function lineKey(name: string, vendor: string | null): string {
  const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return `${vendor ?? ""}|${first}`;
}

type Candidate = { r: ReviewRow; s: UomSuggestion; mates: number[]; outlier: boolean };

export function UomAssistant({ rows, onEdit }: { rows: ReviewRow[]; onEdit: (id: number) => void }) {
  const router = useRouter();
  const { t } = usePrefs();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const groupCosts = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of rows) {
      if (r.cost == null || r.cost <= 0) continue;
      const k = lineKey(r.name, r.vendor_name);
      const arr = m.get(k);
      if (arr) arr.push(r.cost);
      else m.set(k, [r.cost]);
    }
    return m;
  }, [rows]);

  const candidates = useMemo(() => {
    const out: Candidate[] = [];
    for (const r of rows) {
      const s = suggestUomFix(r);
      if (s.flag.severity !== "high") continue;
      const mates = (groupCosts.get(lineKey(r.name, r.vendor_name)) ?? []).filter((c) => c !== r.cost);
      const outlier = r.cost != null ? isCostOutlier(r.cost, mates) : false;
      out.push({ r, s, mates, outlier });
    }
    out.sort((a, b) => (b.s.flag.ratio ?? 0) - (a.s.flag.ratio ?? 0));
    return out;
  }, [rows, groupCosts]);

  const visible = candidates.filter((c) => !done.has(c.r.id));

  function apply(c: Candidate) {
    if (c.s.proposedCost == null) return;
    setErr(null);
    setPendingId(c.r.id);
    startTransition(async () => {
      const patch: Record<string, string> = { cost: String(c.s.proposedCost) };
      if (c.s.proposedBaseUnit) patch.base_unit = c.s.proposedBaseUnit;
      const res = await inlineFix(c.r.id, patch);
      setPendingId(null);
      if (!res.ok) setErr(failText(res, t));
      else {
        setDone((d) => new Set(d).add(c.r.id));
        router.refresh();
      }
    });
  }

  const columnas = useMemo<ColumnaEstandar<Candidate>[]>(() => [
    { key: "producto", ...rotulo(t("Product", "Producto")), ancho: 320, fija: true, envuelve: true, valor: (c) => c.r.name,
      celda: ({ r, mates, outlier }) => <>
        <Link href={`/erp/product/${r.id}`} className="font-medium text-slate-900 hover:text-clay-700">{r.name}</Link>
        <div className="font-mono text-xs text-slate-400">{r.sku}</div>
        {outlier && (
          <div className="mt-0.5 text-xs text-amber-700">
            {mates.length === 1 ? t("Outlier vs 1 line-mate", "Atípico frente a 1 compañero de línea") : t(`Outlier vs ${mates.length} line-mates`, `Atípico frente a ${mates.length} compañeros de línea`)} ({t("median", "mediana")} {money(medianOf(mates))})
          </div>
        )}
      </> },
    { key: "precio", ...rotulo(t("Price", "Precio")), ancho: 110, numerico: true, valor: (c) => c.r.price, celda: (c) => money(c.r.price) },
    { key: "costo", ...rotulo(t("Cost", "Costo")), ancho: 110, numerico: true, valor: (c) => c.r.cost, celda: (c) => money(c.r.cost) },
    { key: "razon", ...rotulo(t("Cost÷Price", "Costo÷Precio")), ancho: 120, numerico: true, valor: (c) => c.s.flag.ratio ?? null,
      celda: (c) => <span className="font-medium text-amber-700">{c.s.flag.ratio == null ? "—" : `${c.s.flag.ratio.toFixed(1)}×`}</span> },
    { key: "arreglo", ...rotulo(t("Suggested fix", "Arreglo sugerido")), ancho: 360, envuelve: true, valor: (c) => c.s.rationale,
      celda: ({ s }) => s.proposedCost != null ? (
        <>
          {t("Set cost →", "Poner costo →")} <span className="font-medium">{money(s.proposedCost)}</span>
          {s.proposedBaseUnit ? <>, {t("unit →", "unidad →")} <span className="font-medium">{s.proposedBaseUnit}</span></> : null}
          <div className="text-xs text-slate-400">{s.rationale}</div>
        </>
      ) : <span className="text-slate-500">{s.rationale}</span> },
  ], [t]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
        <strong>{t("Unit-of-measure check.", "Revisión de unidad de medida.")}</strong> {t("A cost ≥ 1.5× the price across a line is the signature of a per-box cost stapled to a per-unit price. These are", "Un costo ≥ 1.5× el precio en toda una línea es la firma de un costo por caja pegado a un precio por unidad. Son")} <em>{t("suggestions", "sugerencias")}</em> {t("— review and apply; nothing changes on its own, and every applied fix goes through the audited update path (price_history captured).", "— revisa y aplica; nada cambia solo, y cada arreglo aplicado pasa por la ruta de actualización auditada (queda en price_history).")}
      </div>
      {err && <p className="px-4 py-2 text-sm text-red-600">{err}</p>}
      <div className="px-3 pb-2">
        <TablaEstandar id="erp-unidad-de-medida" filas={visible} claveDe={(c) => String(c.r.id)} columnas={columnas} sinCaja anchoDeAcciones={150}
          vacio={t("No likely unit-of-measure errors. 🎉", "Sin errores probables de unidad de medida. 🎉")}
          acciones={(c) => c.s.proposedCost != null ? (
            <Button size="sm" disabled={isPending && pendingId === c.r.id} onClick={() => apply(c)}>
              {isPending && pendingId === c.r.id ? t("Applying…", "Aplicando…") : t("Apply fix", "Aplicar arreglo")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onEdit(c.r.id)}>{t("Review", "Revisar")}</Button>
          )} />
      </div>
    </div>
  );
}
