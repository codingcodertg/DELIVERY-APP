"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { MINIMO_MOTIVO, motivoValido } from "@/lib/recruiting/historial";

/**
 * «¿Seguro? ¿Por qué?» antes de una acción deliberada de RR. HH. (D-NEXT): liberar o respaldar un activo, borrarlo,
 * quitar el acceso al hub. El dueño: «antes de hacer algo así tan deliberado como liberar, tiene que estar seguro». El
 * motivo es obligatorio y va al historial; sin él, el botón no se enciende.
 */
export function ConfirmarConMotivo({ titulo, texto, boton, peligro = true, busy = false, onConfirm, onClose }: {
  titulo: string; texto?: string; boton: string; peligro?: boolean; busy?: boolean;
  onConfirm: (motivo: string) => void | Promise<void>; onClose: () => void;
}) {
  const { t } = usePrefs();
  const [motivo, setMotivo] = useState("");
  const listo = motivoValido(motivo) && !busy;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()} data-dialogo="confirmar-con-motivo">
        <h3 style={{ margin: 0 }}>{titulo}</h3>
        {texto && <p style={{ margin: "10px 0 0" }}>{texto}</p>}
        <div style={{ marginTop: 12 }}>
          <label>{t("Why? (goes to the HR history)", "¿Por qué? (queda en el historial de RR. HH.)")}</label>
          <textarea rows={2} value={motivo} autoFocus data-motivo onChange={(e) => setMotivo(e.target.value)}
            placeholder={t(`At least ${MINIMO_MOTIVO} characters`, `Al menos ${MINIMO_MOTIVO} letras`)} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>{t("Cancel", "Cancelar")}</button>
          <button className={peligro ? "btn btn-danger" : "btn btn-primary"} disabled={!listo} data-accion="confirmar-con-motivo"
            onClick={() => void onConfirm(motivo.trim().replace(/\s+/g, " "))}>
            {boton}
          </button>
        </div>
      </div>
    </div>
  );
}
