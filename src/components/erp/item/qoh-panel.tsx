"use client";

import { useMemo, useState } from "react";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { rotulo } from "@/components/erp/rotulo";
import { money } from "@/lib/erp/utils";
import { usePrefs } from "@/lib/prefs";

// G-10 (D-204): texto de pantalla por pares inline (usePrefs). Código, descripción, tienda, código y
// descripción de QB son dato.

export interface StoreQoh {
  store_id: string;
  store_name: string;
  qoh: number | null;
  sq_ft: number | null;
  qb_code: string | null;
  qb_description: string | null;
  assortment_active: boolean;
  store_price: number | null;
  qoh_verified: boolean;
  store_cost: number | null;
  store_margin_pct: number | null;
}

const num = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));

// Collapsed: unified code + description + total QOH (boxes AND sq ft).
// Expanded: per-store rows (qb_code / qb_description / qoh / sq ft / price [+ cost/margin for mgr]).
export function QohPanel({
  unifiedCode,
  description,
  totalBoxes,
  totalSqFt,
  stores,
  showCost,
}: {
  unifiedCode: string;
  description: string;
  totalBoxes: number | null;
  totalSqFt: number | null;
  stores: StoreQoh[];
  showCost: boolean;
}) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const columnas = useMemo<ColumnaEstandar<StoreQoh>[]>(() => [
    { key: "tienda", ...rotulo(t("Store", "Tienda")), ancho: 170, fija: true, valor: (s) => s.store_name,
      celda: (s) => <span className="font-medium">{s.store_name}{!s.assortment_active && <span className="ml-1.5 text-[10px] uppercase text-slate-400">{t("off", "apagado")}</span>}</span> },
    { key: "qb", ...rotulo(t("QB code / description", "Código / descripción QB")), ancho: 260, envuelve: true, valor: (s) => s.qb_code,
      celda: (s) => <><span className="font-mono text-xs text-slate-500">{s.qb_code ?? "—"}</span>{s.qb_description && <span className="block text-xs text-slate-400">{s.qb_description}</span>}</> },
    { key: "qoh", ...rotulo(t("QOH", "QOH")), ancho: 130, numerico: true, valor: (s) => (s.qoh == null ? null : Number(s.qoh)),
      celda: (s) => <>
        <span className={Number(s.qoh) < 0 ? "tabular-nums font-medium text-red-600" : "tabular-nums"}>{num(s.qoh)}</span>
        {!s.qoh_verified && s.qoh != null && Number(s.qoh) !== 0 && (
          <span title={t("Opening balance seeded from the QB import — unverified until a physical count confirms it", "Saldo inicial sembrado desde la importación de QB — sin verificar hasta que un conteo físico lo confirme")} className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">{t("opening", "inicial")}</span>
        )}
      </> },
    { key: "sqft", ...rotulo(t("Sq ft", "Pies²")), ancho: 110, numerico: true, valor: (s) => (s.sq_ft == null ? null : Number(s.sq_ft)), celda: (s) => num(s.sq_ft) },
    { key: "precio", ...rotulo(t("Price", "Precio")), ancho: 110, numerico: true, valor: (s) => s.store_price, celda: (s) => money(s.store_price) },
    ...(showCost ? [
      { key: "costo", ...rotulo(t("Cost", "Costo")), ancho: 110, numerico: true, valor: (s: StoreQoh) => s.store_cost, celda: (s: StoreQoh) => money(s.store_cost) },
      { key: "margen", ...rotulo(t("Margin", "Margen")), ancho: 110, numerico: true, valor: (s: StoreQoh) => s.store_margin_pct, celda: (s: StoreQoh) => (s.store_margin_pct == null ? "—" : `${s.store_margin_pct}%`) },
    ] : []),
  ], [showCost, t]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-slate-50"
      >
        <span className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        <span className="font-mono text-sm font-medium text-slate-700">{unifiedCode}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-500">{description}</span>
        <span className="text-right">
          <span className="block text-sm font-semibold tabular-nums text-slate-900">{num(totalBoxes)} <span className="text-xs font-normal text-slate-400">{t("boxes", "cajas")}</span></span>
          <span className="block text-xs tabular-nums text-slate-500">{num(totalSqFt)} <span className="text-slate-400">{t("sq ft", "pies²")}</span></span>
        </span>
      </button>

      {open && (
        <div className="mt-2">
          <TablaEstandar id="erp-qoh-por-tienda" filas={stores} claveDe={(s) => s.store_id} columnas={columnas} sinCaja
            vacio={t("No store assortment rows.", "Sin filas de surtido por tienda.")} />
        </div>
      )}
    </div>
  );
}
