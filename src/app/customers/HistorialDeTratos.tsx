"use client";

import { mensajeDeErrorAlCargar } from "@/lib/mensaje-de-error";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { AlmacenDeClientes } from "@/lib/customers/almacen";
import type { TratosLeidos } from "@/lib/customers/tratos-de-la-base";
import { diaDeTexas, mezclaTratos, type FiltroDeTratos, type Trato } from "@/lib/customers/tratos";
import { stageInfo, stageLabel } from "@/lib/constants";
import { fmtDateShort } from "@/lib/utils";
import { TablaEstandar } from "@/components/TablaEstandar";

type T = (en: string, es: string) => string;

// D-879: la tarjeta (con la ficha de Entregas y su proveedor) baja solo cuando alguien abre una fila.
const TarjetaDeTrato = dynamic(() => import("./TarjetaDeTrato").then((m) => m.TarjetaDeTrato));

const dinero = (n: number | null): string => (n === null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * D-874 (245): el historial PRINCIPAL del cliente: sus órdenes de Entregas y sus cotizaciones del Quote Builder, lo más
 * nuevo primero, con filtro por tipo. Cada fila abre la orden o la cotización AQUÍ, en una tarjeta (D-879, `TarjetaDeTrato`);
 * el enlace a su app queda dentro, como acción secundaria. Lo que llega lo decide la RLS de
 * cada tabla con la sesión de quien mira. Estructura mínima (tabla y clases de siempre) para que el rediseño la vista.
 */
export function HistorialDeTratos({ cliente, almacen, t }: { cliente: { id: number; account: string }; almacen: AlmacenDeClientes; t: T }) {
  const idioma = t("en", "es") as "en" | "es";
  const [leido, setLeido] = useState<TratosLeidos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroDeTratos>("todo");
  const [abierto, setAbierto] = useState<Trato | null>(null);
  // Al cerrar la tarjeta se vuelve a leer: lo que se cambió en la ficha (etapa, factura…) sale en la fila.
  const [lectura, setLectura] = useState(0);
  useEffect(() => {
    let vivo = true;
    if (lectura === 0) setLeido(null);
    setError(null);
    void almacen.tratos({ id: cliente.id, account: cliente.account }).then((r) => {
      if (!vivo) return;
      if (r.ok) setLeido(r.valor); else setError(mensajeDeErrorAlCargar(r.error));
    });
    return () => { vivo = false; };
  }, [cliente.id, cliente.account, almacen, lectura]);
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
          <TablaEstandar id="clientes-historial-de-tratos" data-tabla="filas-de-tratos" sinCaja filas={filas} claveDe={(x) => `${x.clase}-${x.id}`} onFila={(x) => setAbierto(x)}
            columnas={[
              { key: "fecha", en: "Date", es: "Fecha", ancho: 110, valor: (x) => diaDeTexas(x.fecha) || null,
                etiqueta: (v) => fmtDateShort(String(v ?? ""), idioma) || "—",
                celda: (x) => fmtDateShort(diaDeTexas(x.fecha), idioma) || "—" },
              { key: "tipo", en: "Type", es: "Tipo", ancho: 120, valor: (x) => (x.clase === "orden" ? t("Order", "Orden") : t("Quote", "Cotización")),
                celda: (x) => (x.clase === "orden" ? `🚚 ${t("Order", "Orden")}` : `🧾 ${t("Quote", "Cotización")}`) },
              { key: "numero", en: "#", es: "#", ancho: 110, fija: true, valor: (x) => String(x.numero),
                celda: (x) => (
                  <button type="button" className="text-clay-600 hover:underline" data-abre-trato onClick={(e) => { e.stopPropagation(); setAbierto(x); }}
                    aria-label={`${x.clase === "orden" ? t("Open order", "Abrir orden") : t("Open quote", "Abrir cotización")} ${x.numero}`}>{x.numero}</button>
                ) },
              { key: "factura", en: "Invoice", es: "Factura", ancho: 120, valor: (x) => x.factura ?? null },
              { key: "estado", en: "Status", es: "Estado", ancho: 130,
                valor: (x) => (x.clase === "orden" ? t(stageLabel(x.estado, "en"), stageLabel(x.estado, "es")) : x.estado === "printed" ? t("Printed", "Impresa") : t("Draft", "Borrador")),
                celda: (x) => (x.clase === "orden"
                  ? <span className="sema" style={{ background: stageInfo(x.estado).color, color: "#fff" }}>{t(stageLabel(x.estado, "en"), stageLabel(x.estado, "es"))}</span>
                  : x.estado === "printed" ? t("Printed", "Impresa") : t("Draft", "Borrador")) },
              { key: "tienda", en: "Store", es: "Tienda", ancho: 130, valor: (x) => x.tienda ?? null },
              { key: "chofer", en: "Driver", es: "Chofer", ancho: 130, valor: (x) => x.chofer ?? null },
              { key: "monto", en: "Amount", es: "Monto", ancho: 110, numerico: true, valor: (x) => x.monto ?? null, celda: (x) => dinero(x.monto) },
              { key: "tarimas", en: "Pallets", es: "Tarimas", ancho: 90, numerico: true, valor: (x) => x.tarimas ?? null },
            ]} />
        )}
      </div>
      {abierto && <TarjetaDeTrato trato={abierto} onCerrar={() => { setAbierto(null); setLectura((n) => n + 1); }} />}
    </section>
  );
}
