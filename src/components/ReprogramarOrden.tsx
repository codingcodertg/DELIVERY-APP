"use client";

import { useState } from "react";
import { useConfirm } from "@/lib/confirm";
import { fechaPropuesta, reprogramacionValida } from "@/lib/reprogramar-orden";
import { maxFechaDeEntrega, problemaAlAgendar, SIN_CASO_ESPECIAL, type CasoEspecial } from "@/lib/dia-de-entrega";
import { AvisoDeFecha } from "@/components/AvisoDeFecha";
import { pideConfirmarMediodia, preguntaSiEsParaHoy } from "@/lib/corte-de-ventas";
import { orderLabel, todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";
import type { OpcionesDelAviso } from "@/lib/data-provider";
import { fotoAntesDeReprogramar, MS_AVISO_CON_DESHACER, notaDeDeshacer, type FotoDeReprogramacion } from "@/lib/deshacer-reprogramar";

/**
 * El botón «📅» de una fila del Gestor y su cuadro (D-500): la fecha nueva (propone el día siguiente) y una nota
 * obligatoria. Desde D-549 guarda por `reprogramarOrden` (la función de la base `reprogramar_orden`, 173, que cambia SOLO
 * la fecha y deja la nota; sin ella, `updateDelivery` + `addNote` como antes). También en la ficha, arriba a la derecha.
 */
export function ReprogramarOrden({ pedido, rol, lang, t, reprogramarOrden, notify, compacto = false }: {
  /** El rol de quien reprograma: decide si sale la casilla del caso especial de domingo (D-658). */
  rol: string | null | undefined;
  /** Solo el icono 📅, en línea con el número de factura (D-572): en una fila de tabla el botón con texto hacía la fila más alta. */
  compacto?: boolean;
  pedido: Delivery;
  lang: "en" | "es";
  t: (en: string, es: string) => string;
  reprogramarOrden: (id: string, fecha: string, nota: string, lang: "en" | "es", caso?: CasoEspecial, opciones?: { deshacer?: FotoDeReprogramacion }) => Promise<boolean>;
  notify: (msg: string, opciones?: OpcionesDelAviso) => void;
}) {
  const hoy = todayISO();
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(() => fechaPropuesta(pedido.delivery_date, hoy));
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [caso, setCaso] = useState<CasoEspecial>(SIN_CASO_ESPECIAL);
  const confirmAction = useConfirm();
  // Ni domingo sin el caso especial ni un año imposible (D-658): el botón no se enciende, y el aviso dice por qué.
  const valida = reprogramacionValida(fecha, pedido.delivery_date, hoy, nota) && !problemaAlAgendar(fecha, pedido.delivery_date, { rol, caso, hoy });

  const abrir = () => { setFecha(fechaPropuesta(pedido.delivery_date, hoy)); setNota(""); setCaso(SIN_CASO_ESPECIAL); setAbierto(true); };
  const guardar = async () => {
    if (!valida || guardando) return;
    // Ventas, pasadas las 12 en Texas, reprogramando para HOY: «¿Seguro que esta orden es para hoy?» (`corte-de-ventas`).
    if (pideConfirmarMediodia(fecha, pedido.delivery_date, { rol }) && !(await preguntaSiEsParaHoy(confirmAction, t))) return;
    setGuardando(true);
    // D-NEXT: la foto de ANTES, para el «Deshacer» del aviso (fecha y, si la 172 la saca de la ruta, chofer y posición).
    const foto = fotoAntesDeReprogramar(pedido);
    const ok = await reprogramarOrden(pedido.id, fecha, nota, lang, caso);
    if (ok) {
      // Deshacer: la misma función de vuelta a la fecha de antes (permisos, RLS e historial), sin la pregunta del mediodía
      // (D-848): vuelve a un estado que ya estuvo. Una sola vez: el aviso quita el botón al tocarlo.
      const deshacer = async () => {
        if (!foto.delivery_date) return;
        notify(t("Undoing…", "Deshaciendo…"));
        const vuelta = await reprogramarOrden(foto.id, foto.delivery_date, notaDeDeshacer(lang), lang, undefined, { deshacer: foto });
        // Si falla, el proveedor ya enseñó el error de la base en este mismo aviso.
        if (vuelta) notify(t(`Undone: back to ${foto.delivery_date}`, `Deshecho: vuelve a ${foto.delivery_date}`));
      };
      notify(t(`Rescheduled to ${fecha}`, `Reprogramada al ${fecha}`), foto.delivery_date
        ? { ms: MS_AVISO_CON_DESHACER, accion: { etiqueta: `↶ ${t("Undo", "Deshacer")}`, alTocar: () => void deshacer() } }
        : undefined);
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
              <input type="date" data-nueva-fecha value={fecha} min={hoy} max={maxFechaDeEntrega(hoy)} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <AvisoDeFecha fecha={fecha} actual={pedido.delivery_date} rol={rol} caso={caso} onCaso={setCaso} t={t} />
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
