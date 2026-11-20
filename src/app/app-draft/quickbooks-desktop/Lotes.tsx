"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { caducanPronto, existenciasLibres, sugerirTomas } from "@/lib/app-draft/qbd/inventario";
import { dinero } from "../quickbooks-online/comun";
import { Campo } from "../quickbooks-online/piezas";
import { Insignia, etiqueta, useN, useQbd } from "./comun";

/** Lotes y caducidad: qué se vence en 30/60/90 días y qué lote tomar primero al surtir. */
export function Lotes() {
  const { t } = usePrefs();
  const { e, hoy } = useQbd();
  const n = useN();
  const [dias, setDias] = useState(90);
  const [sitioId, setSitio] = useState("");
  const todas = useMemo(() => caducanPronto(e.existencias, hoy, 90), [e.existencias, hoy]);
  const filas = useMemo(() => todas.filter((x) => x.dias <= dias && (!sitioId || x.sitioId === sitioId)).map((x) => ({
    ...x, nombre: n.articulo(x.articuloId), sitio: n.sitio(x.sitioId), binTxt: n.bin(x.binId), valor: x.cantidad * x.costo,
  })), [todas, dias, sitioId, n]);
  const cuenta = (k: string) => todas.filter((x) => x.tramo === k && (!sitioId || x.sitioId === sitioId));
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "lote", en: "Lot", es: "Lote", ancho: 140, fija: true, valor: (x) => x.lote ?? "—" },
    { key: "nombre", en: "Product", es: "Producto", ancho: 230, valor: (x) => x.nombre },
    { key: "sitio", en: "Site", es: "Sitio", ancho: 170, valor: (x) => x.sitio },
    { key: "binTxt", en: "Bin", es: "Ubicación", ancho: 120, valor: (x) => x.binTxt },
    { key: "caduca", en: "Expires", es: "Caduca", ancho: 105, valor: (x) => x.caduca },
    { key: "dias", en: "Days left", es: "Días", ancho: 80, numerico: true, valor: (x) => x.dias },
    { key: "tramo", en: "Window", es: "Plazo", ancho: 140, valor: (x) => x.tramo, etiqueta: (v) => etiqueta(String(v), t), celda: (x) => <Insignia estado={x.tramo} /> },
    { key: "cantidad", en: "Qty", es: "Cant.", ancho: 100, numerico: true, valor: (x) => x.cantidad, celda: (x) => n.cant(x.articuloId, x.cantidad) },
    { key: "valor", en: "Cost value", es: "Valor al costo", ancho: 110, numerico: true, valor: (x) => x.valor, celda: (x) => dinero(x.valor) },
  ], [n, t]);
  return (
    <section className="qbo-seccion">
      <p className="qbo-explica">{t("Thinset, grout and waterproofing are received by lot with an expiration date. This report shows what expires soon so it can be sold, moved to a busier store, or pulled before it goes bad.",
        "El thinset, la boquilla y el impermeabilizante se reciben por lote con fecha de caducidad. Este informe enseña lo que se vence pronto para venderlo, mandarlo a una tienda con más salida o retirarlo antes de que se eche a perder.")}</p>
      <div className="qbo-kpis">
        {(["expired", "d30", "d60", "d90"] as const).map((k) => {
          const xs = cuenta(k);
          return (
            <div key={k} className={`qbo-kpi${k === "expired" || k === "d30" ? " qbo-kpi-alerta" : ""}`} data-tramo={k}>
              <span>{etiqueta(k, t)}</span><b>{xs.length} {t("lots", "lotes")}</b><small>{dinero(xs.reduce((a, x) => a + x.cantidad * x.costo, 0))} {t("at cost", "al costo")}</small>
            </div>
          );
        })}
      </div>
      <div className="qbo-barra">
        <div className="qbo-sub" role="group" aria-label={t("Window", "Plazo")}>
          {[30, 60, 90].map((v) => <button key={v} type="button" aria-pressed={dias === v} data-dias={v} onClick={() => setDias(v)}>{t(`Next ${v} days`, `Próximos ${v} días`)}</button>)}
        </div>
        <select value={sitioId} aria-label={t("Site", "Sitio")} onChange={(ev) => setSitio(ev.target.value)} style={{ maxWidth: 240 }}>
          <option value="">{t("All sites", "Todos los sitios")}</option>
          {e.sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>
      <TablaEstandar id="app-draft-qbd-caducidad" filas={filas} claveDe={(x) => x.id} columnas={columnas} ordenInicial={{ clave: "dias", direccion: "asc" }}
        vacio={t("Nothing expires in this window. 🎉", "Nada se vence en este plazo. 🎉")} />
      <Fifo />
    </section>
  );
}

