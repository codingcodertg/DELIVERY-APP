"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { libreDe, siguiente } from "@/lib/app-draft/compfloor/logica";
import { NOMBRE_TIENDA, TIENDAS, type Tienda, type Traslado } from "@/lib/app-draft/compfloor/tipos";
import { Campo } from "../quickbooks-online/piezas";
import { SubSecciones, nuevoId } from "../quickbooks-online/comun";
import { SelectorArticulo, SelectorTienda, useCf, useDescribeLote } from "./comun";

type Sub = "bins" | "transfers";

/** Bins dentro de cada tienda, y traslados entre tiendas que SÍ mueven el stock: sale, viaja, entra. */
export function Almacen() {
  const { t } = usePrefs();
  const [sub, setSub] = useState<Sub>("bins");
  return (
    <section className="qbo-seccion">
      <SubSecciones<Sub> valor={sub} onCambia={setSub} opciones={[
        { clave: "bins", texto: t("Bins by store", "Bins por tienda") },
        { clave: "transfers", texto: t("Transfers between stores", "Traslados entre tiendas") },
      ]} />
      {sub === "bins" ? <Bins /> : <Traslados />}
    </section>
  );
}

function Bins() {
  const { t } = usePrefs();
  const { e, d } = useCf();
  const [tienda, setTienda] = useState<Tienda>("mca");
  const [nuevo, setNuevo] = useState("");
  const filas = e.existencias.filter((x) => x.tienda === tienda && x.cajas > 0);
  return (
    <div className="qbo-form">
      <div className="qbo-barra">
        <SelectorTienda valor={tienda} onCambia={(s) => setTienda((s || "mca") as Tienda)} />
        <input value={nuevo} onChange={(ev) => setNuevo(ev.target.value)} placeholder={t("New bin, e.g. F-02", "Bin nuevo, p. ej. F-02")} aria-label={t("New bin", "Bin nuevo")} style={{ maxWidth: 180 }} />
        <button type="button" className="btn btn-sm btn-ghost" disabled={!nuevo.trim()} onClick={() => { d({ tipo: "agregarBin", tienda, bin: nuevo }); setNuevo(""); }}>+ {t("Add bin", "Agregar bin")}</button>
      </div>
      <div className="qbo-dos">
        {e.bins[tienda].map((b) => {
          const aqui = filas.filter((x) => x.bin === b);
          return (
            <div key={b} className="qbo-caja" data-bin={b}>
              <h2>Bin {b}</h2>
              {aqui.length === 0 && <p className="qbo-gris">{t("Empty", "Vacío")}</p>}
              {aqui.map((x) => (
                <div key={x.id} className="qbo-renglon">
                  <span>{e.articulos.find((a) => a.id === x.articuloId)?.nombre} · {t("lot", "lote")} {x.lote} · <b>{x.cajas}</b></span>
                  <select aria-label={t("Move to bin", "Mover a bin")} value={x.bin} onChange={(ev) => d({ tipo: "moverBin", existenciaId: x.id, bin: ev.target.value })}>
                    {e.bins[tienda].map((o) => <option key={o} value={o}>{o === x.bin ? o : `→ ${o}`}</option>)}
                  </select>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Traslados() {
  const { t } = usePrefs();
  const { e, d, hoy, reservado } = useCf();
  const desc = useDescribeLote();
  const [articuloId, setArticuloId] = useState("");
  const [origenId, setOrigenId] = useState("");
  const [hacia, setHacia] = useState<Tienda>("bro");
  const [cajas, setCajas] = useState(0);
  const [error, setError] = useState("");
  const origenes = e.existencias.filter((x) => x.articuloId === articuloId && x.cajas > 0 && !x.apartadoPara);
  const origen = origenes.find((x) => x.id === origenId);
  const libre = origen ? libreDe(origen, reservado) : 0;
  const mandar = () => {
    if (!origen || cajas <= 0) return setError(t("Choose product, lot and boxes.", "Elige producto, lote y cajas."));
    if (origen.tienda === hacia) return setError(t("Pick a different store.", "Elige otra tienda."));
    if (cajas > libre) return setError(t(`Only ${libre} boxes free in that lot.`, `Solo hay ${libre} cajas libres en ese lote.`));
    const tr: Traslado = { id: nuevoId("t"), numero: siguiente(e.traslados.map((y) => y.numero), "TR-", 301), existenciaOrigenId: origen.id, articuloId, lote: origen.lote, tono: origen.tono, desde: origen.tienda, hacia, binDestino: e.bins[hacia][0], cajas, fecha: hoy, recibido: false };
    d({ tipo: "mandarTraslado", traslado: tr });
    setCajas(0); setError("");
  };
  const columnas = useMemo<ColumnaEstandar<Traslado>[]>(() => [
    { key: "numero", en: "No.", es: "Núm.", ancho: 90, fija: true, valor: (x) => x.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 100, valor: (x) => x.fecha },
    { key: "producto", en: "Product", es: "Producto", ancho: 220, valor: (x) => e.articulos.find((a) => a.id === x.articuloId)?.nombre ?? "" },
    { key: "lote", en: "Lot / shade", es: "Lote / tono", ancho: 100, valor: (x) => `${x.lote} / ${x.tono}` },
    { key: "ruta", en: "From → to", es: "De → a", ancho: 190, valor: (x) => `${NOMBRE_TIENDA[x.desde]} → ${NOMBRE_TIENDA[x.hacia]}` },
    { key: "cajas", en: "Boxes", es: "Cajas", ancho: 80, numerico: true, valor: (x) => x.cajas },
    { key: "estado", en: "Status", es: "Estado", ancho: 190, valor: (x) => (x.recibido ? "in" : "transit"), etiqueta: (v) => (v === "in" ? t("Received", "Recibido") : t("In transit", "En camino")), celda: (x) => (x.recibido
      ? <span className="badge qbo-estado qbo-estado-closed">{t("Received", "Recibido")}</span>
      : <button type="button" className="btn btn-sm btn-green" data-accion="recibir-traslado" onClick={(ev) => { ev.stopPropagation(); d({ tipo: "recibirTraslado", id: x.id, nuevoId: nuevoId("x") }); }}>{t("In transit — receive", "En camino: recibir")}</button>) },
  ], [e, d, t]);
  return (
    <div className="qbo-form">
      <div className="qbo-caja">
        <h2>{t("Send boxes to another store", "Mandar cajas a otra tienda")}</h2>
        <div className="qbo-campos">
          <Campo etiqueta={t("Product", "Producto")}><SelectorArticulo valor={articuloId} onCambia={(id) => { setArticuloId(id); setOrigenId(""); }} /></Campo>
          <Campo etiqueta={t("From (store · lot)", "Desde (tienda · lote)")}>
            <select value={origenId} onChange={(ev) => setOrigenId(ev.target.value)} disabled={!articuloId}>
              <option value="">{t("Choose…", "Elige…")}</option>
              {origenes.map((x) => <option key={x.id} value={x.id}>{desc(x)} — {libreDe(x, reservado)} {t("free", "libres")}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("To store", "A la tienda")}>
            <select value={hacia} onChange={(ev) => setHacia(ev.target.value as Tienda)}>{TIENDAS.map((s) => <option key={s} value={s}>{NOMBRE_TIENDA[s]}</option>)}</select>
          </Campo>
          <Campo etiqueta={t("Boxes", "Cajas")}><input type="number" min={0} max={libre} value={cajas || ""} onChange={(ev) => setCajas(Math.floor(Number(ev.target.value) || 0))} /></Campo>
        </div>
        <p className="qbo-explica">{t("The boxes leave the first store now, show as “in transit”, and enter the other store (same lot and shade) when received.", "Las cajas salen de la primera tienda ya, se ven «en camino» y entran a la otra (mismo lote y tono) al recibirlas.")}</p>
        {error && <p className="qbo-error" role="alert">{error}</p>}
        <button type="button" className="btn btn-primary btn-sm" data-accion="mandar-traslado" onClick={mandar}>{t("Send", "Mandar")}</button>
      </div>
      <TablaEstandar id="app-draft-cf-traslados" filas={e.traslados} claveDe={(x) => x.id} columnas={columnas} ordenInicial={{ clave: "fecha", direccion: "desc" }} vacio={t("No transfers yet.", "Todavía no hay traslados.")} />
    </div>
  );
}
