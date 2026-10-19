"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { NO_ESTA_LISTA } from "@/lib/acciones-parada";
import { MOTIVOS_SIN_LISTO, notaDelMotivoSinListo, type MotivoSinListo } from "@/lib/recoger-sin-listo-pantalla";
import { orderLabel } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/**
 * «Not marked ready by Warehouse · Why are you picking up?» (D-NEXT): el cuadro pequeño que sale al pulsar «🚚 Recogido»
 * en una orden que el almacén no marcó lista. Un motivo de la lista; «Otro» pide el texto. Confirmar recoge (la misma
 * escritura que la ficha, con avisos al almacén y a logística) y después abre la ficha para ver los detalles.
 */
export function RecogerSinListo({ pedido, ocupado, onCancelar, onConfirmar }: {
  pedido: Delivery;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (nota: string) => void;
}) {
  const { t, lang } = usePrefs();
  const [motivo, setMotivo] = useState<MotivoSinListo | null>(null);
  const [texto, setTexto] = useState("");
  const nota = notaDelMotivoSinListo(motivo, texto, lang);
  const etiqueta = pedido.invoice_num || `#${orderLabel(pedido)}`;
  return (
    <div className="overlay" data-recoger-sin-listo="" onClick={(e) => { if (e.target === e.currentTarget && !ocupado) onCancelar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t(NO_ESTA_LISTA.en, NO_ESTA_LISTA.es)} style={{ maxWidth: 380 }}>
        <h3 style={{ marginTop: 0 }}>⚠ {t("Not marked ready by Warehouse", "El almacén no la marcó lista")}</h3>
        <div className="hint" style={{ marginTop: 0 }}>{etiqueta}</div>
        <form onSubmit={(e) => { e.preventDefault(); if (nota) onConfirmar(nota); }}>
          <div className="field">
            <label htmlFor="motivo-sin-listo">{t("Why are you picking up?", "¿Por qué la recoges?")}</label>
            <select id="motivo-sin-listo" data-motivo-sin-listo="" autoFocus value={motivo ?? ""} disabled={ocupado}
              onChange={(e) => setMotivo((e.target.value || null) as MotivoSinListo | null)} style={{ width: "100%", minHeight: 44, fontSize: 16 }}>
              <option value="">{t("Choose…", "Elige…")}</option>
              {MOTIVOS_SIN_LISTO.map((m) => <option key={m.clave} value={m.clave}>{lang === "es" ? m.es : m.en}</option>)}
            </select>
          </div>
          {motivo === "otro" && (
            <div className="field">
              <textarea data-texto-sin-listo="" rows={3} value={texto} autoFocus disabled={ocupado} onChange={(e) => setTexto(e.target.value)}
                placeholder={t("Explain briefly", "Explica en pocas palabras")} style={{ width: "100%" }} />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn" style={{ flex: 1, minHeight: 44, justifyContent: "center" }} onClick={onCancelar} disabled={ocupado}>
              {t("Cancel", "Cancelar")}
            </button>
            <button type="submit" data-confirmar-sin-listo="" className="btn btn-amber" style={{ flex: 1, minHeight: 44, justifyContent: "center" }} disabled={!nota || ocupado}>
              {ocupado ? t("Saving…", "Guardando…") : `🚚 ${t("Confirm pickup", "Confirmar recogida")}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
