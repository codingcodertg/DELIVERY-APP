"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { faltaParaAnular, pideTextoLibre } from "@/lib/cancel-reasons";
import { escrituraAlAnular, type EscrituraAlAnular } from "@/lib/etapas-en-la-fila";
import type { CancelReason } from "@/lib/types";

/**
 * «Cancelar orden» con su motivo (D-291, migración 122): la clave de la lista de Ajustes y, si el motivo lo pide, el
 * texto libre. Lo abre la burbuja de Etapa de Almacén (D-NEXT); la ficha tiene el mismo selector en línea. Lo que falta
 * lo dice `faltaParaAnular`, la misma regla que el botón de la ficha y que `setStage`; lo que se escribe,
 * `escrituraAlAnular`, que llaman los dos.
 */
export function ConfirmarAnulacion({ motivos, ocupado, onCancelar, onConfirmar }: {
  motivos: CancelReason[];
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (escritura: EscrituraAlAnular) => void;
}) {
  const { lang, t } = usePrefs();
  const [clave, setClave] = useState("");
  const [texto, setTexto] = useState("");
  const falta = faltaParaAnular(clave, texto, motivos, lang);
  return (
    <div className="overlay" style={{ zIndex: 60 }} onClick={(e) => e.stopPropagation()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>{t("Cancel order", "Cancelar orden")}</h3>
        <div className="field">
          <label>{t("Cancellation reason (recorded for reporting)", "Motivo de cancelación (registrado para reportes)")}</label>
          <select value={clave} onChange={(e) => { setClave(e.target.value); setTexto(""); }} autoFocus>
            <option value="">{t("Select a reason…", "Seleccione un motivo…")}</option>
            {motivos.map((r) => <option key={r.key} value={r.key}>{t(r.en, r.es)}</option>)}
          </select>
          {pideTextoLibre(clave, motivos) && (
            <input style={{ marginTop: 8 }} value={texto} onChange={(e) => setTexto(e.target.value)}
              placeholder={t("Say why (required)", "Escriba por qué (obligatorio)")} />
          )}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onCancelar} disabled={ocupado}>{t("Keep order", "Dejar la orden")}</button>
          <button className="btn btn-danger" disabled={ocupado || !!falta} onClick={() => onConfirmar(escrituraAlAnular(clave, texto, motivos, lang))}>
            {t("Confirm cancellation", "Confirmar cancelación")}
          </button>
        </div>
      </div>
    </div>
  );
}
