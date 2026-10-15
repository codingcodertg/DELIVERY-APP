"use client";

import { useState } from "react";
import { useSolicitudesDeAsignacion } from "@/lib/usa-solicitudes-de-asignacion";
import {
  abiertaDe, fechaPropuestaDeSolicitud, puedePedirAsignacion, solicitudValida, ultimaDe,
} from "@/lib/solicitud-de-asignacion";
import { orderLabel, shiftDateISO, todayISO } from "@/lib/utils";
import type { Delivery, Profile } from "@/lib/types";

/**
 * «📅 Pedir para hoy / Request for today» en la cabecera de la ficha (D-560, 176), y en qué quedó la última solicitud de la
 * orden. Quién ve el botón lo dice `puedePedirAsignacion`; sin la tabla (176 sin aplicar), en el demo o en modo enseñanza,
 * el gancho dice `disponible: false` y aquí no se pinta nada.
 */
export function PedirAsignacion({ pedido, me, esSuya, choferes, t, notify }: {
  pedido: Delivery;
  me: Profile;
  esSuya: boolean;
  /** Los nombres de los choferes que esta persona conoce (para sugerir uno; se puede escribir otro o dejarlo vacío). */
  choferes: readonly string[];
  t: (en: string, es: string) => string;
  notify: (msg: string) => void;
}) {
  const puede = puedePedirAsignacion(me.role, pedido.stage, esSuya);
  const { disponible, lista, pedir, cancelar } = useSolicitudesDeAsignacion(true);
  const hoy = todayISO();
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(hoy);
  const [chofer, setChofer] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (disponible !== true) return null;
  const abierta = abiertaDe(lista, pedido.id);
  const ultima = ultimaDe(lista, pedido.id);
  const valida = solicitudValida(fecha, pedido.delivery_date, hoy);

  const abrir = () => {
    setFecha(fechaPropuestaDeSolicitud(pedido.delivery_date, hoy, shiftDateISO(hoy, 1)));
    setChofer(""); setNota(""); setAbierto(true);
  };
  const enviar = async () => {
    if (!valida || guardando) return;
    setGuardando(true);
    const ok = await pedir({ deliveryId: pedido.id, fecha, chofer: chofer || null, nota });
    setGuardando(false);
    if (ok) {
      notify(t(`Request sent: ${fecha}. Logistics will decide.`, `Solicitud enviada: ${fecha}. Logística decide.`));
      setAbierto(false);
    }
  };

  // En qué quedó: la abierta, o la última decidida si su día aún no ha pasado.
  let estado: React.ReactNode = null;
  if (abierta) {
    estado = (
      <span className="hdr-chip" data-solicitud-abierta title={abierta.note ?? undefined}>
        ⏳ {t(`Requested for ${abierta.requested_date}`, `Pedida para el ${abierta.requested_date}`)}
        {abierta.suggested_driver ? ` · ${abierta.suggested_driver}` : ""}
        {abierta.requested_by === me.id && (
          <button type="button" className="btn btn-ghost btn-sm" data-cancelar-solicitud style={{ marginLeft: 6, padding: "0 6px" }}
            onClick={() => void cancelar(abierta.id).then((ok) => { if (ok) notify(t("Request canceled", "Solicitud cancelada")); })}>
            {t("Cancel", "Cancelar")}
          </button>
        )}
      </span>
    );
  } else if (ultima && ultima.requested_date >= hoy && (ultima.status === "approved" || ultima.status === "rejected")) {
    estado = ultima.status === "approved"
      ? <span className="hdr-chip" data-solicitud-aprobada style={{ color: "var(--green)" }}>
          ✓ {t(`Request approved: ${ultima.requested_date}`, `Solicitud aprobada: ${ultima.requested_date}`)}
          {ultima.assigned_driver ? ` · ${ultima.assigned_driver}` : ""}
        </span>
      : <span className="hdr-chip" data-solicitud-rechazada style={{ color: "var(--red)" }} title={ultima.decision_note ?? undefined}>
          ✕ {t("Request rejected", "Solicitud rechazada")}{ultima.decision_note ? `: ${ultima.decision_note}` : ""}
        </span>;
  }

  return (
    <>
      {estado}
      {puede && !abierta && (
        <button type="button" className="btn btn-ghost btn-sm" data-pedir-asignacion={pedido.id} onClick={abrir}
          title={t("Ask logistics to move this order to another day (today by default) and assign it",
            "Pedirle a logística que pase esta orden a otro día (hoy por defecto) y la asigne")}>
          📅 {t("Request for today", "Pedir para hoy")}
        </button>
      )}
      {abierto && (
        <div className="overlay" data-dialogo-pedir-asignacion onClick={(e) => { if (e.target === e.currentTarget && !guardando) setAbierto(false); }}>
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 420 }}>
            <h3 style={{ marginTop: 0 }}>📅 {t("Request for today", "Pedir para hoy")} · {pedido.invoice_num || `#${orderLabel(pedido)}`}</h3>
            <p className="hint" style={{ marginTop: 0 }}>
              {t(`Now: ${pedido.delivery_date?.slice(0, 10) || "no date"}. Logistics approves (reschedules and assigns it) or rejects it; you'll see it in your 🔔.`,
                `Ahora: ${pedido.delivery_date?.slice(0, 10) || "sin fecha"}. Logística la aprueba (la reprograma y la asigna) o la rechaza; lo verá en su 🔔.`)}
            </p>
            <div className="field">
              <label>{t("Date", "Fecha")}</label>
              <input type="date" data-fecha-solicitud value={fecha} min={hoy} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="field">
              <label>{t("Suggested driver (optional)", "Chofer sugerido (opcional)")}</label>
              <input data-chofer-solicitud list={`choferes-${pedido.id}`} value={chofer} onChange={(e) => setChofer(e.target.value)}
                placeholder={t("Who has room today?", "¿Quién tiene espacio hoy?")} />
              <datalist id={`choferes-${pedido.id}`}>{choferes.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="field">
              <label>{t("Note (optional)", "Nota (opcional)")}</label>
              <textarea data-nota-solicitud rows={3} value={nota} onChange={(e) => setNota(e.target.value)} style={{ width: "100%" }}
                placeholder={t("e.g. the customer can receive today", "p. ej. el cliente puede recibir hoy")} />
            </div>
            {!valida && fecha === (pedido.delivery_date ?? "").slice(0, 10) && (
              <p className="hint" style={{ color: "var(--red)" }}>{t("The order already has that date.", "La orden ya tiene esa fecha.")}</p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="btn" style={{ flex: 1, minHeight: 44, justifyContent: "center" }} disabled={guardando}
                onClick={() => setAbierto(false)}>{t("Cancel", "Cancelar")}</button>
              <button type="button" className="btn btn-primary" data-enviar-solicitud style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
                disabled={!valida || guardando} onClick={() => void enviar()}>
                {guardando ? t("Sending…", "Enviando…") : t("Send request", "Enviar solicitud")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
