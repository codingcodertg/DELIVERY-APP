"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { buscarLotes, convertir, libreDe, r2 } from "@/lib/app-draft/compfloor/logica";
import { NOMBRE_TIENDA, type Tienda, type Unidad } from "@/lib/app-draft/compfloor/tipos";
import { Campo } from "../quickbooks-online/piezas";
import { Equivalencias, SelectorArticulo, SelectorTienda, useCf, useDescribeLote } from "./comun";
import { EntradaCantidad } from "./piezas";

/** Stock por lote y tono: la consulta de mostrador «¿hay N de un solo lote, y dónde?» y la lista completa. */
export function Existencias() {
  const { t } = usePrefs();
  const { e, reservado } = useCf();
  const filas = useMemo(() => e.existencias.filter((x) => x.cajas > 0).map((x) => {
    const a = e.articulos.find((y) => y.id === x.articuloId)!;
    return { ...x, sku: a.sku, producto: a.nombre, apartado: reservado[x.id] ?? 0, libre: libreDe(x, reservado), sqft: r2(x.cajas * a.sqftPorCaja), cliente: x.apartadoPara ? e.clientes.find((c) => c.id === x.apartadoPara)?.nombre ?? "" : "" };
  }), [e, reservado]);
  type F = (typeof filas)[number];
  const columnas = useMemo<ColumnaEstandar<F>[]>(() => [
    { key: "producto", en: "Product", es: "Producto", ancho: 240, fija: true, valor: (f) => f.producto, celda: (f) => <span>{f.producto} <span className="qbo-gris">{f.sku}</span></span> },
    { key: "tienda", en: "Store", es: "Tienda", ancho: 110, valor: (f) => NOMBRE_TIENDA[f.tienda] },
    { key: "lote", en: "Lot", es: "Lote", ancho: 80, valor: (f) => f.lote },
    { key: "tono", en: "Shade", es: "Tono", ancho: 80, valor: (f) => f.tono },
    { key: "bin", en: "Bin", es: "Bin", ancho: 70, valor: (f) => f.bin },
    { key: "cajas", en: "On shelf (boxes)", es: "En estante (cajas)", ancho: 120, numerico: true, valor: (f) => f.cajas },
    { key: "apartado", en: "Held for orders", es: "Apartado", ancho: 110, numerico: true, valor: (f) => f.apartado },
    { key: "libre", en: "Free to sell", es: "Libre", ancho: 100, numerico: true, valor: (f) => f.libre, celda: (f) => <b>{f.libre}</b> },
    { key: "sqft", en: "Sq ft", es: "Pies²", ancho: 90, numerico: true, valor: (f) => f.sqft },
    { key: "nota", en: "Note", es: "Nota", ancho: 200, valor: (f) => (f.remanentePct ? `remnant -${f.remanentePct}%` : f.cliente), celda: (f) => (f.remanentePct ? <span className="badge qbo-estado qbo-estado-partial">{t("Remnant", "Remanente")} −{f.remanentePct}%</span> : f.cliente ? <span className="qbo-gris">{t("Set aside for", "Apartado para")} {f.cliente}</span> : null) },
  ], [t]);
  return (
    <section className="qbo-seccion">
      <Consulta />
      <TablaEstandar id="app-draft-cf-stock" filas={filas} claveDe={(f) => f.id} columnas={columnas} ordenInicial={{ clave: "producto", direccion: "asc" }} vacio={t("No stock.", "No hay stock.")} />
    </section>
  );
}

function Consulta() {
  const { t } = usePrefs();
  const { e } = useCf();
  const desc = useDescribeLote();
  const [articuloId, setArticuloId] = useState("a-trav");
  const [cantidad, setCantidad] = useState(500);
  const [unidad, setUnidad] = useState<Unidad>("sqft");
  const [tienda, setTienda] = useState<Tienda | "">("mca");
  const a = e.articulos.find((x) => x.id === articuloId);
  const cajas = a ? convertir(a, cantidad, unidad).cajas : 0;
  const filas = a ? buscarLotes(e, a.id, cajas, tienda || null) : [];
  const alguno = filas.some((f) => f.alcanza);
  return (
    <div className="qbo-caja" data-consulta-lote>
      <h2>{t("Is there enough of ONE lot for this job?", "¿Alcanza UN solo lote para este trabajo?")}</h2>
      <div className="qbo-campos">
        <Campo etiqueta={t("Product", "Producto")}><SelectorArticulo valor={articuloId} onCambia={setArticuloId} /></Campo>
        <Campo etiqueta={t("How much", "Cuánto")}><EntradaCantidad a={a} cantidad={cantidad} unidad={unidad} onCambia={(c, u) => { setCantidad(c); setUnidad(u); }} /></Campo>
        <Campo etiqueta={t("Customer's store", "Tienda del cliente")}><SelectorTienda valor={tienda} onCambia={setTienda} todas /></Campo>
      </div>
      {a && cajas > 0 && (
        <div className="qbo-lista" style={{ marginTop: 10 }}>
          <p className="qbo-explica">{t("Needs", "Necesita")} <Equivalencias a={a} cajas={cajas} /></p>
          {!alguno && <p className="cf-aviso qbo-rojo" role="alert">{t("No single lot has enough. Mixing lots means the colors won't match — order more of one lot, or transfer between stores.", "Ningún lote alcanza solo. Mezclar lotes hace que el color no combine: pide más de un lote o traslada entre tiendas.")}</p>}
          {filas.length === 0 && <p className="qbo-gris">{t("None in stock anywhere.", "No hay en ninguna tienda.")}</p>}
          {filas.map((f) => (
            <div key={f.existencia.id} className="qbo-renglon" data-lote={f.existencia.lote} data-alcanza={f.alcanza ? "si" : "no"}>
              <span>{f.alcanza ? <b className="qbo-verde">✓ </b> : <span className="qbo-gris">✗ </span>}{desc(f.existencia)}</span>
              <span className="qbo-num">{f.libre} {t("free", "libres")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
