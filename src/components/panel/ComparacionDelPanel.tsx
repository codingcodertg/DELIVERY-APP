"use client";

// Comparar tiendas (o cuentas) del periodo (D-1127): una fila por tienda, ordenadas de más a menos órdenes, con una
// barra para ver la diferencia sin leer el número y, al lado, lo que explica cómo va cada una (a tiempo, canceladas,
// vencidas…). Es la tabla estándar: se ordena por cualquier columna desde su cabecera.
import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { dineroCorto, resumenPor, resumenDelPeriodo, type FilaDeGrupo } from "@/lib/panel-resumen";
import type { Delivery } from "@/lib/types";

/** «A tiempo» se marca cuando queda estos puntos (o más) por debajo del total: marcar a todas no le dice nada a nadie. */
const PUNTOS_BAJO_EL_TOTAL = 5;

export function ComparacionDelPanel({ ordenes, hoy, por, titulo, id, tope }: {
  ordenes: readonly Delivery[];
  hoy: string;
  por: "tienda" | "cuenta";
  titulo: string;
  /** Único: con él se guarda la vista de la tabla de cada persona. */
  id: string;
  /** Cuántas filas de entrada (el resto, con «Ver todas»). */
  tope?: number;
}) {
  const { lang, t } = usePrefs();
  const [todas, setTodas] = useState(false);
  const filas = useMemo(
    () => resumenPor(ordenes, (d) => (por === "tienda" ? d.store : d.account || d.delivery_name), hoy),
    [ordenes, por, hoy],
  );
  const total = useMemo(() => resumenDelPeriodo(ordenes, hoy), [ordenes, hoy]);
  const max = Math.max(1, ...filas.map((f) => f.ordenes));
  const vistas = tope && !todas ? filas.slice(0, tope) : filas;
  const num = (n: number, dec = 0) => n.toLocaleString(lang === "es" ? "es-MX" : "en-US", { maximumFractionDigits: dec });
  const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
  const bajo = (v: number | null) => v != null && total.aTiempoPct != null && v <= total.aTiempoPct - PUNTOS_BAJO_EL_TOTAL;
  const aTiempo = (v: number | null) => (
    <span className={bajo(v) ? "panel-bajo" : undefined} title={bajo(v) ? t(`${PUNTOS_BAJO_EL_TOTAL}+ points below the total (${pct(total.aTiempoPct)})`, `${PUNTOS_BAJO_EL_TOTAL} puntos o más por debajo del total (${pct(total.aTiempoPct)})`) : undefined}>{bajo(v) ? "▼ " : ""}{pct(v)}</span>
  );

  const columnas: ColumnaEstandar<FilaDeGrupo>[] = [
    { key: "nombre", en: por === "tienda" ? "Store" : "Account", es: por === "tienda" ? "Tienda" : "Cuenta", ancho: por === "tienda" ? 150 : 230, fija: true,
      valor: (f) => f.clave, celda: (f) => <strong>{por === "tienda" ? f.clave.replace(/^RDZ /, "") : f.clave}</strong> },
    { key: "ordenes", en: "Orders", es: "Órdenes", ancho: 180, numerico: true, valor: (f) => f.ordenes,
      celda: (f) => <span className="panel-barra-celda"><span className="riel"><i style={{ width: `${(f.ordenes / max) * 100}%` }} /></span><b>{num(f.ordenes)}</b></span> },
    { key: "entregadas", en: "Delivered", es: "Entregadas", ancho: 100, numerico: true, valor: (f) => f.entregadas },
    { key: "atiempo", en: "On time", es: "A tiempo", ancho: 90, numerico: true, valor: (f) => f.aTiempoPct, celda: (f) => aTiempo(f.aTiempoPct) },
    { key: "canceladas", en: "Canceled", es: "Canceladas", ancho: 100, numerico: true, valor: (f) => f.canceladasPct,
      celda: (f) => (f.canceladas ? <span title={t(`${f.canceladas} orders`, `${f.canceladas} órdenes`)}>{pct(f.canceladasPct)}</span> : "—") },
    { key: "abiertas", en: "Still open", es: "Sin terminar", ancho: 105, numerico: true, valor: (f) => f.abiertas, celda: (f) => f.abiertas || "—" },
    { key: "vencidas", en: "Past date", es: "Vencidas", ancho: 90, numerico: true, valor: (f) => f.vencidas, celda: (f) => (f.vencidas ? <span className="panel-bajo">{f.vencidas}</span> : "—") },
    { key: "ciclo", en: "Order → delivery", es: "Orden → entrega", ancho: 125, numerico: true, valor: (f) => f.cicloHoras, celda: (f) => (f.cicloHoras == null ? "—" : `${num(f.cicloHoras, 1)} h`) },
    { key: "pallets", en: "Pallets", es: "Pallets", ancho: 85, numerico: true, valor: (f) => f.pallets, celda: (f) => num(f.pallets, 1) },
    { key: "cobros", en: "Delivery fees", es: "Cobros", ancho: 110, numerico: true, valor: (f) => f.cobros, celda: (f) => dineroCorto(f.cobros, lang) },
    { key: "millas", en: "Miles", es: "Millas", ancho: 85, numerico: true, valor: (f) => f.millas, celda: (f) => num(f.millas, 1) },
  ];

  return (
    <div className="card" data-panel-comparacion={por}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0 }}>{titulo}</h3>
        {tope && filas.length > tope && (
          <button className="btn btn-ghost btn-sm" onClick={() => setTodas((v) => !v)}>{todas ? t(`Top ${tope} only`, `Solo las ${tope} primeras`) : t(`See all ${filas.length}`, `Ver las ${filas.length}`)}</button>
        )}
      </div>
      {!filas.length ? <div className="empty">{t("No orders in this range.", "Sin órdenes en este rango.")}</div> : (
        <TablaEstandar id={id} sinCaja data-tabla={id} filas={vistas} claveDe={(f) => f.clave} columnas={columnas}
          totales={{
            nombre: t("Total", "Total"),
            ordenes: <strong>{num(total.ordenes)}</strong>,
            entregadas: <strong>{num(total.entregadas)}</strong>,
            atiempo: <strong>{pct(total.aTiempoPct)}</strong>,
            canceladas: <strong>{pct(total.canceladasPct)}</strong>,
            abiertas: <strong>{num(total.abiertas)}</strong>,
            vencidas: <strong>{num(total.vencidas)}</strong>,
            ciclo: <strong>{total.cicloHoras == null ? "—" : `${num(total.cicloHoras, 1)} h`}</strong>,
            pallets: <strong>{num(total.pallets, 1)}</strong>,
            cobros: <strong>{dineroCorto(total.cobros, lang)}</strong>,
            millas: <strong>{num(total.millas, 1)}</strong>,
          }} />
      )}
    </div>
  );
}
