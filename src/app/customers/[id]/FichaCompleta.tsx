"use client";

import { usePrefs } from "@/lib/prefs";
import { Badge } from "@/components/erp/ui/badge";
import {
  camposPorGrupo, estadoClase, estadoLabel, estaArchivado, fecha, mailUrl, motivoLabel, nombreDeTienda, telUrl, textoDeCampo, valorDeColumna,
  type Cliente,
} from "@/lib/customers/reglas";

/**
 * La ficha completa de un cliente: el cascarón de la ficha de un artículo del ERP (`product-detail.tsx`: cabecera con
 * título y pastillas, secciones en tarjetas, filas «etiqueta / valor»), con TODOS los campos del Excel por grupo. Solo
 * lectura: se corrige desde el cajón de la lista, que ya sabe quién puede y pide la fila de vuelta.
 */
export function FichaCompleta({ cliente: c }: { cliente: Cliente }) {
  const { t } = usePrefs();
  const tel = telUrl(c.phone);
  const mail = mailUrl(c.email);
  return (
    <main className="mx-auto max-w-screen-2xl px-4 py-6">
      <a href="/customers" className="text-sm text-clay-600 hover:underline">{t("← Customers", "← Clientes")}</a>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{c.account}</h1>
        <Badge className={estadoClase(c.status_store)}>{estadoLabel(c.status_store, t)}</Badge>
        {estaArchivado(c) && (
          <Badge className="border-slate-200 bg-slate-100 text-slate-500">{t("Archived", "Archivado")} · {motivoLabel(c.archived_reason, t)}</Badge>
        )}
        <span className="font-mono text-sm text-slate-500">{nombreDeTienda(c.store)} · {String(valorDeColumna(c, "concatenate"))}</span>
        <span className="ml-auto text-xs text-slate-400">{t("updated", "actualizado")} {fecha(c.updated_at)}</span>
      </div>

      {(tel || mail) && (
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {tel && <a href={tel} className="text-clay-600 hover:underline">📞 {c.phone}</a>}
          {mail && <a href={mail} className="text-clay-600 hover:underline">✉️ {c.email}</a>}
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {camposPorGrupo().map(({ grupo, campos }) => (
          <section key={grupo.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-grupo={grupo.key}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t(grupo.en, grupo.es)}</h2>
            {campos.map((campo) => (
              <div key={campo.key} className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0" data-campo={campo.key}>
                <span className="text-slate-500">{t(campo.en, campo.es)}</span>
                <span className="whitespace-pre-wrap text-right font-medium text-slate-900">{textoDeCampo(c, campo, t)}</span>
              </div>
            ))}
          </section>
        ))}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-grupo="excel">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("From the Excel", "Del Excel")}</h2>
          <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-sm" data-campo="house_no">
            <span className="text-slate-500">{t("House #", "N.º House")}</span>
            <span className="font-medium text-slate-900">{c.house_no ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5 text-sm" data-campo="concatenate">
            <span className="text-slate-500">{t("Store + account (CONCATENATE)", "Tienda + cuenta (CONCATENATE)")}</span>
            <span className="font-mono text-right text-slate-900">{String(valorDeColumna(c, "concatenate"))}</span>
          </div>
        </section>
      </div>
    </main>
  );
}