/** Probador: para N unidades de un producto en un sitio, qué lotes y ubicaciones conviene tomar. */
function Fifo() {
  const { t } = usePrefs();
  const { e, hoy } = useQbd();
  const n = useN();
  const conLote = e.fichas.filter((f) => f.conLote).map((f) => f.articuloId);
  const [articuloId, setArticulo] = useState(conLote[0] ?? "");
  const [sitioId, setSitio] = useState("s-cen");
  const [cantidad, setCantidad] = useState(20);
  const libres = useMemo(() => existenciasLibres(e), [e]);
  const s = sugerirTomas(libres, articuloId, sitioId, cantidad, hoy);
  const caducadas = libres.filter((x) => x.articuloId === articuloId && x.sitioId === sitioId && x.caduca && x.caduca < hoy);
  return (
    <div className="qbo-caja" data-caja="fifo">
      <h2>{t("Which lot should I take?", "¿Qué lote tomo?")}</h2>
      <p className="qbo-explica">{t("The lot that expires first goes out first; expired lots are skipped. Pick lists use the same rule.", "Sale primero el lote que caduca antes; los caducados se saltan. Las listas de surtido usan la misma regla.")}</p>
      <div className="qbo-campos">
        <Campo etiqueta={t("Product", "Producto")}>
          <select value={articuloId} onChange={(ev) => setArticulo(ev.target.value)}>{conLote.map((id) => <option key={id} value={id}>{n.articulo(id)}</option>)}</select>
        </Campo>
        <Campo etiqueta={t("Site", "Sitio")}>
          <select value={sitioId} onChange={(ev) => setSitio(ev.target.value)}>{e.sitios.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
        </Campo>
        <Campo etiqueta={`${t("Quantity", "Cantidad")} (${n.unidad(n.base(articuloId))})`}>
          <input type="number" min={1} value={cantidad || ""} onChange={(ev) => setCantidad(Math.floor(Number(ev.target.value) || 0))} />
        </Campo>
      </div>
      <div className="qbo-lista" data-lista="fifo">
        {s.tomas.map((tm, i) => {
          const x = e.existencias.find((y) => y.id === tm.existenciaId)!;
          return (
            <div key={tm.existenciaId} className="qbo-renglon">
              <span><b>{i + 1}.</b> {t("Lot", "Lote")} {x.lote} · {t("expires", "caduca")} {x.caduca} · {n.bin(x.binId)}</span>
              <span className="qbo-num">{n.cant(x.articuloId, tm.cantidad)}</span>
            </div>
          );
        })}
        {!s.tomas.length && <p className="qbo-gris">{t("No usable stock of this product here.", "No hay existencia utilizable de este producto aquí.")}</p>}
      </div>
      {s.falta > 0 && <p className="qbo-error">{t(`Short by ${s.falta}.`, `Faltan ${s.falta}.`)}</p>}
      {caducadas.length > 0 && <p className="qbo-explica">{t("Skipped (expired)", "Saltado (caducado)")}: {caducadas.map((x) => `${x.lote} (${x.cantidad})`).join(", ")}</p>}
    </div>
  );
}
