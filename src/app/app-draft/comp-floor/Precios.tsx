"use client";

import { useMemo } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { precioPara } from "@/lib/app-draft/compfloor/logica";
import type { Articulo, NivelDePrecio, TipoCliente } from "@/lib/app-draft/compfloor/tipos";
import { Campo } from "../quickbooks-online/piezas";
import { dinero } from "../quickbooks-online/comun";
import { useCf, useTextos } from "./comun";

const TIPOS: TipoCliente[] = ["retail", "contractor", "dealer"];

/** Niveles de precio: cada tipo de cliente tiene un % sobre lista o precios fijos por producto. */
export function Precios() {
  const { t } = usePrefs();
  const { e, d } = useCf();
  const x = useTextos();
  const columnas = useMemo<ColumnaEstandar<Articulo>[]>(() => [
    { key: "nombre", en: "Product", es: "Producto", ancho: 250, fija: true, valor: (a) => a.nombre },
    ...TIPOS.map((tipo): ColumnaEstandar<Articulo> => ({
      key: tipo, en: `${tipo === "retail" ? "Retail" : tipo === "contractor" ? "Contractor" : "Dealer"} / box`, es: `${tipo === "retail" ? "Menudeo" : tipo === "contractor" ? "Contratista" : "Distribuidor"} / caja`,
      ancho: 150, numerico: true, valor: (a) => precioPara(a, tipo, e.niveles).precio,
      celda: (a) => { const p = precioPara(a, tipo, e.niveles); return <span>{dinero(p.precio)}{p.regla === "fixed" && <span className="qbo-gris"> ({t("fixed", "fijo")})</span>}</span>; },
    })),
  ], [e, t]);
  const pon = (n: NivelDePrecio) => d({ tipo: "guardarNivel", nivel: n });
  return (
    <section className="qbo-seccion">
      <p className="qbo-nota">{t("Set it once per customer type; every quote, order, counter sale and label then shows the right price by itself, with the rule it used.", "Se pone una vez por tipo de cliente; cada cotización, pedido, venta y etiqueta enseña el precio correcto sola, con la regla que usó.")}</p>
      <div className="qbo-dos">
        {e.niveles.map((n) => (
          <div key={n.tipo} className="qbo-caja" data-nivel={n.tipo}>
            <h2>{x.tipo(n.tipo)}</h2>
            <div className="qbo-form">
              <Campo etiqueta={t("% off list price", "% de descuento sobre lista")}>
                <input type="number" min={0} max={90} inputMode="decimal" value={n.descuentoPct || ""} placeholder="0" onChange={(ev) => pon({ ...n, descuentoPct: Math.min(90, Math.max(0, Number(ev.target.value) || 0)) })} />
              </Campo>
              <span className="qbo-explica">{t("Fixed price per box (overrides the %):", "Precio fijo por caja (gana sobre el %):")}</span>
              {Object.entries(n.fijos).map(([id, precio]) => (
                <div key={id} className="qbo-renglon">
                  <span>{e.articulos.find((a) => a.id === id)?.nombre}: <b>{dinero(precio)}</b></span>
                  <button type="button" className="btn btn-sm btn-ghost" aria-label={t("Remove", "Quitar")} onClick={() => { const f = { ...n.fijos }; delete f[id]; pon({ ...n, fijos: f }); }}>✕</button>
                </div>
              ))}
              <select value="" aria-label={t("Add a fixed price", "Agregar precio fijo")} onChange={(ev) => {
                const a = e.articulos.find((y) => y.id === ev.target.value);
                if (!a) return;
                const v = window.prompt(t(`Fixed price per box for ${a.nombre}`, `Precio fijo por caja para ${a.nombre}`), String(precioPara(a, n.tipo, e.niveles).precio));
                const num = Number(v);
                if (v != null && num > 0) pon({ ...n, fijos: { ...n.fijos, [a.id]: Math.round(num * 100) / 100 } });
              }}>
                <option value="">+ {t("Add a fixed price…", "Agregar precio fijo…")}</option>
                {e.articulos.filter((a) => n.fijos[a.id] == null).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>
      <TablaEstandar id="app-draft-cf-precios" filas={e.articulos} claveDe={(a) => a.id} columnas={columnas} vacio={t("No products.", "No hay productos.")} />
    </section>
  );
}
