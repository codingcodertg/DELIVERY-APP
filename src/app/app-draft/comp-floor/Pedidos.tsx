"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { buscarLotes, estadoDePedido, pendienteDe, pendientesDeArticulo, repartirStock, siguiente, totalDeLineas } from "@/lib/app-draft/compfloor/logica";
import { NOMBRE_TIENDA, type Envio, type OrdenEspecial, type Pedido, type Tienda } from "@/lib/app-draft/compfloor/tipos";
import { Campo } from "../quickbooks-online/piezas";
import { SubSecciones, Ventana, dinero, nuevoId } from "../quickbooks-online/comun";
import { EstadoPedidoBadge, SelectorTienda, useCf, useDescribeLote, useTextos } from "./comun";
import { EditorDeVenta, borradorVacio, useCalculaLineas, type Borrador } from "./piezas";

type Sub = "list" | "fill" | "shipped";

/** Cotizaciones y pedidos: cotización → pedido en un clic, apartar del lote, backorders, surtir faltantes y enviar. */
export function Pedidos() {
  const { t } = usePrefs();
  const [sub, setSub] = useState<Sub>("list");
  return (
    <section className="qbo-seccion">
      <SubSecciones<Sub> valor={sub} onCambia={setSub} opciones={[
        { clave: "list", texto: t("Quotes & orders", "Cotizaciones y pedidos") },
        { clave: "fill", texto: t("Which orders to fill", "Qué pedidos surtir") },
        { clave: "shipped", texto: t("Shipped & invoiced", "Enviado y facturado") },
      ]} />
      {sub === "list" && <Lista />}
      {sub === "fill" && <Surtir />}
      {sub === "shipped" && <Enviados />}
    </section>
  );
}

const PRIORIDAD: Record<number, [string, string]> = { 1: ["Urgent", "Urgente"], 2: ["Normal", "Normal"], 3: ["When available", "Cuando haya"] };

function Lista() {
  const { t } = usePrefs();
  const { e } = useCf();
  const x = useTextos();
  const [abierta, setAbierta] = useState<string | "nueva" | null>(null);
  const filas = useMemo(() => e.pedidos.map((p) => ({ ...p, cliente: e.clientes.find((c) => c.id === p.clienteId)?.nombre ?? "—", estado: estadoDePedido(p), total: totalDeLineas(p.lineas), espera: p.lineas.reduce((s, l) => s + pendienteDe(l), 0) })), [e]);
  type F = (typeof filas)[number];
  const columnas = useMemo<ColumnaEstandar<F>[]>(() => [
    { key: "numero", en: "No.", es: "Núm.", ancho: 95, fija: true, valor: (p) => p.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 100, valor: (p) => p.fecha },
    { key: "cliente", en: "Customer", es: "Cliente", ancho: 210, valor: (p) => p.cliente },
    { key: "tienda", en: "Store", es: "Tienda", ancho: 100, valor: (p) => NOMBRE_TIENDA[p.tienda] },
    { key: "prioridad", en: "Priority", es: "Prioridad", ancho: 110, valor: (p) => p.prioridad, etiqueta: (v) => t(PRIORIDAD[Number(v)][0], PRIORIDAD[Number(v)][1]), celda: (p) => t(PRIORIDAD[p.prioridad][0], PRIORIDAD[p.prioridad][1]) },
    { key: "espera", en: "Boxes waiting", es: "Cajas en espera", ancho: 110, numerico: true, valor: (p) => p.espera },
    { key: "total", en: "Total", es: "Total", ancho: 110, numerico: true, valor: (p) => p.total, celda: (p) => dinero(p.total) },
    { key: "estado", en: "Status", es: "Estado", ancho: 170, valor: (p) => p.estado, etiqueta: (v) => x.estado(v as F["estado"]), celda: (p) => <EstadoPedidoBadge estado={p.estado} /> },
  ], [t, x]);
  return (
    <>
      <div className="qbo-barra"><button type="button" className="btn btn-primary btn-sm" data-accion="nueva-cotizacion" onClick={() => setAbierta("nueva")}>+ {t("New quote", "Nueva cotización")}</button></div>
      <TablaEstandar id="app-draft-cf-pedidos" filas={filas} claveDe={(p) => p.id} columnas={columnas} onFila={(p) => setAbierta(p.id)} ordenInicial={{ clave: "fecha", direccion: "desc" }} vacio={t("No quotes or orders yet.", "Todavía no hay cotizaciones ni pedidos.")} />
      {abierta === "nueva" && <FormCotizacion onCerrar={() => setAbierta(null)} onCreado={(id) => setAbierta(id)} />}
      {abierta && abierta !== "nueva" && <FichaPedido id={abierta} onCerrar={() => setAbierta(null)} />}
    </>
  );
}

