"use client";

import { useEffect, useState } from "react";
import { useSolicitudesDeAsignacion } from "@/lib/usa-solicitudes-de-asignacion";
import {
  abiertasEnOrden, choferInicial, motivoValido, type SolicitudDeAsignacion,
} from "@/lib/solicitud-de-asignacion";
import { orderLabel } from "@/lib/utils";
import type { Delivery, Profile } from "@/lib/types";

/**
 * La bandeja de solicitudes de asignación en el Gestor de Rutas (D-560, 176): la pastilla «📥 Solicitudes (N)» y su
 * ventana, con Aprobar (chofer elegible, por defecto el sugerido) y Rechazar (con motivo). Lo que hace «Aprobar» con la
 * orden NO vive aquí: lo pasa la página (`aprobar`), que reprograma con `reprogramarOrden` (D-549) y asigna con
 * `manualAssign` (el «Asignar a…» de cada fila). Esta ventana solo marca la solicitud cuando eso salió bien.
 *
 * Sin la tabla (176 sin aplicar), en el demo o en modo enseñanza: no se pinta nada.
 */
export function BandejaDeSolicitudes({ ordenes, usuarios, choferes, aprobar, abrirOrden, t }: {
  ordenes: readonly Delivery[];
  usuarios: readonly Profile[];
  choferes: readonly string[];
  /** Reprograma y asigna; true si la orden quedó como se pidió. */
  aprobar: (s: SolicitudDeAsignacion, chofer: string) => Promise<boolean>;
  abrirOrden: (d: Delivery) => void;
  t: (en: string, es: string) => string;
}) {
  const { disponible, lista, decidir } = useSolicitudesDeAsignacion(true);
  const [abierta, setAbierta] = useState(false);
  // `?solicitudes=1` (el aviso de la campana): la ventana abre sola.
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("solicitudes") === "1") setAbierta(true);
  }, []);
  useEffect(() => {
    if (!abierta) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierta(false); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [abierta]);

  if (disponible !== true) return null;
  const pendientes = abiertasEnOrden(lista);

  return (
    <>
      <button className={"btn btn-sm " + (pendientes.length ? "btn-amber" : "btn-ghost")} data-abrir-solicitudes
        aria-haspopup="dialog" onClick={() => setAbierta(true)}>
        📥 {t("Requests", "Solicitudes")} ({pendientes.length})
      </button>
      {abierta && (
        <div className="overlay" data-ventana-solicitudes onClick={(e) => { if (e.target === e.currentTarget) setAbierta(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={t("Assign requests", "Solicitudes de asignación")} style={{ maxWidth: 820 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>📥 {t("Assign requests", "Solicitudes de asignación")}</h3>
              <button className="btn btn-sm" data-cerrar-solicitudes onClick={() => setAbierta(false)} aria-label={t("Close", "Cerrar")}>✕</button>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              {t("Approve reschedules the order to the requested day and assigns it to the driver you pick (or leaves it in “Unassigned” that day). Reject asks for a reason. Whoever asked sees it in their 🔔.",
                "Aprobar reprograma la orden al día pedido y la asigna al chofer que elija (o la deja en «Sin asignar» ese día). Rechazar pide un motivo. Quien la pidió lo ve en su 🔔.")}
            </p>
            {pendientes.length === 0
              ? <div className="empty" data-sin-solicitudes>{t("No open requests.", "No hay solicitudes abiertas.")}</div>
              : pendientes.map((s) => (
                <FilaDeSolicitud key={s.id} s={s} orden={ordenes.find((d) => d.id === s.delivery_id) ?? null}
                  quien={usuarios.find((u) => u.id === s.requested_by)?.full_name ?? "—"}
                  choferes={choferes} aprobar={aprobar} decidir={decidir} abrirOrden={abrirOrden} t={t} />
              ))}
          </div>
        </div>
      )}
    </>
  );
}

function FilaDeSolicitud({ s, orden, quien, choferes, aprobar, decidir, abrirOrden, t }: {
  s: SolicitudDeAsignacion;
  orden: Delivery | null;
  quien: string;
  choferes: readonly string[];
  aprobar: (s: SolicitudDeAsignacion, chofer: string) => Promise<boolean>;
  decidir: ReturnType<typeof useSolicitudesDeAsignacion>["decidir"];
  abrirOrden: (d: Delivery) => void;
  t: (en: string, es: string) => string;
}) {
  const [chofer, setChofer] = useState(() => choferInicial(s.suggested_driver, choferes));
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const alAprobar = async () => {
    if (ocupado) return;
    setOcupado(true);
    try {
      // Primero la orden (reprogramar + asignar); la solicitud se marca SOLO si eso salió bien.
      if (await aprobar(s, chofer)) await decidir(s.id, { status: "approved", chofer });
    } finally { setOcupado(false); }
  };
  const alRechazar = async () => {
    if (ocupado || !motivoValido(motivo)) return;
    setOcupado(true);
    try { await decidir(s.id, { status: "rejected", motivo }); } finally { setOcupado(false); }
  };

  return (
    <div className="card" data-solicitud={s.id} style={{ margin: "8px 0", padding: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
        {orden
          ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => abrirOrden(orden)}>
              <b>{orden.invoice_num || `#${orderLabel(orden)}`}</b>{orden.account ? ` · ${orden.account}` : ""}
            </button>
          : <b>{t("Order not loaded", "Orden no cargada")}</b>}
        <span>{(s.from_date ?? t("no date", "sin fecha"))} → <b>{s.requested_date}</b></span>
        <span className="hint">{t("by", "de")} {quien}</span>
        {s.suggested_driver && <span className="hint">· {t("suggests", "sugiere")} {s.suggested_driver}</span>}
      </div>
      {s.note && <div className="hint" style={{ marginTop: 4 }}>“{s.note}”</div>}
      {!rechazando ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
          <select data-chofer-al-aprobar value={chofer} onChange={(e) => setChofer(e.target.value)} disabled={ocupado}>
            <option value="">{t("— no driver (Unassigned) —", "— sin chofer («Sin asignar») —")}</option>
            {choferes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" className="btn btn-primary btn-sm" data-aprobar-solicitud disabled={ocupado || !orden} onClick={() => void alAprobar()}>
            ✓ {t("Approve", "Aprobar")}
          </button>
          <button type="button" className="btn btn-sm" data-rechazar-solicitud disabled={ocupado} onClick={() => setRechazando(true)}>
            ✕ {t("Reject", "Rechazar")}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
          <input data-motivo-rechazo value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus style={{ flex: "1 1 220px" }}
            placeholder={t("Why not? (required)", "¿Por qué no? (obligatorio)")} />
          <button type="button" className="btn btn-sm" disabled={ocupado} onClick={() => { setRechazando(false); setMotivo(""); }}>{t("Back", "Volver")}</button>
          <button type="button" className="btn btn-danger btn-sm" data-confirmar-rechazo disabled={ocupado || !motivoValido(motivo)} onClick={() => void alRechazar()}>
            ✕ {t("Reject", "Rechazar")}
          </button>
        </div>
      )}
    </div>
  );
}
