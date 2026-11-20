"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { estadoDeOrden, porFacturarDeOrden, r2, sumaDias, totalDeOrden } from "@/lib/app-draft/qbo/contabilidad";
import { siguienteNumero } from "@/lib/app-draft/qbo/estado";
import type { LineaDeOrden, OrdenDeCompra } from "@/lib/app-draft/qbo/tipos";
import { Estado, Ventana, dinero, etiquetaDeEstado, nuevoId, useNombres, useQbo } from "./comun";
import { Campo } from "./piezas";

/** Compras: órdenes de compra (borrador → abierta → recibida en parte → cerrada), recibir contra la orden y facturarla. */
export function Compras() {
  const { t } = usePrefs();
  const { e } = useQbo();
  const n = useNombres();
  const [abierta, setAbierta] = useState<string | "nueva" | null>(null);
  const filas = useMemo(() => e.ordenes.map((o) => ({ ...o, proveedor: n.proveedor(o.proveedorId), estado: estadoDeOrden(o), total: totalDeOrden(o) })), [e, n]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "numero", en: "PO no.", es: "Núm. de orden", ancho: 110, fija: true, valor: (o) => o.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 105, valor: (o) => o.fecha },
    { key: "proveedor", en: "Vendor", es: "Proveedor", ancho: 220, valor: (o) => o.proveedor },
    { key: "esperada", en: "Expected", es: "Llega", ancho: 105, valor: (o) => o.esperada },
    { key: "total", en: "Total", es: "Total", ancho: 110, numerico: true, valor: (o) => o.total, celda: (o) => dinero(o.total) },
    { key: "estado", en: "Status", es: "Estado", ancho: 160, valor: (o) => o.estado, etiqueta: (v) => etiquetaDeEstado(String(v), t, true), celda: (o) => <Estado estado={o.estado} deOrden /> },
  ], [t]);
  return (
    <section className="qbo-seccion">
      <p className="qbo-nota">
        {t("The hub's Inventory app already does purchasing (ordering and receiving) at ", "La app de Inventario del hub ya hace las compras (pedir y recibir) en ")}
        <Link href="/erp/purchasing">/erp/purchasing</Link>
        {t(". This draft shows the accounting side: what a purchase order turns into once it's received and billed.", ". Este prototipo enseña el lado contable: en qué se convierte una orden de compra al recibirla y facturarla.")}
      </p>
      <div className="qbo-barra"><button type="button" className="btn btn-primary btn-sm" data-accion="nueva-orden" onClick={() => setAbierta("nueva")}>+ {t("New purchase order", "Nueva orden de compra")}</button></div>
      <TablaEstandar id="app-draft-qbo-ordenes" filas={filas} claveDe={(o) => o.id} columnas={columnas} onFila={(o) => setAbierta(o.id)} ordenInicial={{ clave: "fecha", direccion: "desc" }} vacio={t("No purchase orders yet.", "Todavía no hay órdenes de compra.")} />
      {abierta === "nueva" && <FormOrden onCerrar={() => setAbierta(null)} />}
      {abierta && abierta !== "nueva" && <FichaOrden id={abierta} onCerrar={() => setAbierta(null)} />}
    </section>
  );
}

