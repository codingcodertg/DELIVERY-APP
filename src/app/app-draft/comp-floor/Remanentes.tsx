"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { libreDe, precioPara } from "@/lib/app-draft/compfloor/logica";
import { NOMBRE_TIENDA, type Existencia } from "@/lib/app-draft/compfloor/tipos";
import { dinero } from "../quickbooks-online/comun";
import { useCf } from "./comun";

/** Remanentes / lotes sueltos: marca lo que sobró de un lote con un descuento para venderlo en vez de perderlo. */
export function Remanentes() {
  const { t } = usePrefs();
  const { e, d, reservado } = useCf();
  const [soloRemanentes, setSoloRemanentes] = useState(false);
  const filas = useMemo(() => e.existencias.filter((x) => x.cajas > 0 && !x.apartadoPara && (!soloRemanentes || x.remanentePct)), [e, soloRemanentes]);
  const columnas = useMemo<ColumnaEstandar<Existencia>[]>(() => [
    { key: "producto", en: "Product", es: "Producto", ancho: 230, fija: true, valor: (x) => e.articulos.find((a) => a.id === x.articuloId)?.nombre ?? "" },
    { key: "donde", en: "Store · lot · shade", es: "Tienda · lote · tono", ancho: 200, valor: (x) => `${NOMBRE_TIENDA[x.tienda]} · ${x.lote} · ${x.tono}` },
    { key: "libre", en: "Boxes free", es: "Cajas libres", ancho: 100, numerico: true, valor: (x) => libreDe(x, reservado) },
    { key: "pct", en: "Remnant discount", es: "Descuento remanente", ancho: 170, valor: (x) => x.remanentePct ?? 0, celda: (x) => (
      <select aria-label={t("Remnant discount", "Descuento remanente")} value={x.remanentePct ?? 0} onClick={(ev) => ev.stopPropagation()} onChange={(ev) => d({ tipo: "remanente", existenciaId: x.id, pct: Number(ev.target.value) || null })}>
        <option value={0}>{t("Not a remnant", "No es remanente")}</option>
        {[10, 20, 25, 30, 40, 50].map((p) => <option key={p} value={p}>−{p}%</option>)}
      </select>
    ) },
    { key: "precio", en: "Retail price / box", es: "Precio menudeo / caja", ancho: 150, numerico: true, valor: (x) => { const a = e.articulos.find((y) => y.id === x.articuloId); return a ? precioPara(a, null, e.niveles, x).precio : 0; }, celda: (x) => { const a = e.articulos.find((y) => y.id === x.articuloId); return a ? dinero(precioPara(a, null, e.niveles, x).precio) : "—"; } },
  ], [e, d, reservado, t]);
  return (
    <section className="qbo-seccion">
      <p className="qbo-nota">{t("A few boxes left from an old lot can't finish a big job, but they can sell as a closeout. Pick a discount and the price drops everywhere that lot is sold (counter, quotes, labels).", "Unas cuantas cajas de un lote viejo no alcanzan para un trabajo grande, pero se pueden vender en liquidación. Elige un descuento y el precio baja en todos lados donde se vende ese lote (mostrador, cotizaciones, etiquetas).")}</p>
      <label className="cf-check"><input type="checkbox" checked={soloRemanentes} onChange={(ev) => setSoloRemanentes(ev.target.checked)} /> {t("Show remnants only", "Solo remanentes")}</label>
      <TablaEstandar id="app-draft-cf-remanentes" filas={filas} claveDe={(x) => x.id} columnas={columnas} vacio={t("No remnants tagged yet.", "Todavía no hay remanentes marcados.")} />
    </section>
  );
}
