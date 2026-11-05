"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { AlmacenDeClientes } from "@/lib/customers/almacen";
import type { TratosLeidos } from "@/lib/customers/tratos-de-la-base";
import { diaDeTexas, mezclaTratos, type FiltroDeTratos } from "@/lib/customers/tratos";
import { stageInfo, stageLabel } from "@/lib/constants";
import { fmtDateShort } from "@/lib/utils";

type T = (en: string, es: string) => string;

const dinero = (n: number | null): string => (n === null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * D-NEXT (245): el historial PRINCIPAL del cliente: sus órdenes de Entregas y sus cotizaciones del Quote Builder, lo más
 * nuevo primero, con filtro por tipo. Cada fila abre la orden o la cotización en su app. Lo que llega lo decide la RLS de
 * cada tabla con la sesión de quien mira. Estructura mínima (tabla y clases de siempre) para que el rediseño la vista.
 */
export function HistorialDeTratos({ cliente, almacen, t }: { cliente: { id: number; account: string }; almacen: AlmacenDeClientes; t: T }) {
  const [leido, setLeido] = useState<TratosLeidos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroDeTratos>("todo");
  useEffect(() => {
    let vivo = true;
    setLeido(null);
    setError(null);
    void almacen.tratos({ id: cliente.id, account: cliente.account }).then((r) => {
      if (!vivo) return;
      if (r.ok) setLeido(r.valor); else setError(r.error);
    });
    return () => { vivo = false; };
  }, [cliente.id, cliente.account, almacen]);
  const filas = useMemo(() => (leido ? mezclaTratos(leido.tratos.filter((x) => x.clase === "orden"), leido.tratos.filter((x) => x.clase === "cotizacion"), filtro) : []), [leido, filtro]);
  const cuantas = (c: "orden" | "cotizacion") => leido?.tratos.filter((x) => x.clase === c).length ?? 0;

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white px-5 py-3" data-historial-de-tratos>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">📦 {t("Orders & quotes", "Órdenes y cotizaciones")}</h2>
        <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label={t("Filter by type", "Filtrar por tipo")}>
          {([["todo", t("All", "Todo"), (leido?.tratos.length ?? 0)], ["orden", t("Orders", "Órdenes"), cuantas("orden")], ["cotizacion", t("Quotes", "Cotizaciones"), cuantas("cotizacion")]] as const).map(([k, rotulo, n]) => (
            <button key={k} type="button" aria-pressed={filtro === k} data-filtro-de-tratos={k} onClick={() => setFiltro(k)}
              className={filtro === k ? "chip on" : "chip"}>
              {rotulo} <span className="cnt">{n}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2">
        {error && <p className="text-xs text-red-600" role="status">{error}</p>}
        {!error && leido === null && <p className="text-xs text-slate-400">{t("Loading…", "Cargando…")}</p>}
        {leido && !leido.unidos && (
          <p className="text-xs text-slate-500" data-tratos-por-nombre>{t("Matched by account name (the order link is not active yet).", "Encontradas por el nombre de la cuenta (el enlace con las órdenes aún no está activo).")}</p>
        )}
        {leido && leido.fallan.length > 0 && (
          <p className="text-xs text-slate-500" role="status">
            {leido.fallan.includes("orden") && t("Orders are not available to you here. ", "Las órdenes no están disponibles para ti aquí. ")}
            {leido.fallan.includes("cotizacion") && t("Quotes are not available to you here.", "Las cotizaciones no están disponibles para ti aquí.")}
          </p>
        )}
        {leido && filas.length === 0 && <p className="text-xs text-slate-400">{t("Nothing recorded with this customer yet.", "Aún no hay nada con este cliente.")}</p>}
        {filas.length > 0 && (
          <div className="tbl-scroll">
            <table className="orders" data-filas-de-tratos>
              <thead>
                <tr>
                  <th>{t("Date", "Fecha")}</th>
                  <th>{t("Type", "Tipo")}</th>
                  <th>#</th>
                  <th>{t("Invoice", "Factura")}</th>
                  <th>{t("Status", "Estado")}</th>
                  <th>{t("Store", "Tienda")}</th>
                  <th>{t("Driver", "Chofer")}</th>
                  <th className="text-right">{t("Amount", "Monto")}</th>
                  <th className="text-right">{t("Pallets", "Tarimas")}</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((x) => (
                  <tr key={`${x.clase}-${x.id}`} data-trato={x.id} data-clase={x.clase}>
                    <td>{fmtDateShort(diaDeTexas(x.fecha), t("en", "es") as "en" | "es") || "—"}</td>
                    <td>{x.clase === "orden" ? `🚚 ${t("Order", "Orden")}` : `🧾 ${t("Quote", "Cotización")}`}</td>
                    <td><Link href={x.href} className="text-clay-600 hover:underline">{x.numero}</Link></td>
                    <td>{x.factura ?? "—"}</td>
                    <td>
                      {x.clase === "orden"
                        ? <span className="sema" style={{ background: stageInfo(x.estado).color, color: "#fff" }}>{t(stageLabel(x.estado, "en"), stageLabel(x.estado, "es"))}</span>
                        : x.estado === "printed" ? t("Printed", "Impresa") : t("Draft", "Borrador")}
                    </td>
                    <td>{x.tienda ?? "—"}</td>
                    <td>{x.chofer ?? "—"}</td>
                    <td className="text-right">{dinero(x.monto)}</td>
                    <td className="text-right">{x.tarimas ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
