"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";

/**
 * Un motivo libre, obligatorio, antes de un salto de etapa: rechazar una pendiente, «Entregar ya» de oficina (D-361)
 * o «Deshacer etapa» (D-361/D-383). Lo abre la burbuja de Etapa de Almacén (D-NEXT); la ficha tiene el suyo en línea
 * con el mismo campo y los mismos dos botones. Devuelve el texto recortado; quien lo abre decide la nota y la escribe.
 */
export function MotivoDelSalto({ titulo, placeholder, textoDelBoton, ocupado, onCancelar, onConfirmar }: {
  titulo: string;
  placeholder: string;
  textoDelBoton: string;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const { t } = usePrefs();
  const [motivo, setMotivo] = useState("");
  return (
    <div className="overlay" style={{ zIndex: 60 }} onClick={(e) => e.stopPropagation()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>{titulo}</h3>
        <div className="field">
          <label>{t("Reason (required)", "Motivo (obligatorio)")}</label>
          <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus placeholder={placeholder} />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onCancelar} disabled={ocupado}>{t("Cancel", "Cancelar")}</button>
          <button className="btn btn-primary" onClick={() => onConfirmar(motivo.trim())} disabled={ocupado || !motivo.trim()}>{textoDelBoton}</button>
        </div>
      </div>
    </div>
  );
}
