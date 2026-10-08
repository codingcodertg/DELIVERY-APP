"use client";

import { useState } from "react";
import { fechaPropuesta, notaDeReprogramacion, reprogramacionValida } from "@/lib/reprogramar-orden";
import { orderLabel, todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/**
 * El botón «📅» de una fila del Gestor y su cuadro (D-500): la fecha nueva (propone el día siguiente) y una nota
 * obligatoria. Guarda la fecha con `updateDelivery` y la nota en el historial con `addNote`.
 */
export function ReprogramarOrden({ pedido, lang, t, updateDelivery, addNote, notify }: {
  pedido: Delivery;
  lang: "en" | "es";
  t: (en: string, es: string) => string;
  updateDelivery: (id: string, patch: Partial<Delivery>) => Promise<unknown> | unknown;
  addNote: (id: string, text: string) => Promise<void>;
  notify: (msg: string) => void;
}) {
  const hoy = todayISO();
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(() => fechaPropuesta(pedido.delivery_date, hoy));
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const valida = reprogramacionValida(fecha, pedido.delivery_date, hoy, nota);

  const abrir = () => { setFecha(fechaPropuesta(pedido.delivery_date, hoy)); setNota(""); setAbierto(true); };
  const guardar = async () => {
    if (!valida || guardando) return;
    setGuardando(true);
    const ok = await updateDelivery(pedido.id, { delivery_date: fecha });
    if (ok !== false) {
      await addNote(pedido.id, notaDeReprogramacion(pedido.delivery_date, fecha, nota, lang));
      notify(t(`Rescheduled to ${fecha}`, `Reprogramada al ${fecha}`));
      setAbierto(false);
    }
    setGuardando(false);
  };

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" data-reprogramar={pedido.id} onClick={abrir}
        title={t("Reschedule: pick the next date and add a note", "Reprogramar: elige la siguiente fecha y deja una nota")}>
        📅 {t("Reschedule", "Reprogramar")}
      </button>
      {abierto && (
        <div className="overlay" data-dialogo-reprogramar onClick={(e) => { if (e.target === e.currentTarget && !guardando) setAbierto(false); }}>
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 420 }}>
            <h3 style={{ marginTop: 0 }}>📅 {t("Reschedule", "Reprogramar")} · {pedido.invoice_num || `#${orderLabel(pedido)}`}</h3>
            <div className="field">
              <label>{t("New date", "Nueva fecha")}</label>
              <input type="date" data-nueva-fecha value={fecha} min={hoy} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="field">
              <label>{t("Note (required)", "Nota (obligatoria)")}</label>
              <textarea data-nota-reprogramar rows={3} value={nota} onChange={(e) => setNota(e.target.value)} autoFocus
                placeholder={t("Why is it moving?", "¿Por qué se mueve?")} style={{ width: "100%" }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="btn" style={{ flex: 1, minHeight: 44, justifyContent: "center" }} disabled={guardando}
                onClick={() => setAbierto(false)}>{t("Cancel", "Cancelar")}</button>
              <button type="button" className="btn btn-primary" data-confirmar-reprogramar style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
                disabled={!valida || guardando} onClick={() => void guardar()}>
                {guardando ? t("Saving…", "Guardando…") : t("Reschedule", "Reprogramar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
