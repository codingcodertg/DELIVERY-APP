"use client";

import { useState } from "react";
import { Button } from "@/components/erp/ui/button";
import { cn } from "@/lib/erp/utils";
import { usePrefs } from "@/lib/prefs";
import { APP_VERSIONS } from "@/lib/app-versions";
import { enviaSolicitudDeAyuda, pideContactoDeAyuda, rolDeQuienEscribe } from "@/lib/help-send";
import type { Cliente } from "@/lib/customers/reglas";
import type { Vendedor } from "@/lib/customers/vendedores";
import { mensajeDePeticion, paginaDeLaPeticion } from "@/lib/customers/pedir-vendedor";
import { selCls } from "./FichaDeCliente";

type T = (en: string, es: string) => string;

/**
 * «Pedir al admin» un vendedor para este cliente (D-742): el gerente elige el vendedor (o «libre»), escribe una nota
 * si quiere, y se manda como solicitud de ayuda (`/api/help`): le llega al admin a «Solicitudes de ayuda» del hub y por
 * correo. No se escribe nada en el cliente: quien asigna es el admin.
 */
export function PedirVendedor({ cliente, vendedores, onClose, t }: { cliente: Cliente; vendedores: readonly Vendedor[]; onClose: () => void; t: T }) {
  const { lang } = usePrefs();
  const [repId, setRepId] = useState(cliente.rep_id ?? "");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const enviar = async () => {
    setOcupado(true);
    setAviso(null);
    const quien = await pideContactoDeAyuda();
    if (!quien) { setOcupado(false); setAviso({ ok: false, texto: t("Could not send: no session.", "No se pudo mandar: sin sesión.") }); return; }
    const vendedor = vendedores.find((v) => v.id === repId) ?? null;
    const r = await enviaSolicitudDeAyuda({
      userId: quien.id,
      message: mensajeDePeticion({ cliente, vendedor, actual: cliente.rep_name ?? null, nota }, lang),
      ficheros: [],
      page: paginaDeLaPeticion(cliente.id),
      senderName: quien.nombre,
      role: rolDeQuienEscribe(quien.rol, lang),
      appVersion: APP_VERSIONS.customers,
      lang,
    });
    setOcupado(false);
    if (r.tipo === "enviada" || r.tipo === "sin-correo") {
      setAviso({ ok: true, texto: t("Sent to the admin ✓ They will see it under Help requests in the hub.", "Enviada al admin ✓ La verá en «Solicitudes de ayuda» del hub.") });
      return;
    }
    setAviso({ ok: false, texto: t("Could not send the request. Try again.", "No se pudo mandar la solicitud. Inténtalo otra vez.") });
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-pedir-vendedor>
      <div className="modal" style={{ maxWidth: 520 }} role="dialog" aria-modal="true" aria-label={t("Request a sales rep", "Pedir vendedor")}>
        <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900">📩 {t("Request a sales rep from the admin", "Pedir vendedor al admin")}</h2>
            <p className="text-xs text-slate-500">
              {t("Only the admin assigns reps. This sends them a request for", "Solo el admin asigna vendedores. Esto le manda una solicitud para")} <b>{cliente.account}</b> ({cliente.store}).
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 text-lg text-slate-400 hover:bg-slate-100" aria-label={t("Close", "Cerrar")}>✕</button>
        </div>
        <label className="mt-3 block space-y-1">
          <span className="text-xs text-slate-500">{t("Sales rep to assign", "Vendedor a asignar")}</span>
          <select className={cn(selCls, "w-full")} value={repId} onChange={(e) => setRepId(e.target.value)} data-vendedor-pedido>
            <option value="">{t("— free (no rep)", "— libre (sin vendedor)")}</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.full_name}</option>)}
          </select>
        </label>
        <label className="mt-3 block space-y-1">
          <span className="text-xs text-slate-500">{t("Note for the admin (optional)", "Nota para el admin (opcional)")}</span>
          <textarea className={cn(selCls, "min-h-20 w-full")} value={nota} onChange={(e) => setNota(e.target.value)} data-nota-de-la-peticion />
        </label>
        {aviso && <p className={cn("mt-3 rounded-md p-2 text-sm", aviso.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")} role="status">{aviso.texto}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{aviso?.ok ? t("Close", "Cerrar") : t("Cancel", "Cancelar")}</Button>
          {!aviso?.ok && <Button disabled={ocupado} onClick={() => void enviar()} data-enviar-peticion>{ocupado ? t("Sending…", "Enviando…") : t("Send request", "Enviar solicitud")}</Button>}
        </div>
      </div>
    </div>
  );
}