function FormOrden({ onCerrar }: { onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbo();
  const [proveedorId, setProveedorId] = useState("");
  const [lineas, setLineas] = useState<LineaDeOrden[]>([]);
  const [error, setError] = useState("");
  const arts = e.articulos.filter((a) => a.proveedorId === proveedorId);
  const pon = (i: number, c: Partial<LineaDeOrden>) => setLineas(lineas.map((l, k) => (k === i ? { ...l, ...c } : l)));
  const guardar = (enviada: boolean) => {
    const buenas = lineas.filter((l) => l.articuloId && l.cantidad > 0);
    if (!proveedorId || !buenas.length) return setError(t("Choose a vendor and add products.", "Elige proveedor y agrega productos."));
    const o: OrdenDeCompra = { id: nuevoId("po"), numero: siguienteNumero(e.ordenes.map((x) => x.numero), "PO-", 3101), proveedorId, fecha: hoy, esperada: sumaDias(hoy, 10), lineas: buenas, enviada, cerrada: false };
    d({ tipo: "guardarOrden", orden: o });
    onCerrar();
  };
  return (
    <Ventana titulo={t("New purchase order", "Nueva orden de compra")} onCerrar={onCerrar} ancho={820} pie={<>
      <button type="button" className="btn btn-ghost" onClick={() => guardar(false)}>{t("Save as draft", "Guardar borrador")}</button>
      <button type="button" className="btn btn-primary" data-accion="enviar-orden" onClick={() => guardar(true)}>{t("Save and send to vendor", "Guardar y mandar al proveedor")}</button>
    </>}>
      <div className="qbo-form">
        <Campo etiqueta={t("Vendor", "Proveedor")}>
          <select value={proveedorId} onChange={(ev) => { setProveedorId(ev.target.value); setLineas([]); }}>
            <option value="">{t("Choose…", "Elige…")}</option>
            {e.proveedores.filter((p) => e.articulos.some((a) => a.proveedorId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        {lineas.map((l, i) => (
          <div key={i} className="qbo-linea">
            <select aria-label={t("Product", "Producto")} value={l.articuloId} onChange={(ev) => { const a = arts.find((x) => x.id === ev.target.value); pon(i, { articuloId: ev.target.value, costo: a?.costo ?? 0 }); }}>
              <option value="">{t("Choose…", "Elige…")}</option>
              {arts.map((a) => <option key={a.id} value={a.id}>{a.sku} · {a.nombre}</option>)}
            </select>
            <input type="number" min={0} aria-label={t("Quantity", "Cantidad")} value={l.cantidad || ""} onChange={(ev) => pon(i, { cantidad: Number(ev.target.value) || 0 })} />
            <input type="number" min={0} step="0.01" aria-label={t("Unit cost", "Costo unitario")} value={l.costo || ""} onChange={(ev) => pon(i, { costo: Number(ev.target.value) || 0 })} />
            <span className="qbo-num">{dinero(r2(l.cantidad * l.costo))}</span>
            <button type="button" className="btn btn-sm btn-ghost" aria-label={t("Remove line", "Quitar línea")} onClick={() => setLineas(lineas.filter((_, k) => k !== i))}>✕</button>
          </div>
        ))}
        {proveedorId && <div><button type="button" className="btn btn-sm btn-ghost" onClick={() => setLineas([...lineas, { articuloId: "", cantidad: 0, costo: 0, recibido: 0, facturado: 0 }])}>+ {t("Add product", "Agregar producto")}</button></div>}
        <div className="qbo-totales"><div><b>{t("Total", "Total")}</b><b className="qbo-num">{dinero(totalDeOrden({ lineas }))}</b></div></div>
        {error && <p className="qbo-error" role="alert">{error}</p>}
      </div>
    </Ventana>
  );
}

function FichaOrden({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbo();
  const n = useNombres();
  const o = e.ordenes.find((x) => x.id === id);
  const [recibir, setRecibir] = useState<Record<string, number>>({});
  const [numeroFactura, setNumeroFactura] = useState("");
  const [aviso, setAviso] = useState("");
  if (!o) return null;
  const estado = estadoDeOrden(o);
  const pendiente = porFacturarDeOrden(o);
  const abierta = estado !== "closed" && estado !== "draft";
  return (
    <Ventana titulo={`${t("Purchase order", "Orden de compra")} ${o.numero}`} onCerrar={onCerrar} ancho={820} pie={<>
      {estado === "draft" && <button type="button" className="btn btn-primary" onClick={() => d({ tipo: "guardarOrden", orden: { ...o, enviada: true } })}>{t("Send to vendor", "Mandar al proveedor")}</button>}
      {abierta && <button type="button" className="btn btn-ghost" onClick={() => { d({ tipo: "cerrarOrden", id: o.id }); onCerrar(); }}>{t("Close PO", "Cerrar orden")}</button>}
      {abierta && <button type="button" className="btn btn-green" data-accion="recibir-orden" disabled={!Object.values(recibir).some((v) => v > 0)} onClick={() => { d({ tipo: "recibirOrden", id: o.id, cantidades: recibir }); setRecibir({}); setAviso(t("Received. Inventory will show it once the bill is entered.", "Recibido. El inventario lo refleja al registrar la factura.")); }}>{t("Receive checked quantities", "Recibir las cantidades")}</button>}
    </>}>
      <div className="qbo-form">
        <div className="qbo-explica">{n.proveedor(o.proveedorId)} · {o.fecha} · {t("expected", "llega")} {o.esperada} <Estado estado={estado} deOrden /></div>
        <div className="qbo-lineas">
          <div className="qbo-linea qbo-linea-cabeza" style={{ gridTemplateColumns: "minmax(0,3fr) repeat(3, minmax(60px,1fr)) minmax(80px,1fr)" }}><span>{t("Product", "Producto")}</span><span>{t("Ordered", "Pedido")}</span><span>{t("Received", "Recibido")}</span><span>{t("Billed", "Facturado")}</span><span>{t("Receive now", "Recibir ahora")}</span></div>
          {o.lineas.map((l) => (
            <div key={l.articuloId} className="qbo-linea" style={{ gridTemplateColumns: "minmax(0,3fr) repeat(3, minmax(60px,1fr)) minmax(80px,1fr)" }}>
              <span>{n.articulo(l.articuloId)} <span className="qbo-gris">@ {dinero(l.costo)}</span></span>
              <span className="qbo-num">{l.cantidad}</span><span className="qbo-num">{l.recibido}</span><span className="qbo-num">{l.facturado}</span>
              {abierta && l.recibido < l.cantidad
                ? <input type="number" min={0} max={l.cantidad - l.recibido} aria-label={t("Receive now", "Recibir ahora")} value={recibir[l.articuloId] || ""} onChange={(ev) => setRecibir({ ...recibir, [l.articuloId]: Math.min(l.cantidad - l.recibido, Number(ev.target.value) || 0) })} />
                : <span className="qbo-gris">—</span>}
            </div>
          ))}
        </div>
        {aviso && <p className="qbo-ok">{aviso}</p>}
        {pendiente.length > 0 && estado !== "closed" && (
          <div className="qbo-caja">
            <h2>{t("Received but not billed yet", "Recibido y sin facturar")}: {dinero(pendiente.reduce((a, p) => a + p.monto, 0))}</h2>
            <p className="qbo-explica">{t("When the vendor's invoice arrives, turn what was received into a bill. That records that we owe them.", "Cuando llegue la factura del proveedor, convierte lo recibido en una factura por pagar. Eso registra que le debemos.")}</p>
            <div className="qbo-barra">
              <input aria-label={t("Vendor's bill no.", "Núm. de factura del proveedor")} placeholder={t("Vendor's bill no.", "Núm. de factura del proveedor")} value={numeroFactura} onChange={(ev) => setNumeroFactura(ev.target.value)} style={{ maxWidth: 220 }} />
              <button type="button" className="btn btn-primary btn-sm" data-accion="facturar-orden" onClick={() => {
                d({ tipo: "facturarOrden", id: o.id, billId: nuevoId("bill"), numero: numeroFactura.trim() || `${o.numero}-B`, fecha: hoy });
                setAviso(t("Bill created. See it in Vendors & bills.", "Factura creada. Está en Proveedores y pagos."));
              }}>{t("Create bill from received", "Crear factura con lo recibido")}</button>
            </div>
          </div>
        )}
      </div>
    </Ventana>
  );
}
