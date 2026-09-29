"use client";

import { fmtMoney } from "@/lib/utils";

/**
 * Los dos precios calculados, Lista y Descuento, como botones que ponen la tarifa (D-303, D-317).
 *
 * Vivían escritos dos veces en la ficha —el alta paso a paso y la tarjeta de zona— y el diálogo de «Comenzar
 * preparación» (D-NEXT) los necesita otra vez. Un solo componente para los tres: el día que cambie cómo se
 * ofrece un precio, cambia en todos o en ninguno.
 *
 * Cada botón escribe SU número, y pulsar el que ya está puesto lo quita (vuelve a vacío). Se pinta cada uno
 * solo si tiene valor; la condición «el descuento solo si es otro número» se quitó a propósito en D-317.
 */
export function BotonesDeTarifa({ tarifa, list, discount, elegir, t }: {
  tarifa: number | null | undefined;
  list: number | null | undefined;
  discount: number | null | undefined;
  elegir: (v: number | null) => void;
  t: (en: string, es: string) => string;
}) {
  if (list == null && discount == null) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
      <span className="hint" style={{ margin: 0 }}>{t("Suggested fee:", "Tarifa sugerida:")}</span>
      {list != null && (
        <button type="button" className={"btn btn-sm " + (tarifa === list ? "btn-primary" : "btn-ghost")} onClick={() => elegir(tarifa === list ? null : list)}>
          {tarifa === list ? "✓ " : ""}{t("List", "Lista")} {fmtMoney(list)}
        </button>
      )}
      {discount != null && (
        <button type="button" className={"btn btn-sm " + (tarifa === discount ? "btn-primary" : "btn-ghost")} onClick={() => elegir(tarifa === discount ? null : discount)}>
          {tarifa === discount ? "✓ " : ""}{t("Discount", "Descuento")} {fmtMoney(discount)}
        </button>
      )}
    </div>
  );
}
