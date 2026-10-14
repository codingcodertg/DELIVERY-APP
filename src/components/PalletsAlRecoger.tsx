"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { leePalletsAlRecoger, palletsPorDefecto } from "@/lib/pallets-al-recoger";
import { orderLabel } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/**
 * «¿Cuántos pallets cargas?» (D-547): el cuadro pequeño que sale al pulsar «🚚 Recogido» con la carga lista. Un número,
 * ya puesto con los pallets de la orden, y «Confirmar recogida». No es la ficha: es un paso, y con el número bueno, un
 * toque. Qué vale y qué trae puesto lo decide `pallets-al-recoger.ts`.
 */
export function PalletsAlRecoger({ pedido, onCancelar, onConfirmar }: {
  pedido: Delivery;
  onCancelar: () => void;
  onConfirmar: (pallets: number) => void;
}) {
  const { t } = usePrefs();
  const [texto, setTexto] = useState(() => palletsPorDefecto(pedido));
  const n = leePalletsAlRecoger(texto);
  const etiqueta = pedido.invoice_num || `#${orderLabel(pedido)}`;
  const confirmar = () => { if (n != null) onConfirmar(n); };
  return (
    <div className="overlay" data-pallets-al-recoger="" onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("Pallets loaded", "Pallets cargados")} style={{ maxWidth: 360 }}>
        <h3 style={{ marginTop: 0 }}>🚚 {t("Picked up", "Recogido")} · {etiqueta}</h3>
        <form onSubmit={(e) => { e.preventDefault(); confirmar(); }}>
          <div className="field">
            <label htmlFor="pallets-al-recoger">{t("How many pallets are you loading?", "¿Cuántos pallets cargas?")}</label>
            <input id="pallets-al-recoger" data-pallets="" type="number" inputMode="decimal" min="0.1" step="0.1" autoFocus
              value={texto} onChange={(e) => setTexto(e.target.value)}
              style={{ width: "100%", fontSize: 22, minHeight: 48, textAlign: "center", fontVariantNumeric: "tabular-nums" }} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn" style={{ flex: 1, minHeight: 44, justifyContent: "center" }} onClick={onCancelar}>
              {t("Cancel", "Cancelar")}
            </button>
            <button type="submit" data-confirmar-pallets="" className="btn btn-green" style={{ flex: 1, minHeight: 44, justifyContent: "center" }} disabled={n == null}>
              {t("Confirm pickup", "Confirmar recogida")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
