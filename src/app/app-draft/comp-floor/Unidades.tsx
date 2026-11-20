"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { convertir, r2 } from "@/lib/app-draft/compfloor/logica";
import type { Articulo, Unidad } from "@/lib/app-draft/compfloor/tipos";
import { Campo } from "../quickbooks-online/piezas";
import { dinero } from "../quickbooks-online/comun";
import { SelectorArticulo, useCf, useTextos } from "./comun";
import { EntradaCantidad } from "./piezas";

/** Unidades: cada producto se vende por caja, pie² o pieza; escribe cualquiera y ves las otras, en cajas enteras. */
export function Unidades() {
  const { t } = usePrefs();
  const { e } = useCf();
  const x = useTextos();
  const [articuloId, setArticuloId] = useState("a-trav");
  const [cantidad, setCantidad] = useState(200);
  const [unidad, setUnidad] = useState<Unidad>("sqft");
  const a = e.articulos.find((y) => y.id === articuloId);
  const c = a ? convertir(a, cantidad, unidad) : null;
  const columnas = useMemo<ColumnaEstandar<Articulo>[]>(() => [
    { key: "nombre", en: "Product", es: "Producto", ancho: 260, fija: true, valor: (f) => f.nombre },
    { key: "sku", en: "SKU", es: "SKU", ancho: 100, valor: (f) => f.sku },
    { key: "regla", en: "1 box =", es: "1 caja =", ancho: 200, valor: (f) => f.sqftPorCaja, celda: (f) => <span>{f.sqftPorCaja > 0 ? `${f.sqftPorCaja} ${x.unidad("sqft")} = ` : ""}{f.piezasPorCaja} {x.unidad("pc", f.piezasPorCaja)}</span> },
    { key: "vende", en: "Usually quoted in", es: "Se cotiza en", ancho: 130, valor: (f) => x.unidad(f.unidadVenta) },
    { key: "caja", en: "Price / box", es: "Precio / caja", ancho: 110, numerico: true, valor: (f) => f.precioCaja, celda: (f) => dinero(f.precioCaja) },
    { key: "sqft", en: "Price / sq ft", es: "Precio / pie²", ancho: 110, numerico: true, valor: (f) => (f.sqftPorCaja ? r2(f.precioCaja / f.sqftPorCaja) : 0), celda: (f) => (f.sqftPorCaja ? dinero(f.precioCaja / f.sqftPorCaja) : "—") },
  ], [x]);
  return (
    <section className="qbo-seccion">
      <div className="qbo-caja" data-calculadora>
        <h2>{t("Type any unit — see the others", "Escribe cualquier unidad y ve las demás")}</h2>
        <div className="qbo-campos">
          <Campo etiqueta={t("Product", "Producto")}><SelectorArticulo valor={articuloId} onCambia={setArticuloId} /></Campo>
          <Campo etiqueta={t("Customer needs", "El cliente necesita")}><EntradaCantidad a={a} cantidad={cantidad} unidad={unidad} onCambia={(q, u) => { setCantidad(q); setUnidad(u); }} /></Campo>
        </div>
        {a && c && c.cajas > 0 && (
          <div className="qbo-kpis" style={{ marginTop: 10 }}>
            <div className="qbo-kpi"><span>{t("Sell (whole boxes)", "Vender (cajas enteras)")}</span><b data-cajas>{c.cajas} {x.unidad("box", c.cajas)}</b><small>{t("exact", "exacto")}: {c.exactas}</small></div>
            {a.sqftPorCaja > 0 && <div className="qbo-kpi"><span>{t("Covers", "Cubre")}</span><b data-sqft>{c.sqft} {x.unidad("sqft")}</b><small>{c.sobraSqft > 0 ? t(`${c.sobraSqft} sq ft extra for cuts`, `${c.sobraSqft} pies² extra para cortes`) : t("no leftover", "sin sobrante")}</small></div>}
            {a.piezasPorCaja > 1 && <div className="qbo-kpi"><span>{t("Pieces", "Piezas")}</span><b>{c.piezas}</b></div>}
            <div className="qbo-kpi"><span>{t("List price", "Precio de lista")}</span><b>{dinero(c.cajas * a.precioCaja)}</b></div>
          </div>
        )}
      </div>
      <TablaEstandar id="app-draft-cf-unidades" filas={e.articulos} claveDe={(f) => f.id} columnas={columnas} vacio={t("No products.", "No hay productos.")} />
    </section>
  );
}
