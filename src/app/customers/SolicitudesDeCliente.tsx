"use client";

import { useState } from "react";
import { Button } from "@/components/erp/ui/button";
import { cn } from "@/lib/erp/utils";
import type { AlmacenDeClientes } from "@/lib/customers/almacen";
import { resumenDeSolicitud, type SolicitudDeCliente } from "@/lib/customers/solicitud-de-cliente";

type T = (en: string, es: string) => string;

const ESTADO: Record<SolicitudDeCliente["status"], { en: string; es: string; cls: string }> = {
  pending: { en: "Pending", es: "Pendiente", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  approved: { en: "Approved", es: "Aprobada", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  rejected: { en: "Rejected", es: "Rechazada", cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

/**
 * Las solicitudes de cliente nuevo (D-NEXT, 216). El admin aprueba (crea las filas) o rechaza (con nota); vendedor y
 * gerente ven las suyas y en qué quedaron. Cada decisión la escribe la base con su función; aquí solo se pinta lo que vuelve.
 */
export function SolicitudesDeCliente({ solicitudes, esAdmin, almacen, onDecidida, onClose, t }: {
  solicitudes: readonly SolicitudDeCliente[];
  esAdmin: boolean;
  almacen: AlmacenDeClientes;
  /** Tras aprobar o rechazar: quien llama relee la lista de clientes y las solicitudes. */
  onDecidida: () => void;
  onClose: () => void;
  t: T;
}) {
  const [ocupada, setOcupada] = useState<number | null>(null);
  const [rechazando, setRechazando] = useState<number | null>(null);
  const [nota, setNota] = useState("");
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const aprobar = async (s: SolicitudDeCliente) => {
    setOcupada(s.id);
    setAviso(null);
    const r = await almacen.aprobarSolicitud(s.id);
    setOcupada(null);
    if (!r.ok) { setAviso({ ok: false, texto: t("Not approved: ", "No se aprobó: ") + r.error }); return; }
    setAviso({ ok: true, texto: t(`Approved ✓ ${r.valor.length} customer row(s) created.`, `Aprobada ✓ ${r.valor.length} fila(s) de cliente creadas.`) });
    onDecidida();
  };
  const rechazar = async (s: SolicitudDeCliente) => {
    setOcupada(s.id);
    setAviso(null);
    const r = await almacen.rechazarSolicitud(s.id, nota);
    setOcupada(null);
    if (!r.ok) { setAviso({ ok: false, texto: t("Not rejected: ", "No se rechazó: ") + r.error }); return; }
    setRechazando(null);
    setNota("");
    setAviso({ ok: true, texto: t("Rejected.", "Rechazada.") });
    onDecidida();
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-solicitudes-de-cliente>
      <div className="modal" style={{ maxWidth: 820 }} role="dialog" aria-modal="true" aria-label={t("New customer requests", "Solicitudes de cliente nuevo")}>
        <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900">📝 {t("New customer requests", "Solicitudes de cliente nuevo")}</h2>
            <p className="text-xs text-slate-500">
              {esAdmin
                ? t("Approve creates the customer in the stores requested; reject keeps a note for the requester.", "Aprobar crea el cliente en las tiendas pedidas; rechazar deja una nota a quien lo pidió.")
                : t("What you have requested and how it was decided.", "Lo que has pedido y en qué quedó.")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 text-lg text-slate-400 hover:bg-slate-100" aria-label={t("Close", "Cerrar")}>✕</button>
        </div>
        {aviso && <p className={cn("mt-2 rounded-md p-2 text-sm", aviso.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")} role="status">{aviso.texto}</p>}
        <div className="mt-3 max-h-[60vh] overflow-auto">
          {solicitudes.length === 0 && <p className="py-6 text-center text-sm text-slate-500">{t("No requests.", "Sin solicitudes.")}</p>}
          <ul className="divide-y divide-slate-100">
            {solicitudes.map((s) => {
              const r = resumenDeSolicitud(s);
              const e = ESTADO[s.status];
              return (
                <li key={s.id} className="py-2.5" data-solicitud={s.id} data-estado={s.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{r.cuenta}</span>
                    <span className="rounded-full border border-clay-200 bg-clay-50 px-2 py-0.5 text-xs text-clay-700">{r.tiendas}</span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-xs", e.cls)}>{t(e.en, e.es)}</span>
                    <span className="ml-auto text-xs text-slate-400">#{s.id} · {s.requested_name ?? s.requested_by.slice(0, 8)} · {s.created_at.slice(0, 10)}</span>
                  </div>
                  {r.detalle && <div className="mt-0.5 text-xs text-slate-600">{r.detalle}</div>}
                  {s.decision_note && <div className="mt-0.5 text-xs text-slate-600">📝 {s.decision_note}</div>}
                  {esAdmin && s.status === "pending" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button size="sm" disabled={ocupada !== null} onClick={() => void aprobar(s)} data-aprobar={s.id}>{ocupada === s.id ? "…" : `✓ ${t("Approve", "Aprobar")}`}</Button>
                      {rechazando === s.id ? (
                        <>
                          <input className="h-8 min-w-60 flex-1 rounded-md border border-slate-300 px-2 text-sm" placeholder={t("Note for the requester (optional)", "Nota para quien lo pidió (opcional)")} value={nota} onChange={(e) => setNota(e.target.value)} data-nota-de-rechazo />
                          <Button size="sm" variant="outline" disabled={ocupada !== null} onClick={() => void rechazar(s)} data-confirmar-rechazo={s.id}>{t("Reject", "Rechazar")}</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setRechazando(null); setNota(""); }}>{t("Cancel", "Cancelar")}</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={ocupada !== null} onClick={() => setRechazando(s.id)} data-rechazar={s.id}>✕ {t("Reject…", "Rechazar…")}</Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
