"use client";

import { useEffect } from "react";
import { usePrefs } from "@/lib/prefs";
import { asomoEnLaLista, quienEscribe, type SolicitudDeAyuda } from "@/lib/help-requests";

/**
 * «¿Eliminar esta solicitud?» (262, D-904), en la propia pantalla y con el modal de la app: sin el diálogo de confirmación del
 * navegador. Lo abren «Mis solicitudes» (cada persona, las suyas) y la bandeja del admin (cualquiera).
 *
 * Dice lo que va a pasar de verdad: sale de la lista, si estaba abierta deja de contar como pendiente, y no se
 * pierde — queda guardada y un admin puede restaurarla.
 */
export function ConfirmarEliminarSolicitud({ solicitud, comoAdmin, ocupado, error, onCancelar, onConfirmar }: {
  solicitud: SolicitudDeAyuda;
  /** Desde la bandeja del admin: la solicitud puede ser de otra persona, y el texto lo dice. */
  comoAdmin?: boolean;
  ocupado: boolean;
  error?: string | null;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const { t } = usePrefs();
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) onCancelar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ocupado, onCancelar]);

  const titulo = t("Delete this request?", "¿Eliminar esta solicitud?");
  const asomo = asomoEnLaLista(solicitud.message, 200);
  const abierta = solicitud.status !== "atendida";
  return (
    <div className="overlay" style={{ zIndex: 60 }} data-confirmar-eliminar onClick={() => { if (!ocupado) onCancelar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>🗑 {titulo}</h3>
        {comoAdmin && <div className="hint" style={{ margin: "0 0 6px" }}>{quienEscribe(solicitud)}</div>}
        <blockquote style={{ margin: "8px 0 12px", padding: "8px 12px", borderLeft: "3px solid var(--line)", overflowWrap: "anywhere" }}>
          {asomo ?? t("Screenshot only, no text", "Solo captura, sin texto")}
        </blockquote>
        <p style={{ margin: 0 }}>
          {comoAdmin
            ? t("It leaves this list and the sender's list.", "Sale de esta lista y de la lista de quien la escribió.")
            : t("It leaves your list.", "Sale de tu lista.")}
          {abierta && <> {t("It also stops counting as pending.", "También deja de contar como pendiente.")}</>}
        </p>
        <p className="hint" style={{ margin: "8px 0 0" }}>
          {comoAdmin
            ? t("Nothing is lost: you can restore it from Status → Deleted.", "No se pierde nada: se restaura desde Estado → Eliminadas.")
            : t("Nothing is lost: it stays on record and an admin can restore it.", "No se pierde nada: queda guardada y un admin puede restaurarla.")}
        </p>
        {error && <p style={{ margin: "10px 0 0", color: "var(--red)" }}><b>{error}</b></p>}
        <div className="modal-actions">
          <button className="btn btn-ghost" autoFocus disabled={ocupado} onClick={onCancelar} data-eliminar-no>{t("Keep it", "Dejarla")}</button>
          <button className="btn btn-danger" disabled={ocupado} onClick={onConfirmar} data-eliminar-si>
            {ocupado ? t("Deleting…", "Eliminando…") : t("Delete", "Eliminar")}
          </button>
        </div>
      </div>
    </div>
  );
}
