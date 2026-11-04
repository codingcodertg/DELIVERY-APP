"use client";

import { useState } from "react";
import { Button } from "@/components/erp/ui/button";
import { useConfirm } from "@/lib/confirm";
import { cuandoSeGuardo } from "@/lib/customers/borrador-del-alta";
import { MAX_BORRADORES, nombreDelBorrador, resumenDelBorrador, type BorradorGuardado } from "@/lib/customers/borradores-del-alta";

type T = (en: string, es: string) => string;

/**
 * La lista «💾 Borradores» de Clientes (D-NEXT). Roberto Rodriguez Jr (admin), 2026-11-04: «show the list of the drafts
 * separately so you can have many». Los borradores del alta de quien mira, el más reciente primero, en la misma ventana que
 * «Solicitudes» (`SolicitudesDeCliente`): nombre de la cuenta, cuándo se guardó (hora de Texas) y una línea con el primer
 * contacto y las tiendas. «Abrir» abre «Nuevo cliente» con ese borrador; «Borrar» pregunta antes, con el diálogo de la app.
 * Viven en este navegador (`borradores-del-alta.ts`); aquí solo se pintan y se piden las acciones a quien llama.
 */
export function BorradoresDelAlta({ borradores, lang, onAbrir, onBorrar, onClose, t }: {
  borradores: readonly BorradorGuardado[];
  lang: "en" | "es";
  onAbrir: (b: BorradorGuardado) => void;
  /** Borra uno; false si el navegador no dejó. */
  onBorrar: (b: BorradorGuardado) => boolean;
  onClose: () => void;
  t: T;
}) {
  const confirmar = useConfirm();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const borrar = async (b: BorradorGuardado) => {
    const nombre = nombreDelBorrador(b, t);
    const si = await confirmar(
      t(`Delete the draft «${nombre}»? It cannot be recovered.`, `¿Borrar el borrador «${nombre}»? No se puede recuperar.`),
      { danger: true, confirmLabel: t("Delete", "Borrar") },
    );
    if (!si) return;
    setAviso(onBorrar(b)
      ? { ok: true, texto: t("Draft deleted.", "Borrador borrado.") }
      : { ok: false, texto: t("Could not delete the draft in this browser.", "No se pudo borrar el borrador en este navegador.") });
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-borradores-del-alta>
      <div className="modal" style={{ maxWidth: 720 }} role="dialog" aria-modal="true" aria-label={t("Drafts", "Borradores")}>
        <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900">💾 {t("Drafts", "Borradores")}</h2>
            <p className="text-xs text-slate-500">
              {t(
                `New customers you saved half-done, in this browser (up to ${MAX_BORRADORES}). Open one to finish it.`,
                `Clientes nuevos que guardaste a medias, en este navegador (hasta ${MAX_BORRADORES}). Abre uno para terminarlo.`,
              )}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 text-lg text-slate-400 hover:bg-slate-100" aria-label={t("Close", "Cerrar")}>✕</button>
        </div>
        {aviso && <p className={aviso.ok ? "mt-2 rounded-md bg-emerald-50 p-2 text-sm text-emerald-800" : "mt-2 rounded-md bg-red-50 p-2 text-sm text-red-800"} role="status">{aviso.texto}</p>}
        <div className="mt-3 max-h-[60vh] overflow-auto">
          {borradores.length === 0 && <p className="py-6 text-center text-sm text-slate-500">{t("No drafts.", "Sin borradores.")}</p>}
          <ul className="divide-y divide-slate-100">
            {borradores.map((b) => {
              const resumen = resumenDelBorrador(b);
              const cuando = cuandoSeGuardo(b.guardado, lang);
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-2 py-2.5" data-borrador={b.id}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className={b.form.account?.trim() ? "font-medium text-slate-900" : "font-medium italic text-slate-500"}>{nombreDelBorrador(b, t)}</span>
                      {cuando && <span className="text-xs text-slate-400">{cuando}</span>}
                    </div>
                    {resumen && <div className="mt-0.5 truncate text-xs text-slate-600">{resumen}</div>}
                  </div>
                  <Button size="sm" onClick={() => onAbrir(b)} data-abrir-borrador={b.id}>{t("Open", "Abrir")}</Button>
                  <Button size="sm" variant="outline" onClick={() => void borrar(b)} data-borrar-borrador={b.id}>{t("Delete", "Borrar")}</Button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
