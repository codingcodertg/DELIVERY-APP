"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";
import {
  antiguedadPorCobrar, antiguedadPorPagar, balanceGeneral, estadoDeResultados, inicioDeMes, sumaDias, ventasPorArticulo,
  ventasPorCliente, type LineaDeInforme,
} from "@/lib/app-draft/qbo/contabilidad";
import { BotonExportar, SubSecciones, dinero, useQbo } from "./comun";
import { Campo } from "./piezas";
import { columnasDeAntiguedad, totalesDeAntiguedad } from "./Clientes";

type Informe = "pl" | "bs" | "ar" | "ap" | "byCustomer" | "byItem";

interface Fila { id: string; seccion: string; concepto: string; monto: number; total?: boolean }

/** Informes: ganancias y pérdidas, balance, antigüedad por cobrar y por pagar, ventas por cliente y por artículo. */
export function Informes() {
  const { t, lang } = usePrefs();
  const { e, hoy, libro } = useQbo();
  const [inf, setInf] = useState<Informe>("pl");
  const [desde, setDesde] = useState(inicioDeMes(sumaDias(hoy, -60)));
  const [hasta, setHasta] = useState(hoy);
  const nombre = (l: LineaDeInforme) => (lang === "es" ? l.nombre_es : l.nombre_en);

  const filasPl = useMemo<Fila[]>(() => {
    const r = estadoDeResultados(e, libro, desde, hasta);
    const sec = (s: string, ls: LineaDeInforme[]) => ls.map((l) => ({ id: `${s}-${l.cuentaId}`, seccion: s, concepto: nombre(l), monto: l.monto }));
    return [
      ...sec(t("Income", "Ingresos"), r.ingresos), { id: "ti", seccion: t("Income", "Ingresos"), concepto: t("Total income", "Total de ingresos"), monto: r.totalIngresos, total: true },
      ...sec(t("Cost of goods sold", "Costo de lo vendido"), r.costo), { id: "gb", seccion: "", concepto: t("Gross profit", "Utilidad bruta"), monto: r.bruta, total: true },
      ...sec(t("Expenses", "Gastos"), r.gastos), { id: "tg", seccion: t("Expenses", "Gastos"), concepto: t("Total expenses", "Total de gastos"), monto: r.totalGastos, total: true },
      { id: "neta", seccion: "", concepto: t("Net profit", "Utilidad neta"), monto: r.neta, total: true },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, libro, desde, hasta, lang]);

  const balance = useMemo(() => balanceGeneral(e, libro, hasta), [e, libro, hasta]);
  const filasBs = useMemo<Fila[]>(() => {
    const sec = (s: string, ls: LineaDeInforme[]) => ls.map((l) => ({ id: `${s}-${l.cuentaId}`, seccion: s, concepto: nombre(l), monto: l.monto }));
    return [
      ...sec(t("What we have (assets)", "Lo que tenemos (activos)"), balance.activos), { id: "ta", seccion: "", concepto: t("Total assets", "Total de activos"), monto: balance.totalActivos, total: true },
      ...sec(t("What we owe (liabilities)", "Lo que debemos (pasivos)"), balance.pasivos), { id: "tp", seccion: "", concepto: t("Total liabilities", "Total de pasivos"), monto: balance.totalPasivos, total: true },
      ...sec(t("Owner's stake (equity)", "Del dueño (capital)"), balance.capital),
      { id: "ut", seccion: t("Owner's stake (equity)", "Del dueño (capital)"), concepto: t("Profit to date", "Utilidad a la fecha"), monto: balance.utilidad },
      { id: "tc", seccion: "", concepto: t("Total equity", "Total de capital"), monto: balance.totalCapital, total: true },
      { id: "tpc", seccion: "", concepto: t("Liabilities + equity", "Pasivos + capital"), monto: Math.round((balance.totalPasivos + balance.totalCapital) * 100) / 100, total: true },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance, lang]);

  const colsSimple = useMemo<ColumnaEstandar<Fila>[]>(() => [
    { key: "seccion", en: "Section", es: "Sección", ancho: 210, valor: (f) => f.seccion },
    { key: "concepto", en: "Line", es: "Concepto", ancho: 280, fija: true, valor: (f) => f.concepto, celda: (f) => (f.total ? <b>{f.concepto}</b> : f.concepto) },
    { key: "monto", en: "Amount", es: "Monto", ancho: 140, numerico: true, valor: (f) => f.monto, celda: (f) => (f.total ? <b>{dinero(f.monto)}</b> : dinero(f.monto)) },
  ], []);

  const ar = useMemo(() => antiguedadPorCobrar(e, hasta), [e, hasta]);
  const ap = useMemo(() => antiguedadPorPagar(e, hasta), [e, hasta]);
  const colsAr = useMemo(() => columnasDeAntiguedad(t, ["Customer", "Cliente"]), [t]);
  const colsAp = useMemo(() => columnasDeAntiguedad(t, ["Vendor", "Proveedor"]), [t]);
  const porCliente = useMemo(() => ventasPorCliente(e, desde, hasta), [e, desde, hasta]);
  const porArticulo = useMemo(() => ventasPorArticulo(e, desde, hasta), [e, desde, hasta]);
  const colsCliente = useMemo<ColumnaEstandar<(typeof porCliente)[number]>[]>(() => [
    { key: "nombre", en: "Customer", es: "Cliente", ancho: 240, fija: true, valor: (f) => f.nombre },
    { key: "monto", en: "Sales (before tax)", es: "Ventas (sin impuesto)", ancho: 160, numerico: true, valor: (f) => f.monto, celda: (f) => dinero(f.monto) },
  ], []);
  const colsArticulo = useMemo<ColumnaEstandar<(typeof porArticulo)[number]>[]>(() => [
    { key: "sku", en: "SKU", es: "SKU", ancho: 130, valor: (f) => f.sku },
    { key: "nombre", en: "Product", es: "Producto", ancho: 280, fija: true, valor: (f) => f.nombre },
    { key: "cantidad", en: "Qty sold", es: "Cant. vendida", ancho: 120, numerico: true, valor: (f) => f.cantidad },
    { key: "monto", en: "Sales (before tax)", es: "Ventas (sin impuesto)", ancho: 160, numerico: true, valor: (f) => f.monto, celda: (f) => dinero(f.monto) },
  ], []);

  const usaRango = inf === "pl" || inf === "byCustomer" || inf === "byItem";
  const exportar = (): { cab: string[]; filas: () => ValorDeCelda[][] } => {
    const tramos = [t("Not due yet", "Aún no vence"), "1–30", "31–60", "61–90", "90+", "Total"];
    switch (inf) {
      case "pl": return { cab: [t("Section", "Sección"), t("Line", "Concepto"), t("Amount", "Monto")], filas: () => filasPl.map((f) => [f.seccion, f.concepto, f.monto]) };
      case "bs": return { cab: [t("Section", "Sección"), t("Line", "Concepto"), t("Amount", "Monto")], filas: () => filasBs.map((f) => [f.seccion, f.concepto, f.monto]) };
      case "ar": return { cab: [t("Customer", "Cliente"), ...tramos], filas: () => ar.map((f) => [f.nombre, f.current, f.d1_30, f.d31_60, f.d61_90, f.d90, f.total]) };
      case "ap": return { cab: [t("Vendor", "Proveedor"), ...tramos], filas: () => ap.map((f) => [f.nombre, f.current, f.d1_30, f.d31_60, f.d61_90, f.d90, f.total]) };
      case "byCustomer": return { cab: [t("Customer", "Cliente"), t("Sales", "Ventas")], filas: () => porCliente.map((f) => [f.nombre, f.monto]) };
      case "byItem": return { cab: ["SKU", t("Product", "Producto"), t("Qty", "Cant."), t("Sales", "Ventas")], filas: () => porArticulo.map((f) => [f.sku, f.nombre, f.cantidad, f.monto]) };
    }
  };
  const ex = exportar();
  const nombres: Record<Informe, string> = {
    pl: t("Profit and loss", "Ganancias y pérdidas"), bs: t("Balance sheet", "Balance general"), ar: t("A/R aging", "Antigüedad por cobrar"),
    ap: t("A/P aging", "Antigüedad por pagar"), byCustomer: t("Sales by customer", "Ventas por cliente"), byItem: t("Sales by product", "Ventas por producto"),
  };

  return (
    <section className="qbo-seccion">
      <SubSecciones valor={inf} onCambia={setInf} opciones={(Object.keys(nombres) as Informe[]).map((k) => ({ clave: k, texto: nombres[k] }))} />
      <div className="qbo-barra">
        {usaRango && <Campo etiqueta={t("From", "Desde")}><input type="date" value={desde} onChange={(ev) => setDesde(ev.target.value)} /></Campo>}
        <Campo etiqueta={usaRango ? t("To", "Hasta") : t("As of", "Al día")}><input type="date" value={hasta} onChange={(ev) => setHasta(ev.target.value)} /></Campo>
        <BotonExportar archivo={`${nombres[inf]} ${hasta}.xlsx`} hoja={nombres[inf]} cabeceras={ex.cab} filas={ex.filas} />
      </div>
      {inf === "pl" && <><p className="qbo-explica">{t("Sales minus costs minus expenses for the dates chosen.", "Ventas menos costos menos gastos en las fechas elegidas.")}</p>
        <TablaEstandar id="app-draft-qbo-inf-pl" filas={filasPl} claveDe={(f) => f.id} columnas={colsSimple} /></>}
      {inf === "bs" && <><p className="qbo-explica">{t("What the business has, what it owes, and what's left for the owner, on one date. Assets must equal liabilities + equity.", "Lo que tiene el negocio, lo que debe y lo que queda para el dueño, a una fecha. Activos debe ser igual a pasivos + capital.")} {balance.cuadra ? <span className="qbo-ok">✓ {t("Balanced", "Cuadra")}</span> : <span className="qbo-error">{t("Not balanced", "No cuadra")}</span>}</p>
        <TablaEstandar id="app-draft-qbo-inf-bs" filas={filasBs} claveDe={(f) => f.id} columnas={colsSimple} /></>}
      {inf === "ar" && <TablaEstandar id="app-draft-qbo-inf-ar" filas={ar} claveDe={(f) => f.id} columnas={colsAr} totales={totalesDeAntiguedad(ar)} vacio={t("Nobody owes us anything.", "Nadie nos debe nada.")} />}
      {inf === "ap" && <TablaEstandar id="app-draft-qbo-inf-ap" filas={ap} claveDe={(f) => f.id} columnas={colsAp} totales={totalesDeAntiguedad(ap)} vacio={t("We owe nothing.", "No debemos nada.")} />}
      {inf === "byCustomer" && <TablaEstandar id="app-draft-qbo-inf-clientes" filas={porCliente} claveDe={(f) => f.id} columnas={colsCliente} ordenInicial={{ clave: "monto", direccion: "desc" }}
        totales={{ nombre: "Total", monto: dinero(porCliente.reduce((a, f) => a + f.monto, 0)) }} vacio={t("No sales in these dates.", "Sin ventas en estas fechas.")} />}
      {inf === "byItem" && <TablaEstandar id="app-draft-qbo-inf-articulos" filas={porArticulo} claveDe={(f) => f.id} columnas={colsArticulo} ordenInicial={{ clave: "monto", direccion: "desc" }}
        totales={{ nombre: "Total", monto: dinero(porArticulo.reduce((a, f) => a + f.monto, 0)) }} vacio={t("No sales in these dates.", "Sin ventas en estas fechas.")} />}
    </section>
  );
}
