"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { aBase, deBase } from "@/lib/app-draft/qbd/inventario";
import { Campo } from "../quickbooks-online/piezas";
import { useN, useQbd } from "./comun";

/** Juegos de unidades (caja / ft² / pieza / tarima) con la unidad por defecto en compras, ventas y envíos. */
export function Unidades() {
  const { t } = usePrefs();
  const { e, d } = useQbd();
  const n = useN();
  const [articuloId, setArticulo] = useState("i01");
  const [cantidad, setCantidad] = useState(200);
  const j = n.juego(articuloId);
  const [u, setU] = useState("sq ft");
  const uValida = j?.unidades.some((x) => x.u === u) ? u : j?.venta ?? "";
  const enBase = j ? aBase(cantidad, uValida, j) : 0;
  const pantallas: { k: "compra" | "venta" | "envio"; en: string; es: string; donde_en: string; donde_es: string }[] = [
    { k: "compra", en: "Buying", es: "Compras", donde_en: "reorders", donde_es: "reórdenes" },
    { k: "venta", en: "Selling", es: "Ventas", donde_en: "sales orders", donde_es: "órdenes de venta" },
    { k: "envio", en: "Shipping", es: "Envíos", donde_en: "transfers and pick lists", donde_es: "traspasos y listas de surtido" },
  ];
  return (
    <section className="qbo-seccion">
      <p className="qbo-explica">{t("Tile is bought by the pallet, stocked by the box and sold by the square foot. Each product has a unit set; stock is always counted in its base unit, and every screen opens in its own default unit. Selling 200 sq ft rounds up to whole boxes.",
        "La loseta se compra por tarima, se guarda por caja y se vende por pie cuadrado. Cada producto tiene un juego de unidades; la existencia se cuenta siempre en su unidad base y cada pantalla abre en su unidad por defecto. Vender 200 ft² se redondea a cajas completas.")}</p>
      <div className="qbo-caja" data-caja="convertidor">
        <h2>{t("Converter", "Convertidor")}</h2>
        <div className="qbo-campos">
          <Campo etiqueta={t("Product", "Producto")}>
            <select value={articuloId} data-campo="conv-producto" onChange={(ev) => setArticulo(ev.target.value)}>{n.inventariables.map((id) => <option key={id} value={id}>{n.articulo(id)}</option>)}</select>
          </Campo>
          <Campo etiqueta={t("Quantity", "Cantidad")}>
            <input type="number" min={0} step="any" data-campo="conv-cantidad" value={cantidad || ""} onChange={(ev) => setCantidad(Number(ev.target.value) || 0)} />
          </Campo>
          <Campo etiqueta={t("Unit", "Unidad")}>
            <select value={uValida} data-campo="conv-unidad" onChange={(ev) => setU(ev.target.value)}>{j?.unidades.map((x) => <option key={x.u} value={x.u}>{n.unidad(x.u)}</option>)}</select>
          </Campo>
        </div>
        <div className="qbo-lista" data-lista="conversion">
          <div className="qbo-renglon qbo-renglon-total"><span>{t("What leaves the shelf", "Lo que sale del estante")}</span><span className="qbo-num">{enBase} {n.unidad(j?.base ?? "")}</span></div>
          {j?.unidades.filter((x) => x.u !== j.base).map((x) => (
            <div key={x.u} className="qbo-renglon"><span>= {n.unidad(x.u)}</span><span className="qbo-num">{deBase(enBase, x.u, j).toLocaleString("en-US")}</span></div>
          ))}
        </div>
      </div>
      <div className="qbd-tarjetas">
        {e.juegos.map((g) => (
          <div key={g.id} className="qbo-caja" data-juego={g.id}>
            <h2>{g.nombre}</h2>
            <p className="qbo-explica">{t("Base unit", "Unidad base")}: <b>{n.unidad(g.base, 1)}</b> · {g.unidades.filter((x) => x.u !== g.base).map((x) => (x.factor >= 1
              ? `1 ${n.unidad(x.u, 1)} = ${x.factor} ${n.unidad(g.base)}`
              : `1 ${n.unidad(g.base, 1)} = ${Math.round(1000 / x.factor) / 1000} ${n.unidad(x.u)}`)).join(" · ")}</p>
            <div className="qbo-campos">
              {pantallas.map((p) => (
                <Campo key={p.k} etiqueta={t(`${p.en} (${p.donde_en})`, `${p.es} (${p.donde_es})`)}>
                  <select value={g[p.k]} onChange={(ev) => d({ tipo: "unidadPorDefecto", juegoId: g.id, pantalla: p.k, u: ev.target.value })}>
                    {g.unidades.map((x) => <option key={x.u} value={x.u}>{n.unidad(x.u)}</option>)}
                  </select>
                </Campo>
              ))}
            </div>
            <p className="qbo-explica">{t("Used by", "Lo usan")}: {e.fichas.filter((f) => f.juegoId === g.id).map((f) => n.articulo(f.articuloId)).join(", ")}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
