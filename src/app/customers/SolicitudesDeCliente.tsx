"use client";

import { useState } from "react";
import { Button } from "@/components/erp/ui/button";
import { cn } from "@/lib/erp/utils";
import type { AlmacenDeClientes } from "@/lib/customers/almacen";
import { cambiosDeSolicitud, textoDeValor } from "@/lib/customers/edicion-como-solicitud";
import { resumenDeSolicitud, type SolicitudDeCliente } from "@/lib/customers/solicitud-de-cliente";

type T = (en: string, es: string) => string;

const ESTADO: Record<SolicitudDeCliente["status"], { en: string; es: string; cls: string }> = {
  pending: { en: "Pending", es: "Pendiente", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  approved: { en: "Approved", es: "Aprobada", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  rejected: { en: "Rejected", es: "Rechazada", cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

/**
 * Las solicitudes de cliente: de alta (D-743, 216) y, desde D-780 (221), de EDICIÓN. El admin aprueba o rechaza, con
 * nota; vendedor y gerente ven las suyas y en qué quedaron. En una edición se ve cada campo con lo que había y lo que
 * se pide, y la nota de quien pidió. Cada decisión la escribe la base con su función; aquí solo se pinta lo que vuelve.
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
  /** La nota del admin al decidir una edición (una por solicitud abierta). */
  const [notas, setNotas] = useState<Record<number, string>>({});
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const aprobar = async (s: SolicitudDeCliente) => {
    setOcupada(s.id);
    setAviso(null);
    if (s.kind === "edicion") {
      const r = await almacen.aprobarEdicion(s.id, notas[s.id] ?? "");
      setOcupada(null);
      if (!r.ok) { setAviso({ ok: false, texto: t("Not approved: ", "No se aprobó: ") + r.error }); return; }
      setAviso({ ok: true, texto: t("Approved ✓ The customer was updated.", "Aprobada ✓ El cliente quedó actualizado.") });
      onDecidida();
      return;
    }
    const r = await almacen.aprobarSolicitud(s.id);
    setOcupada(null);
    if (!r.ok) { setAviso({ ok: false, texto: t("Not approved: ", "No se aprobó: ") + r.error }); return; }
    setAviso({ ok: true, texto: t(`Approved ✓ ${r.valor.length} customer row(s) created.`, `Aprobada ✓ ${r.valor.length} fila(s) de cliente creadas.`) });
    onDecidida();
  };
  const rechazar = async (s: SolicitudDeCliente) => {
    setOcupada(s.id);
    setAviso(null);
    const r = await almacen.rechazarSolicitud(s.id, s.kind === "edicion" ? (notas[s.id] ?? "") : nota);
    setOcupada(null);
    if (!r.ok) { setAviso({ ok: false, texto: t("Not rejected: ", "No se rechazó: ") + r.error }); return; }
    setRechazando(null);
    setNota("");
    setAviso({ ok: true, texto: t("Rejected.", "Rechazada.") });
    onDecidida();
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-solicitudes-de-cliente>
      <div className="modal" style={{ maxWidth: 820 }} role="dialog" aria-modal="true" aria-label={t("Customer requests", "Solicitudes de cliente")}>
        <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900">📝 {t("Customer requests", "Solicitudes de cliente")}</h2>
            <p className="text-xs text-slate-500">
              {esAdmin
                ? t("New customers and edits requested by sales and managers. Approve applies them; reject keeps a note for the requester.", "Clientes nuevos y ediciones que piden ventas y gerentes. Aprobar las aplica; rechazar deja una nota a quien lo pidió.")
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
              const edicion = s.kind === "edicion";
              const r = resumenDeSolicitud(s);
              const e = ESTADO[s.status];
              const cambios = edicion ? cambiosDeSolicitud(s) : [];
              return (
                <li key={s.id} className="py-2.5" data-solicitud={s.id} data-estado={s.status} data-clase={s.kind}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">{edicion ? `✏️ ${t("Edit", "Edición")}` : `✨ ${t("New customer", "Cliente nuevo")}`}</span>
                    <span className="font-medium text-slate-900">{edicion ? textoDeValor(s.before?.account) : r.cuenta}</span>
                    <span className="rounded-full border border-clay-200 bg-clay-50 px-2 py-0.5 text-xs text-clay-700">{r.tiendas}</span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-xs", e.cls)}>{t(e.en, e.es)}</span>
                    <span className="ml-auto text-xs text-slate-400">#{s.id} · {s.requested_name ?? s.requested_by.slice(0, 8)} · {s.created_at.slice(0, 10)}</span>
                  </div>
                  {!edicion && r.detalle && <div className="mt-0.5 text-xs text-slate-600">{r.detalle}</div>}
                  {edicion && (
                    <table className="mt-1 w-full text-xs" data-cambios-pedidos>
                      <tbody>
                        {cambios.map((c) => (
                          <tr key={c.key} data-cambio={c.key}>
                            <td className="w-1/4 py-0.5 pr-2 align-top text-slate-500">{t(c.en, c.es)}</td>
                            <td className="py-0.5">
                              <span className="text-slate-400 line-through">{c.antes}</span>
                              <span className="mx-1 text-slate-400">→</span>
                              <span className="font-medium text-slate-900">{c.despues}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {edicion && s.note && <div className="mt-0.5 text-xs text-slate-600">📝 {t("Why", "Por qué")}: {s.note}</div>}
                  {s.decision_note && <div className="mt-0.5 text-xs text-slate-600">🗒️ {t("Admin", "Admin")}: {s.decision_note}</div>}
                  {esAdmin && s.status === "pending" && edicion && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input className="h-8 min-w-60 flex-1 rounded-md border border-slate-300 px-2 text-sm" placeholder={t("Note for the requester (optional)", "Nota para quien lo pidió (opcional)")} value={notas[s.id] ?? ""} onChange={(e) => setNotas((n) => ({ ...n, [s.id]: e.target.value }))} data-nota-de-decision={s.id} />
                      <Button size="sm" disabled={ocupada !== null} onClick={() => void aprobar(s)} data-aprobar={s.id}>{ocupada === s.id ? "…" : `✓ ${t("Approve", "Aprobar")}`}</Button>
                      <Button size="sm" variant="outline" disabled={ocupada !== null} onClick={() => void rechazar(s)} data-confirmar-rechazo={s.id}>✕ {t("Reject", "Rechazar")}</Button>
                    </div>
                  )}
                  {esAdmin && s.status === "pending" && !edicion && (
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
