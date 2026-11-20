"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import type { OrdenEspecial } from "@/lib/app-draft/compfloor/tipos";
import { Campo } from "../quickbooks-online/piezas";
import { Ventana, nuevoId } from "../quickbooks-online/comun";
import { useCf } from "./comun";

/**
 * Pedidos especiales: una línea de pedido que no hay en stock crea una orden al proveedor. Al recibirla, la mercancía
 * queda apartada para ese cliente y el vendedor recibe un aviso aquí.
 */
export function Especiales() {
  const { t, lang } = usePrefs();
  const { e, d } = useCf();
  const [abierta, setAbierta] = useState<string | null>(null);
  const filas = useMemo(() => e.especiales.map((o) => {
    const p = e.pedidos.find((x) => x.id === o.pedidoId);
    return { ...o, pedido: p?.numero ?? "", cliente: e.clientes.find((c) => c.id === p?.clienteId)?.nombre ?? "", producto: e.articulos.find((a) => a.id === o.articuloId)?.nombre ?? "", proveedor: e.proveedores.find((v) => v.id === o.proveedorId)?.nombre ?? "" };
  }), [e]);
  type F = (typeof filas)[number];
  const columnas = useMemo<ColumnaEstandar<F>[]>(() => [
    { key: "numero", en: "Vendor order", es: "Orden al proveedor", ancho: 130, fija: true, valor: (o) => o.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 100, valor: (o) => o.fecha },
    { key: "proveedor", en: "Vendor", es: "Proveedor", ancho: 220, valor: (o) => o.proveedor },
    { key: "producto", en: "Product", es: "Producto", ancho: 230, valor: (o) => o.producto },
    { key: "cajas", en: "Boxes", es: "Cajas", ancho: 80, numerico: true, valor: (o) => o.cajas },
    { key: "cliente", en: "For customer", es: "Para el cliente", ancho: 200, valor: (o) => `${o.cliente} (${o.pedido})` },
    { key: "estado", en: "Status", es: "Estado", ancho: 140, valor: (o) => (o.recibida ? "received" : "open"), etiqueta: (v) => (v === "received" ? t("Received", "Recibida") : t("On order", "Pedida")), celda: (o) => <span className={`badge qbo-estado qbo-estado-${o.recibida ? "closed" : "open"}`}>{o.recibida ? t("Received", "Recibida") : t("On order", "Pedida")}</span> },
  ], [t]);
  return (
    <section className="qbo-seccion">
      <div className="qbo-caja" data-alertas>
        <h2>🔔 {t("Alerts for salespeople", "Avisos para vendedores")}</h2>
        {e.alertas.length === 0 && <p className="qbo-gris">{t("No alerts. When a special order arrives, the salesperson sees it here.", "Sin avisos. Cuando llega un pedido especial, el vendedor lo ve aquí.")}</p>}
        {e.alertas.map((a) => (
          <div key={a.id} className="qbo-renglon" data-alerta={a.leida ? "leida" : "nueva"}>
            <span>{a.leida ? "" : <b>● </b>}{a.fecha} · {lang === "es" ? a.es : a.en}</span>
            {!a.leida && <button type="button" className="btn btn-sm btn-ghost" onClick={() => d({ tipo: "leerAlerta", id: a.id })}>{t("Mark done", "Hecho")}</button>}
          </div>
        ))}
      </div>
      <p className="qbo-nota">{t("To create one: in a new quote, pick a product that isn't in stock anywhere and tick “special order it”. The vendor order is made for you.", "Para crear uno: en una cotización nueva, elige un producto que no hay en ninguna tienda y marca «pedirlo al proveedor». La orden se crea sola.")}</p>
      <TablaEstandar id="app-draft-cf-especiales" filas={filas} claveDe={(o) => o.id} columnas={columnas} onFila={(o) => setAbierta(o.id)} ordenInicial={{ clave: "fecha", direccion: "desc" }} vacio={t("No special orders yet.", "Todavía no hay pedidos especiales.")} />
      {abierta && <Recibir oc={e.especiales.find((o) => o.id === abierta)} onCerrar={() => setAbierta(null)} />}
    </section>
  );
}

function Recibir({ oc, onCerrar }: { oc: OrdenEspecial | undefined; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useCf();
  const [lote, setLote] = useState("");
  const [tono, setTono] = useState("");
  const p = oc ? e.pedidos.find((x) => x.id === oc.pedidoId) : undefined;
  const bins = p ? e.bins[p.tienda] : [];
  const [bin, setBin] = useState(bins[0] ?? "");
  if (!oc || !p) return null;
  return (
    <Ventana titulo={`${t("Vendor order", "Orden al proveedor")} ${oc.numero}`} onCerrar={onCerrar} ancho={520} pie={!oc.recibida ? (
      <button type="button" className="btn btn-green" data-accion="recibir-especial" onClick={() => { d({ tipo: "recibirEspecial", ocId: oc.id, existenciaId: nuevoId("x"), lote: lote.trim(), tono: tono.trim(), bin, alertaId: nuevoId("al"), fecha: hoy }); onCerrar(); }}>{t("Received — set aside for the customer", "Recibido: apartar para el cliente")}</button>
    ) : undefined}>
      {oc.recibida ? <p className="qbo-ok">{t("Already received and set aside.", "Ya se recibió y está apartado.")}</p> : (
        <div className="qbo-form">
          <p className="qbo-explica">{oc.cajas} {t("boxes of", "cajas de")} {e.articulos.find((a) => a.id === oc.articuloId)?.nombre} · {p.numero}</p>
          <div className="qbo-campos">
            <Campo etiqueta={t("Lot on the box", "Lote en la caja")}><input value={lote} onChange={(ev) => setLote(ev.target.value)} placeholder="L0000" /></Campo>
            <Campo etiqueta={t("Shade", "Tono")}><input value={tono} onChange={(ev) => setTono(ev.target.value)} placeholder="A" /></Campo>
            <Campo etiqueta="Bin"><select value={bin} onChange={(ev) => setBin(ev.target.value)}>{bins.map((b) => <option key={b} value={b}>{b}</option>)}</select></Campo>
          </div>
        </div>
      )}
    </Ventana>
  );
}
