"use client";

import { useEffect, useState } from "react";
import type { AlmacenDeClientes } from "@/lib/customers/almacen";
import { cambiosDelHistorial, CLASE_DE_HISTORIAL, type HistorialDeCliente } from "@/lib/customers/edicion-como-solicitud";

type T = (en: string, es: string) => string;

const cuando = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]} ${m[4]}:${m[5]}` : iso;
};

/**
 * D-NEXT (221): el historial del cliente, plegado al pie de la ficha. Se carga al abrirlo. Cada fila: cuándo, quién, qué
 * clase de cambio, cada campo con antes → después, la nota de quien pidió y la decisión del admin.
 */
export function HistorialDelCliente({ clienteId, almacen, t }: { clienteId: number; almacen: AlmacenDeClientes; t: T }) {
  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState<HistorialDeCliente[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    setFilas(null);
    setError(null);
    void almacen.historial(clienteId).then((r) => {
      if (!vivo) return;
      if (r.ok) setFilas(r.valor);
      else setError(r.sinTabla ? t("The history is not available yet (migration 221).", "El historial aún no está disponible (migración 221).") : r.error);
    });
    return () => { vivo = false; };
  }, [abierto, clienteId, almacen, t]);
  return (
    <details className="group mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-5 py-3" data-historial-del-cliente onToggle={(e) => setAbierto((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700">
        📜 {t("History", "Historial")}
      </summary>
      <div className="mt-2">
        {error && <p className="text-xs text-red-600" role="status">{error}</p>}
        {!error && filas === null && <p className="text-xs text-slate-400">{t("Loading…", "Cargando…")}</p>}
        {filas && filas.length === 0 && <p className="text-xs text-slate-400">{t("No changes recorded yet.", "Aún no hay cambios registrados.")}</p>}
        {filas && filas.length > 0 && (
          <ul className="divide-y divide-slate-200" data-filas-del-historial>
            {filas.map((h) => {
              const clase = CLASE_DE_HISTORIAL[h.kind];
              const cambios = cambiosDelHistorial(h);
              return (
                <li key={h.id} className="py-2 text-sm" data-historial={h.id} data-clase={h.kind}>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{clase.icono} {t(clase.en, clase.es)}</span>
                    <span>{cuando(h.at)}</span>
                    <span>· {h.by_name ?? (h.by ? h.by.slice(0, 8) : t("system", "sistema"))}</span>
                    {h.request_id !== null && <span>· {t("request", "solicitud")} #{h.request_id}{h.requested_name ? ` (${h.requested_name})` : ""}</span>}
                  </div>
                  {cambios.length > 0 && (
                    <table className="mt-1 w-full text-xs">
                      <tbody>
                        {cambios.map((c) => (
                          <tr key={c.key} data-cambio={c.key}>
                            <td className="w-1/4 py-0.5 pr-2 text-slate-500">{t(c.en, c.es)}</td>
                            {h.kind === "create" ? (
                              <td className="py-0.5 text-slate-900">{c.despues}</td>
                            ) : (
                              <td className="py-0.5">
                                <span className="text-slate-400 line-through">{c.antes}</span>
                                <span className="mx-1 text-slate-400">→</span>
                                <span className="font-medium text-slate-900">{c.despues}</span>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {h.note && <div className="mt-0.5 text-xs text-slate-600">📝 {t("Why", "Por qué")}: {h.note}</div>}
                  {h.decision_note && <div className="mt-0.5 text-xs text-slate-600">🗒️ {t("Admin", "Admin")}: {h.decision_note}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