function FormCotizacion({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: (id: string) => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useCf();
  const [clienteId, setClienteId] = useState("");
  const [tienda, setTienda] = useState<Tienda>("mca");
  const [urgente, setUrgente] = useState(false);
  const [lineas, setLineas] = useState<Borrador[]>([borradorVacio()]);
  const [error, setError] = useState("");
  const cliente = e.clientes.find((c) => c.id === clienteId);
  const calc = useCalculaLineas(lineas, cliente?.tipo ?? null);
  const guardar = (comoPedido: boolean) => {
    const buenas = calc.filter((c) => c.a && c.cajas > 0);
    if (!cliente || !buenas.length) return setError(t("Choose a customer and add at least one product with a quantity.", "Elige un cliente y agrega al menos un producto con cantidad."));
    const id = nuevoId("p");
    const especiales: OrdenEspecial[] = [];
    let numerosOc = e.especiales.map((o) => o.numero);
    const lineasP = buenas.map((c) => {
      const lineaId = nuevoId("l");
      let ocId: string | null = null;
      if (c.b.especial && c.a) {
        ocId = nuevoId("oc");
        const numero = siguiente(numerosOc, "PO-", 7001);
        numerosOc = [...numerosOc, numero];
        especiales.push({ id: ocId, numero, proveedorId: c.a.proveedorId, articuloId: c.a.id, cajas: c.cajas, pedidoId: id, lineaId, fecha: hoy, recibida: false });
      }
      return { id: lineaId, articuloId: c.a!.id, cajas: c.cajas, precioCaja: c.precio, existenciaId: c.b.especial ? null : c.b.existenciaId, reservadas: 0, enviadas: 0, ocId };
    });
    const p: Pedido = { id, numero: siguiente(e.pedidos.map((x) => x.numero), "SO-", 5001), clienteId, tienda, fecha: hoy, prioridad: urgente ? 1 : 2, etapa: "quote", lineas: lineasP };
    d({ tipo: "guardarPedido", pedido: p, especiales });
    if (comoPedido) d({ tipo: "aPedido", id });
    onCreado(id);
  };
  return (
    <Ventana titulo={t("New quote", "Nueva cotización")} onCerrar={onCerrar} ancho={920} pie={<>
      <button type="button" className="btn btn-ghost" data-accion="guardar-cotizacion" onClick={() => guardar(false)}>{t("Save quote", "Guardar cotización")}</button>
      <button type="button" className="btn btn-primary" data-accion="guardar-pedido" onClick={() => guardar(true)}>{t("Save as sales order", "Guardar como pedido")}</button>
    </>}>
      <div className="qbo-form">
        <div className="qbo-campos">
          <Campo etiqueta={t("Customer", "Cliente")}>
            <select value={clienteId} onChange={(ev) => setClienteId(ev.target.value)} data-campo="cliente">
              <option value="">{t("Choose…", "Elige…")}</option>
              {e.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("Store", "Tienda")}><SelectorTienda valor={tienda} onCambia={(s) => setTienda((s || "mca") as Tienda)} /></Campo>
          <label className="cf-check" style={{ alignSelf: "end" }}><input type="checkbox" checked={urgente} onChange={(ev) => setUrgente(ev.target.checked)} /> {t("Urgent (filled first)", "Urgente (se surte primero)")}</label>
        </div>
        <EditorDeVenta lineas={lineas} onCambia={setLineas} tienda={tienda} tipo={cliente?.tipo ?? null} modo="order" />
        <p className="qbo-explica">{t("That's all it takes: boxes, price for this customer, lot and anything that must wait are filled in for you.", "Es todo: las cajas, el precio de este cliente, el lote y lo que tiene que esperar se llenan solos.")}</p>
        {error && <p className="qbo-error" role="alert">{error}</p>}
      </div>
    </Ventana>
  );
}

function FichaPedido({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useCf();
  const desc = useDescribeLote();
  const [aviso, setAviso] = useState("");
  const p = e.pedidos.find((x) => x.id === id);
  if (!p) return null;
  const estado = estadoDePedido(p);
  const cliente = e.clientes.find((c) => c.id === p.clienteId);
  const envios = e.envios.filter((s) => s.pedidoId === p.id);
  const porEnviar = p.lineas.reduce((s, l) => s + l.reservadas, 0);
  return (
    <Ventana titulo={`${p.etapa === "quote" ? t("Quote", "Cotización") : t("Sales order", "Pedido")} ${p.numero}`} onCerrar={onCerrar} ancho={900} pie={<>
      {p.etapa === "quote" && <button type="button" className="btn btn-primary" data-accion="a-pedido" onClick={() => { d({ tipo: "aPedido", id: p.id }); setAviso(t("Now a sales order. Stock is held from the lot; anything short waits as a backorder.", "Ya es pedido. Se apartó del lote; lo que falta queda en espera (backorder).")); }}>{t("Turn into sales order", "Convertir en pedido")}</button>}
      {p.etapa === "order" && porEnviar > 0 && <button type="button" className="btn btn-green" data-accion="enviar" onClick={() => {
        d({ tipo: "enviar", id: p.id, envioId: nuevoId("s"), numero: siguiente(e.envios.map((s) => s.numero), "INV-", 8001), fecha: hoy });
        setAviso(t("Shipped and invoiced. Anything still waiting stays open on the order.", "Enviado y facturado. Lo que sigue en espera queda abierto en el pedido."));
      }}>{t(`Ship the ${porEnviar} held boxes & invoice`, `Enviar las ${porEnviar} cajas apartadas y facturar`)}</button>}
      {p.etapa === "order" && <button type="button" className="btn btn-ghost" onClick={() => { if (window.confirm(t("Close this order? Held boxes go back to free stock.", "¿Cerrar el pedido? Lo apartado vuelve a quedar libre."))) d({ tipo: "cerrarPedido", id: p.id }); }}>{t("Close order", "Cerrar pedido")}</button>}
    </>}>
      <div className="qbo-form">
        <div className="qbo-explica">{cliente?.nombre} · {NOMBRE_TIENDA[p.tienda]} · {p.fecha} · {t(PRIORIDAD[p.prioridad][0], PRIORIDAD[p.prioridad][1])} <EstadoPedidoBadge estado={estado} /></div>
        <div className="cf-tabla-scroll">
          <table className="cf-tabla">
            <thead><tr><th>{t("Product", "Producto")}</th><th>{t("Lot", "Lote")}</th><th className="qbo-num">{t("Ordered", "Pedido")}</th><th className="qbo-num">{t("Held", "Apartado")}</th><th className="qbo-num">{t("Shipped", "Enviado")}</th><th className="qbo-num">{t("Waiting", "En espera")}</th><th className="qbo-num">{t("Price/box", "Precio/caja")}</th></tr></thead>
            <tbody>
              {p.lineas.map((l) => {
                const oc = l.ocId ? e.especiales.find((o) => o.id === l.ocId) : undefined;
                return (
                  <tr key={l.id} data-linea={l.id}>
                    <td>{e.articulos.find((a) => a.id === l.articuloId)?.nombre}</td>
                    <td className="qbo-explica">{oc && !oc.recibida ? `${t("Special order", "Pedido especial")} ${oc.numero}` : desc(e.existencias.find((x) => x.id === l.existenciaId))}</td>
                    <td className="qbo-num">{l.cajas}</td><td className="qbo-num">{l.reservadas}</td><td className="qbo-num">{l.enviadas}</td>
                    <td className={`qbo-num ${pendienteDe(l) > 0 && p.etapa === "order" ? "qbo-rojo" : ""}`} data-espera>{p.etapa === "order" ? pendienteDe(l) : "—"}</td>
                    <td className="qbo-num">{dinero(l.precioCaja)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="qbo-totales"><div><b>{t("Total", "Total")}</b><b className="qbo-num">{dinero(totalDeLineas(p.lineas))}</b></div></div>
        {estado === "backorder" && <p className="qbo-explica">{t("When stock arrives, use “Which orders to fill” to hold it for the right orders first.", "Cuando llegue mercancía, usa «Qué pedidos surtir» para apartarla primero a los pedidos correctos.")}</p>}
        {aviso && <p className="qbo-ok" role="status">{aviso}</p>}
        {envios.length > 0 && (
          <div className="qbo-caja">
            <h2>{t("Shipped & invoiced", "Enviado y facturado")}</h2>
            {envios.map((s) => <div key={s.id} className="qbo-renglon"><span>{s.numero} · {s.fecha}</span><span className="qbo-num">{dinero(s.total)}</span></div>)}
            <p className="qbo-explica">{t("Here the invoice is just a status. The accounting side (what the customer owes, payments) is in the ", "Aquí la factura solo es un estado. El lado contable (lo que debe el cliente, cobros) está en el ")}<Link href="/app-draft/quickbooks-online">{t("QuickBooks Online draft", "prototipo de QuickBooks Online")}</Link>.</p>
          </div>
        )}
      </div>
    </Ventana>
  );
}

/** «Qué pedidos surtir»: hay poco de un lote y varios clientes esperando; se reparte por prioridad y luego por fecha. */
function Surtir() {
  const { t } = usePrefs();
  const { e, d } = useCf();
  const desc = useDescribeLote();
  const conEspera = useMemo(() => e.articulos.filter((a) => pendientesDeArticulo(e.pedidos, a.id).length > 0), [e]);
  const [articuloId, setArticuloId] = useState("");
  const [existenciaId, setExistenciaId] = useState("");
  const [aviso, setAviso] = useState("");
  // Por omisión, el primer producto que SÍ se puede surtir de algún lote sin mezclar.
  const surtible = conEspera.find((a) => {
    const pe = pendientesDeArticulo(e.pedidos, a.id);
    return buscarLotes(e, a.id, 1).some((f) => f.libre > 0 && repartirStock(f.libre, pe, f.existencia.id).length > 0);
  });
  const art = conEspera.find((a) => a.id === articuloId) ?? surtible ?? conEspera[0];
  const pend = art ? pendientesDeArticulo(e.pedidos, art.id) : [];
  const lotes = art ? buscarLotes(e, art.id, 1).filter((f) => f.libre > 0) : [];
  const lote = lotes.find((f) => f.existencia.id === existenciaId) ?? lotes.find((f) => repartirStock(f.libre, pend, f.existencia.id).length > 0) ?? lotes[0];
  const plan = lote ? repartirStock(lote.libre, pend, lote.existencia.id) : [];
  if (!conEspera.length) return <p className="qbo-gris" data-vacio>{t("No orders are waiting on stock. 🎉", "Ningún pedido está esperando mercancía. 🎉")}</p>;
  return (
    <div className="qbo-dos" data-surtir>
      <div className="qbo-caja">
        <h2>{t("Waiting, in fill order", "En espera, en orden de surtido")}</h2>
        <Campo etiqueta={t("Product", "Producto")}>
          <select value={art?.id ?? ""} onChange={(ev) => { setArticuloId(ev.target.value); setExistenciaId(""); setAviso(""); }}>
            {conEspera.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </Campo>
        <p className="qbo-explica">{t("Urgent orders first, then the oldest.", "Primero los urgentes, luego los más viejos.")}</p>
        {pend.map((x, i) => {
          const p = e.pedidos.find((y) => y.id === x.pedidoId)!;
          const toca = plan.find((s) => s.lineaId === x.lineaId)?.cajas ?? 0;
          const otroLote = !!(lote && x.existenciaId && x.existenciaId !== lote.existencia.id);
          return (
            <div key={x.lineaId} className="qbo-renglon" data-pendiente={p.numero}>
              <span>{i + 1}. {p.numero} · {e.clientes.find((c) => c.id === p.clienteId)?.nombre} · {p.fecha} · {t(PRIORIDAD[p.prioridad][0], PRIORIDAD[p.prioridad][1])}
                {otroLote && <span className="qbo-explica"> — {t("already on another lot, skipped so lots don't mix", "ya tiene otro lote; se salta para no mezclar")}</span>}</span>
              <span className="qbo-num">{x.falta} {t("waiting", "en espera")}{toca > 0 && <b className="qbo-verde"> → +{toca}</b>}</span>
            </div>
          );
        })}
      </div>
      <div className="qbo-caja">
        <h2>{t("Fill from", "Surtir de")}</h2>
        {lotes.length === 0 ? <p className="qbo-gris">{t("No free stock of this product in any lot. Order more or transfer.", "No hay stock libre de este producto en ningún lote. Pide más o traslada.")}</p> : (
          <>
            <Campo etiqueta={t("Lot", "Lote")}>
              <select value={lote?.existencia.id ?? ""} onChange={(ev) => { setExistenciaId(ev.target.value); setAviso(""); }}>
                {lotes.map((f) => <option key={f.existencia.id} value={f.existencia.id}>{desc(f.existencia)} — {f.libre} {t("free", "libres")}</option>)}
              </select>
            </Campo>
            <p className="qbo-explica">{plan.length ? t(`Holds ${plan.reduce((s, x) => s + x.cajas, 0)} boxes for ${plan.length} order(s), shown in green.`, `Aparta ${plan.reduce((s, x) => s + x.cajas, 0)} cajas para ${plan.length} pedido(s), en verde.`) : t("Nothing to hold from this lot.", "No hay nada que apartar de este lote.")}</p>
            <button type="button" className="btn btn-primary btn-sm" data-accion="surtir" disabled={!plan.length} onClick={() => { d({ tipo: "surtir", existenciaId: lote!.existencia.id, asignaciones: plan }); setAviso(t("Held. Those orders can ship now.", "Apartado. Esos pedidos ya pueden enviarse.")); }}>{t("Hold for these orders", "Apartar para estos pedidos")}</button>
          </>
        )}
        {aviso && <p className="qbo-ok" role="status">{aviso}</p>}
      </div>
    </div>
  );
}

function Enviados() {
  const { t } = usePrefs();
  const { e } = useCf();
  const filas = e.envios;
  const columnas = useMemo<ColumnaEstandar<Envio>[]>(() => [
    { key: "numero", en: "Invoice", es: "Factura", ancho: 100, fija: true, valor: (s) => s.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 100, valor: (s) => s.fecha },
    { key: "pedido", en: "Order", es: "Pedido", ancho: 100, valor: (s) => e.pedidos.find((p) => p.id === s.pedidoId)?.numero ?? "" },
    { key: "cliente", en: "Customer", es: "Cliente", ancho: 210, valor: (s) => { const p = e.pedidos.find((x) => x.id === s.pedidoId); return e.clientes.find((c) => c.id === p?.clienteId)?.nombre ?? ""; } },
    { key: "cajas", en: "Boxes", es: "Cajas", ancho: 80, numerico: true, valor: (s) => s.lineas.reduce((a, l) => a + l.cajas, 0) },
    { key: "total", en: "Total", es: "Total", ancho: 110, numerico: true, valor: (s) => s.total, celda: (s) => dinero(s.total) },
  ], [e]);
  return (
    <>
      <p className="qbo-nota">{t("Each shipment becomes an invoice for exactly what left the warehouse. For what the customer owes and payments, see the ", "Cada envío se vuelve factura por exactamente lo que salió. Para lo que debe el cliente y los cobros, ve el ")}<Link href="/app-draft/quickbooks-online">{t("QuickBooks Online draft", "prototipo de QuickBooks Online")}</Link>.</p>
      <TablaEstandar id="app-draft-cf-envios" filas={filas} claveDe={(s) => s.id} columnas={columnas} ordenInicial={{ clave: "fecha", direccion: "desc" }} vacio={t("Nothing shipped yet. Open an order and ship what's held.", "Nada enviado aún. Abre un pedido y envía lo apartado.")} />
    </>
  );
}
