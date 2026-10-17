"use client";

import { useState } from "react";
import { fechaPropuesta, reprogramacionValida } from "@/lib/reprogramar-orden";
import { orderLabel, todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/**
 * El botón «📅» de una fila del Gestor y su cuadro (D-500): la fecha nueva (propone el día siguiente) y una nota
 * obligatoria. Desde D-549 guarda por `reprogramarOrden` (la función de la base `reprogramar_orden`, 173, que cambia SOLO
 * la fecha y deja la nota; sin ella, `updateDelivery` + `addNote` como antes). También en la ficha, arriba a la derecha.
 */
export function ReprogramarOrden({ pedido, lang, t, reprogramarOrden, notify, compacto = false }: {
  /** Solo el icono 📅, en línea con el número de factura (D-572): en una fila de tabla el botón con texto hacía la fila más alta. */
  compacto?: boolean;
  pedido: Delivery;
  lang: "en" | "es";
  t: (en: string, es: string) => string;
  reprogramarOrden: (id: string, fecha: string, nota: string, lang: "en" | "es") => Promise<boolean>;
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
    const ok = await reprogramarOrden(pedido.id, fecha, nota, lang);
    if (ok) {
      notify(t(`Rescheduled to ${fecha}`, `Reprogramada al ${fecha}`));
      setAbierto(false);
    }
    setGuardando(false);
  };

  return (
    <>
      {compacto ? (
        // El dueño, 2026-10-16: «Reschedule is making the rows thicker so just leave the calendar icon next to invoice #.
        // It'll serve as the reschedule button». Mismo `data-reprogramar` y el mismo cuadro; solo cambia la cara.
        <button type="button" className="btn-icono-fila" data-reprogramar={pedido.id} onClick={abrir}
          aria-label={t("Reschedule", "Reprogramar")}
          title={t("Reschedule: pick the next date and add a note", "Reprogramar: elige la siguiente fecha y deja una nota")}>
          📅
        </button>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" data-reprogramar={pedido.id} onClick={abrir}
          title={t("Reschedule: pick the next date and add a note", "Reprogramar: elige la siguiente fecha y deja una nota")}>
          📅 {t("Reschedule", "Reprogramar")}
        </button>
      )}
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
