"use client";

import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { Badge } from "@/components/erp/ui/badge";
import { estadoClase, estadoLabel, estaArchivado, fecha, mailUrl, motivoLabel, nombreDeTienda, telUrl, type Cliente } from "@/lib/customers/reglas";
import { TarjetasDeLaFicha } from "../FichaDeCliente";

/**
 * La ficha completa de un cliente como página propia, para un enlace directo (la cola de «Decidir si se juntan» enlaza
 * aquí). Pinta lo mismo que la ventana de la lista (`TarjetasDeLaFicha`, D-NEXT): arriba el nombre y el estado, debajo
 * las tiendas, y las tarjetas sin «Cuenta» ni «Tienda» repetidas. Solo lectura: se corrige en la ventana de la lista, que
 * ya sabe quién puede y pide la fila de vuelta.
 */
export function FichaCompleta({ cliente: c, hermanas = [], puedeEditar = false }: { cliente: Cliente; hermanas?: Cliente[]; puedeEditar?: boolean }) {
  const { t } = usePrefs();
  const tel = telUrl(c.phone);
  const mail = mailUrl(c.email);
  return (
    <main className="mx-auto max-w-screen-2xl px-4 py-6">
      <Link href="/customers" className="text-sm text-clay-600 hover:underline">{t("← Customers", "← Clientes")}</Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{c.account}</h1>
        <Badge className={estadoClase(c.status_store)}>{estadoLabel(c.status_store, t)}</Badge>
        {estaArchivado(c) && (
          <Badge className="border-slate-200 bg-slate-100 text-slate-500">{t("Archived", "Archivado")} · {motivoLabel(c.archived_reason, t)}</Badge>
        )}
        {/* Sin «tienda · tienda+cuenta» al lado del nombre (D-NEXT, el dueño: «dice RDC McAllen y después […] como un ID»): la
            tienda está en las pastillas de abajo y la CONCATENATE en «Otros». */}
        <span className="ml-auto text-xs text-slate-400">{t("updated", "actualizado")} {fecha(c.updated_at)}</span>
        {/* «✏️ Editar» (D-648; el dueño: «add a edit button for the customer in the customer app»). Esta página solo se lee; se
            edita en la ventana de la lista (D-NEXT), que ya guarda con su botón y sus reglas: el enlace la abre con este cliente,
            ya editando. Solo para quien puede editar (`puedeEditar`, la misma regla de la lista). */}
        {puedeEditar && (
          <Link href={`/customers?editar=${c.id}`} data-editar-cliente={c.id}
            className="rounded-md bg-clay-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-clay-700">
            ✏️ {t("Edit", "Editar")}
          </Link>
        )}
      </div>

      {/* Las tiendas de la misma empresa (189): cada una es su ficha, con su contacto y su vendedor. Con una sola, su pastilla:
          es donde se ve la tienda, que ya no sale ni al lado del nombre ni en una tarjeta «Cuenta» (D-NEXT). */}
      {hermanas.length <= 1 && (
        <nav className="mt-3 flex flex-wrap gap-1.5" aria-label={t("Store", "Tienda")} data-tiendas={1}>
          <span className="rounded-full border border-clay-200 bg-clay-50 px-3 py-1 text-xs font-medium text-clay-700">{nombreDeTienda(c.store)}</span>
        </nav>
      )}
      {hermanas.length > 1 && (
        <nav className="mt-3 flex flex-wrap gap-1.5" aria-label={t("Stores of this company", "Tiendas de esta empresa")} data-tiendas={hermanas.length}>
          {hermanas.map((h) => (
            <Link
              key={h.id}
              href={`/customers/${h.id}`}
              aria-current={h.id === c.id ? "page" : undefined}
              className={h.id === c.id
                ? "rounded-full border border-clay-200 bg-clay-50 px-3 py-1 text-xs font-medium text-clay-700"
                : "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"}
            >
              {nombreDeTienda(h.store)}{hermanas.filter((x) => x.store === h.store).length > 1 ? ` · ${h.account}` : ""}
            </Link>
          ))}
        </nav>
      )}

      {(tel || mail) && (
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {tel && <a href={tel} className="text-clay-600 hover:underline">📞 {c.phone}</a>}
          {mail && <a href={mail} className="text-clay-600 hover:underline">✉️ {c.email}</a>}
        </div>
      )}

      <div className="mt-6">
        <TarjetasDeLaFicha cliente={c} t={t} />
      </div>
    </main>
  );
}
