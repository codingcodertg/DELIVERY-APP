"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { r2, repartirCosto } from "@/lib/app-draft/qbd/inventario";
import type { CostoDeImportacion } from "@/lib/app-draft/qbd/tipos";
import { dinero, nuevoId } from "../quickbooks-online/comun";
import { Campo } from "../quickbooks-online/piezas";
import { useN, useQbd } from "./comun";

/** Costo de importación: reparte flete y aranceles de una orden recibida entre sus productos y enseña el costo nuevo. */
export function Importacion() {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbd();
  const n = useN();
  const [ordenId, setOrden] = useState(e.ordenesCompra[0]?.id ?? "");
  const [flete, setFlete] = useState(850);
  const [arancel, setArancel] = useState(0);
  const [metodo, setMetodo] = useState<CostoDeImportacion["metodo"]>("value");
  const [aviso, setAviso] = useState("");
  const o = e.ordenesCompra.find((x) => x.id === ordenId);
  const ya = e.importaciones.filter((x) => x.ordenId === ordenId);
  const yaMonto = r2(ya.reduce((a, x) => a + x.flete + x.arancel, 0));
  const lineas = useMemo(() => (o ? o.lineas.map((l) => ({ articuloId: l.articuloId, cantidad: l.recibido, costo: l.costo })) : []), [o]);
  const reparto = useMemo(() => repartirCosto(lineas, r2(flete + arancel), metodo).map((x) => ({ ...x, nombre: n.articulo(x.articuloId), unidad: e.articulos.find((a) => a.id === x.articuloId)?.unidad ?? "" })), [lineas, flete, arancel, metodo, n, e.articulos]);
  const columnas = useMemo<ColumnaEstandar<(typeof reparto)[number]>[]>(() => [
    { key: "nombre", en: "Product", es: "Producto", ancho: 240, fija: true, valor: (x) => x.nombre },
    { key: "cantidad", en: "Received", es: "Recibido", ancho: 110, numerico: true, valor: (x) => x.cantidad, celda: (x) => `${x.cantidad} ${n.unidad(x.unidad)}` },
    { key: "costo", en: "Vendor cost", es: "Costo del proveedor", ancho: 120, numerico: true, valor: (x) => x.costo, celda: (x) => dinero(x.costo) },
    { key: "extra", en: "Share of freight & duties", es: "Parte de flete y aranceles", ancho: 150, numerico: true, valor: (x) => x.extra, celda: (x) => dinero(x.extra) },
    { key: "nuevoCosto", en: "New unit cost", es: "Costo unitario nuevo", ancho: 130, numerico: true, valor: (x) => x.nuevoCosto, celda: (x) => <b>{dinero(x.nuevoCosto)}</b> },
  ], [n]);
  const aplicar = () => {
    if (!o || flete + arancel <= 0) return;
    d({ tipo: "importacion", costo: { id: nuevoId("lc"), ordenId: o.id, fecha: hoy, flete: r2(flete), arancel: r2(arancel), metodo } });
    setAviso(t("Saved. The new unit costs are what this shipment really cost.", "Guardado. Los costos nuevos son lo que este embarque costó de verdad."));
  };
  if (!e.ordenesCompra.length) return <p className="qbo-gris">{t("No received purchase orders in the sample.", "No hay órdenes de compra recibidas en la muestra.")}</p>;
  return (
    <section className="qbo-seccion">
      <p className="qbo-explica">
        {t("Freight and import duties are part of what a product really costs. Spread them over a received purchase order — by value (pricier items carry more) or by quantity — to see the true cost per unit. The purchase orders are the ones in the ",
          "El flete y los aranceles son parte de lo que de verdad cuesta un producto. Repártelos en una orden de compra recibida —por valor (lo caro carga más) o por cantidad— para ver el costo real por unidad. Las órdenes son las del prototipo de ")}
        <Link href="/app-draft/quickbooks-online">QuickBooks Online</Link>{t(" draft (Purchasing tab).", " (pestaña Compras).")}
      </p>
      <div className="qbo-caja">
        <div className="qbo-campos">
          <Campo etiqueta={t("Received purchase order", "Orden de compra recibida")}>
            <select value={ordenId} data-campo="orden-compra" onChange={(ev) => { setOrden(ev.target.value); setAviso(""); }}>
              {e.ordenesCompra.map((x) => <option key={x.id} value={x.id}>{x.numero} · {n.proveedor(x.proveedorId)}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("Freight ($)", "Flete ($)")}><input type="number" min={0} step="0.01" data-campo="flete" value={flete || ""} onChange={(ev) => setFlete(Math.max(0, Number(ev.target.value) || 0))} /></Campo>
          <Campo etiqueta={t("Duties / customs ($)", "Aranceles / aduana ($)")}><input type="number" min={0} step="0.01" data-campo="arancel" value={arancel || ""} onChange={(ev) => setArancel(Math.max(0, Number(ev.target.value) || 0))} /></Campo>
          <Campo etiqueta={t("Spread by", "Repartir por")}>
            <select value={metodo} data-campo="metodo" onChange={(ev) => setMetodo(ev.target.value as CostoDeImportacion["metodo"])}>
              <option value="value">{t("Value (cost × qty)", "Valor (costo × cantidad)")}</option>
              <option value="quantity">{t("Quantity", "Cantidad")}</option>
            </select>
          </Campo>
        </div>
        {o && <p className="qbo-explica">{o.numero} · {o.fecha} · {n.proveedor(o.proveedorId)}{ya.length > 0 && ` · ${t("already added", "ya agregado")}: ${dinero(yaMonto)}`}</p>}
      </div>
      <TablaEstandar id="app-draft-qbd-landed" filas={reparto} claveDe={(x) => x.articuloId} columnas={columnas} totales={{ extra: dinero(reparto.reduce((a, x) => a + x.extra, 0)) }}
        vacio={t("Nothing received on this order yet.", "Esta orden todavía no tiene nada recibido.")} />
      <div className="qbo-barra">
        <button type="button" className="btn btn-primary btn-sm" data-accion="aplicar-landed" disabled={!reparto.length || flete + arancel <= 0} onClick={aplicar}>{t("Save landed cost", "Guardar costo de importación")}</button>
        {aviso && <span className="qbo-ok">{aviso}</span>}
      </div>
    </section>
  );
}
