"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { siguienteNumero } from "@/lib/app-draft/qbo/estado";
import {
  aBase, avanzarEnvio, crearEnvio, disponible, enLista, escanear, estadoDeOrdenVenta, factorDe, hojaDeSurtido, porSurtir,
  precioBaseDe, precioDeLinea, r2, totalDeOrdenVenta,
} from "@/lib/app-draft/qbd/inventario";
import type { EstadoQbd, LineaDeVenta, OrdenDeVenta } from "@/lib/app-draft/qbd/tipos";
import { SubSecciones, Ventana, dinero, nuevoId } from "../quickbooks-online/comun";
import { Campo } from "../quickbooks-online/piezas";
import { Insignia, etiqueta, useError, useN, useQbd } from "./comun";

type Sub = "orders" | "worksheet" | "shipping";

/** Órdenes de venta (aparte de las facturas), pendientes, hoja de qué surtir y surtir → empacar → enviar. */
export function Ventas() {
  const { t } = usePrefs();
  const [sub, setSub] = useState<Sub>("orders");
  const [envioAbierto, setEnvioAbierto] = useState<string | null>(null);
  return (
    <section className="qbo-seccion">
      <p className="qbo-explica">{t("A sales order is the customer's request; it isn't an invoice yet and doesn't take stock until it's picked. When a job is only partly in stock, what's missing stays on the order as a backorder until it arrives. Invoicing what shipped is done in the QuickBooks Online draft.",
        "La orden de venta es el pedido del cliente: todavía no es factura y no descuenta existencia hasta que se surte. Si un trabajo solo está en parte, lo que falta se queda en la orden como pendiente (backorder) hasta que llegue. Facturar lo enviado se hace en el prototipo de QuickBooks Online.")}</p>
      <SubSecciones<Sub> valor={sub} onCambia={setSub} opciones={[
        { clave: "orders", texto: t("Sales orders", "Órdenes de venta") },
        { clave: "worksheet", texto: t("Which orders to fill", "Qué órdenes surtir") },
        { clave: "shipping", texto: t("Pick, pack & ship", "Surtir, empacar y enviar") },
      ]} />
      {sub === "orders" && <Ordenes abrirEnvio={(id) => { setSub("shipping"); setEnvioAbierto(id); }} />}
      {sub === "worksheet" && <Hoja alTerminar={() => setSub("shipping")} />}
      {sub === "shipping" && <Envios abierto={envioAbierto} setAbierto={setEnvioAbierto} />}
    </section>
  );
}

function Ordenes({ abrirEnvio }: { abrirEnvio: (id: string) => void }) {
  const { t } = usePrefs();
  const { e, hoy } = useQbd();
  const n = useN();
  const [abierta, setAbierta] = useState<string | "nueva" | null>(null);
  const filas = useMemo(() => e.ordenes.map((o) => ({
    ...o, cliente: n.cliente(o.clienteId), sitio: n.sitio(o.sitioId), total: totalDeOrdenVenta(o), estado: estadoDeOrdenVenta(o, e.envios),
    backorder: o.cancelada ? 0 : o.lineas.filter((l) => porSurtir(o, e.envios, l.articuloId) > disponible(e, l.articuloId, o.sitioId, hoy)).length,
  })), [e, n, hoy]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "numero", en: "Order", es: "Orden", ancho: 100, fija: true, valor: (o) => o.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 100, valor: (o) => o.fecha },
    { key: "cliente", en: "Customer", es: "Cliente", ancho: 240, valor: (o) => o.cliente },
    { key: "sitio", en: "Ships from", es: "Sale de", ancho: 150, valor: (o) => o.sitio },
    { key: "total", en: "Total", es: "Total", ancho: 110, numerico: true, valor: (o) => o.total, celda: (o) => dinero(o.total) },
    { key: "backorder", en: "Lines short", es: "Renglones sin existencia", ancho: 120, numerico: true, valor: (o) => o.backorder, celda: (o) => (o.backorder ? <span className="qbd-poco">{o.backorder}</span> : <span className="qbd-cero">0</span>) },
    { key: "estado", en: "Status", es: "Estado", ancho: 230, valor: (o) => o.estado, etiqueta: (v) => etiqueta(String(v), t), celda: (o) => <Insignia estado={o.estado} /> },
  ], [t]);
  return (
    <>
      <div className="qbo-barra"><button type="button" className="btn btn-primary btn-sm" data-accion="nueva-orden-venta" onClick={() => setAbierta("nueva")}>+ {t("New sales order", "Nueva orden de venta")}</button></div>
      <TablaEstandar id="app-draft-qbd-ordenes" filas={filas} claveDe={(o) => o.id} columnas={columnas} onFila={(o) => setAbierta(o.id)} ordenInicial={{ clave: "fecha", direccion: "desc" }}
        vacio={t("No sales orders yet.", "Todavía no hay órdenes de venta.")} />
      {abierta === "nueva" && <FormOrden onCerrar={() => setAbierta(null)} onCreada={(id) => setAbierta(id)} />}
      {abierta && abierta !== "nueva" && <FichaOrden id={abierta} onCerrar={() => setAbierta(null)} abrirEnvio={abrirEnvio} />}
    </>
  );
}

interface Borrador { articuloId: string; cantidadEscrita: number; unidad: string }

/** Calcula el renglón con su precio y la regla que ganó. */
export function armarLinea(e: EstadoQbd, b: Borrador, clienteId: string, fecha: string): LineaDeVenta | null {
  const a = e.articulos.find((x) => x.id === b.articuloId);
  const f = e.fichas.find((x) => x.articuloId === b.articuloId);
  const c = e.clientes.find((x) => x.id === clienteId);
  if (!a || !f || !c || !(b.cantidadEscrita > 0)) return null;
  const j = e.juegos.find((x) => x.id === f.juegoId);
  const cantidad = aBase(b.cantidadEscrita, b.unidad, j);
  const p = precioDeLinea({ lista: precioBaseDe(a.precio, a.unidad, j), categoria: f.categoria, tipoCliente: c.tipo, cantidad, fecha, niveles: e.niveles, reglas: e.reglas });
  return { articuloId: a.id, cantidad, unidad: b.unidad, cantidadEscrita: b.cantidadEscrita, precio: p.precio, regla: p.ganador.clave, enviado: 0 };
}

export function useNombreDeRegla() {
  const { t } = usePrefs();
  const { e } = useQbd();
  return (clave: string) => {
    if (clave === "list") return t("List price", "Precio de lista");
    if (clave.startsWith("level:")) {
      const tipo = clave.slice(6);
      return t(`${tipo === "contractor" ? "Contractor" : tipo === "designer" ? "Designer" : "Homeowner"} level`, `Nivel ${tipo === "contractor" ? "contratista" : tipo === "designer" ? "diseñador" : "dueño de casa"}`);
    }
    return e.reglas.find((r) => `rule:${r.id}` === clave)?.nombre ?? t("Rule (deleted)", "Regla (borrada)");
  };
}

function FormOrden({ onCerrar, onCreada }: { onCerrar: () => void; onCreada: (id: string) => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbd();
  const n = useN();
  const regla = useNombreDeRegla();
  const [clienteId, setCliente] = useState("");
  const [sitioId, setSitio] = useState("s-mca");
  const [lineas, setLineas] = useState<Borrador[]>([{ articuloId: "", cantidadEscrita: 0, unidad: "" }]);
  const [error, setError] = useState("");
  const pon = (i: number, c: Partial<Borrador>) => setLineas(lineas.map((l, k) => (k === i ? { ...l, ...c } : l)));
  const calculadas = lineas.map((l) => armarLinea(e, l, clienteId, hoy));
  const total = r2(calculadas.reduce((a, l) => a + (l ? l.cantidad * l.precio : 0), 0));
  const guardar = () => {
    const buenas = calculadas.filter((l): l is LineaDeVenta => !!l);
    if (!clienteId || !buenas.length) return setError(t("Choose a customer and add products with quantities.", "Elige un cliente y agrega productos con cantidad."));
    const o: OrdenDeVenta = { id: nuevoId("so"), numero: siguienteNumero(e.ordenes.map((x) => x.numero), "SO-", 5101), clienteId, sitioId, fecha: hoy, lineas: buenas, cancelada: false };
    d({ tipo: "guardarOrden", orden: o });
    onCreada(o.id);
  };
  return (
    <Ventana titulo={t("New sales order", "Nueva orden de venta")} onCerrar={onCerrar} ancho={900} pie={<>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>{t("Cancel", "Cancelar")}</button>
      <button type="button" className="btn btn-primary" data-accion="guardar-orden-venta" onClick={guardar}>{t("Save order", "Guardar orden")}</button>
    </>}>
      <div className="qbo-form">
        <div className="qbo-campos">
          <Campo etiqueta={t("Customer", "Cliente")}>
            <select value={clienteId} data-campo="cliente" onChange={(ev) => setCliente(ev.target.value)}>
              <option value="">{t("Choose…", "Elige…")}</option>
              {e.clientes.map((c) => <option key={c.id} value={c.id}>{n.cliente(c.id)}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("Ships from", "Sale de")}>
            <select value={sitioId} onChange={(ev) => setSitio(ev.target.value)}>{e.sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
          </Campo>
        </div>
        {lineas.map((l, i) => {
          const j = l.articuloId ? n.juego(l.articuloId) : undefined;
          const c = calculadas[i];
          const hay = l.articuloId ? disponible(e, l.articuloId, sitioId, hoy) : 0;
          return (
            <div key={i} className="qbo-caja" data-linea-venta={i}>
              <div className="qbo-linea" style={{ gridTemplateColumns: "minmax(0,3fr) minmax(70px,1fr) minmax(90px,1fr) 32px" }}>
                <select aria-label={t("Product", "Producto")} data-campo="producto" value={l.articuloId} onChange={(ev) => pon(i, { articuloId: ev.target.value, unidad: n.juego(ev.target.value)?.venta ?? "" })}>
                  <option value="">{t("Choose…", "Elige…")}</option>
                  {n.inventariables.map((id) => <option key={id} value={id}>{n.sku(id)} · {n.articulo(id)}</option>)}
                </select>
                <input type="number" min={0} step="any" inputMode="decimal" aria-label={t("Quantity", "Cantidad")} data-campo="cantidad" value={l.cantidadEscrita || ""} onChange={(ev) => pon(i, { cantidadEscrita: Number(ev.target.value) || 0 })} />
                <select aria-label={t("Unit", "Unidad")} value={l.unidad} onChange={(ev) => pon(i, { unidad: ev.target.value })}>{j?.unidades.map((x) => <option key={x.u} value={x.u}>{n.unidad(x.u)}</option>)}</select>
                <button type="button" className="btn btn-sm btn-ghost" aria-label={t("Remove line", "Quitar línea")} onClick={() => setLineas(lineas.filter((_, k) => k !== i))}>✕</button>
              </div>
              {c && j && (
                <p className="qbo-explica" data-precio-linea>
                  {n.cant(c.articuloId, c.cantidad)} · {dinero(c.precio * factorDe(j, l.unidad))}/{n.unidad(l.unidad, 1)} · <b>{dinero(c.cantidad * c.precio)}</b> · <span className="qbd-chip" data-regla={c.regla}>{t("Price from", "Precio por")}: {regla(c.regla)}</span>
                  {" · "}{c.cantidad > hay ? <span className="qbd-poco">{t(`only ${hay} free — ${c.cantidad - hay} will be backordered`, `solo ${hay} libres: ${c.cantidad - hay} quedan pendientes`)}</span> : <span className="qbo-verde">{t("in stock", "hay existencia")}</span>}
                </p>
              )}
            </div>
          );
        })}
        <div><button type="button" className="btn btn-sm btn-ghost" onClick={() => setLineas([...lineas, { articuloId: "", cantidadEscrita: 0, unidad: "" }])}>+ {t("Add product", "Agregar producto")}</button></div>
        <div className="qbo-totales"><div><b>{t("Total (before tax)", "Total (sin impuesto)")}</b><b className="qbo-num">{dinero(total)}</b></div></div>
        {error && <p className="qbo-error" role="alert">{error}</p>}
      </div>
    </Ventana>
  );
}

function FichaOrden({ id, onCerrar, abrirEnvio }: { id: string; onCerrar: () => void; abrirEnvio: (id: string) => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbd();
  const n = useN();
  const msg = useError();
  const regla = useNombreDeRegla();
  const [error, setError] = useState("");
  const o = e.ordenes.find((x) => x.id === id);
  if (!o) return null;
  const estado = estadoDeOrdenVenta(o, e.envios);
  const llenar = Object.fromEntries(o.lineas.map((l) => [l.articuloId, Math.min(porSurtir(o, e.envios, l.articuloId), disponible(e, l.articuloId, o.sitioId, hoy))]));
  const puede = !o.cancelada && Object.values(llenar).some((v) => v > 0);
  const envios = e.envios.filter((x) => x.ordenId === o.id);
  const crear = () => {
    const p = { id: nuevoId("pk"), numero: siguienteNumero(e.envios.map((x) => x.numero), "PK-", 801), ordenId: o.id, fecha: hoy, cantidades: llenar };
    const r = crearEnvio(e, p, hoy);
    if (!r.ok) return setError(msg(r.error));
    d({ tipo: "crearEnvio", hoy, p });
    abrirEnvio(p.id);
  };
  return (
    <Ventana titulo={`${t("Sales order", "Orden de venta")} ${o.numero}`} onCerrar={onCerrar} ancho={900} pie={<>
      {!o.cancelada && estado !== "shipped" && <button type="button" className="btn btn-ghost" onClick={() => { if (window.confirm(t("Cancel this order?", "¿Cancelar esta orden?"))) d({ tipo: "cancelarOrden", id: o.id }); }}>{t("Cancel order", "Cancelar orden")}</button>}
      <button type="button" className="btn btn-primary" data-accion="crear-lista" disabled={!puede} onClick={crear}>{t("Create pick list for what's in stock", "Crear lista de surtido con lo que hay")}</button>
    </>}>
      <div className="qbo-form">
        <div className="qbo-explica">{n.cliente(o.clienteId)} · {n.sitio(o.sitioId)} · {o.fecha} <Insignia estado={estado} /></div>
        <div className="qbd-desliza">
          <div className="qbd-fila qbd-fila6 qbd-fila-cabeza">
            <span>{t("Product", "Producto")}</span><span>{t("Ordered", "Pedido")}</span><span>{t("Shipped", "Enviado")}</span><span>{t("On pick list", "En lista")}</span><span>{t("Free now", "Libre")}</span><span>{t("Backordered", "Pendiente")}</span>
          </div>
          {o.lineas.map((l) => {
            const pend = porSurtir(o, e.envios, l.articuloId);
            const hay = disponible(e, l.articuloId, o.sitioId, hoy);
            const falta = o.cancelada ? 0 : Math.max(0, pend - hay);
            return (
              <div key={l.articuloId} className="qbd-fila qbd-fila6" data-renglon={l.articuloId}>
                <span>{n.articulo(l.articuloId)}<br /><span className="qbo-explica">{l.cantidadEscrita} {n.unidad(l.unidad)} · {dinero(l.cantidad * l.precio)} · <span className="qbd-chip">{regla(l.regla)}</span></span></span>
                <span className="qbo-num">{l.cantidad}</span><span className="qbo-num">{l.enviado}</span><span className="qbo-num">{enLista(e.envios, o.id, l.articuloId)}</span>
                <span className="qbo-num">{hay}</span><span className={`qbo-num${falta ? " qbd-poco" : ""}`} data-pendiente={falta}>{falta}</span>
              </div>
            );
          })}
        </div>
        <p className="qbo-explica">{t("Quantities in", "Cantidades en")} {t("base units (boxes, bags, pieces).", "unidad base (cajas, bolsas, piezas).")} {t("Total", "Total")}: <b>{dinero(totalDeOrdenVenta(o))}</b></p>
        {envios.length > 0 && (
          <div className="qbo-lista">
            <b>{t("Pick lists", "Listas de surtido")}</b>
            {envios.map((x) => <button key={x.id} type="button" className="qbo-renglon btn-ghost" style={{ textAlign: "left" }} onClick={() => abrirEnvio(x.id)}><span>{x.numero} · {x.fecha}</span><Insignia estado={x.estado} /></button>)}
          </div>
        )}
        {error && <p className="qbo-error" role="alert">{error}</p>}
      </div>
    </Ventana>
  );
}

function Hoja({ alTerminar }: { alTerminar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbd();
  const n = useN();
  const msg = useError();
  const filasBase = useMemo(() => hojaDeSurtido(e, hoy), [e, hoy]);
  const [llenar, setLlenar] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const clave = (f: { ordenId: string; articuloId: string }) => `${f.ordenId}|${f.articuloId}`;
  const valor = (f: (typeof filasBase)[number]) => llenar[clave(f)] ?? f.sugerido;
  const filas = useMemo(() => filasBase.map((f) => ({ ...f, cliente: n.cliente(f.clienteId), nombre: n.articulo(f.articuloId), sitio: n.sitio(f.sitioId) })), [filasBase, n]);
  const columnas: ColumnaEstandar<(typeof filas)[number]>[] = [
    { key: "fecha", en: "Ordered", es: "Fecha", ancho: 100, fija: true, valor: (f) => f.fecha },
    { key: "numero", en: "Order", es: "Orden", ancho: 95, valor: (f) => f.numero },
    { key: "cliente", en: "Customer", es: "Cliente", ancho: 210, valor: (f) => f.cliente },
    { key: "nombre", en: "Product", es: "Producto", ancho: 220, valor: (f) => f.nombre },
    { key: "pendiente", en: "Still needed", es: "Falta mandar", ancho: 95, numerico: true, valor: (f) => f.pendiente },
    { key: "sugerido", en: "Fill now", es: "Surtir ahora", ancho: 110, numerico: true, valor: (f) => valor(f), celda: (f) => (
      <input type="number" min={0} max={f.pendiente} aria-label={t("Fill now", "Surtir ahora")} data-llenar={clave(f)} value={valor(f)} style={{ maxWidth: 80, padding: "3px 6px" }}
        onClick={(ev) => ev.stopPropagation()} onChange={(ev) => setLlenar({ ...llenar, [clave(f)]: Math.max(0, Math.min(f.pendiente, Math.floor(Number(ev.target.value) || 0))) })} />
    ) },
    { key: "backorder", en: "Stays backordered", es: "Queda pendiente", ancho: 120, numerico: true, valor: (f) => f.pendiente - valor(f), celda: (f) => { const b = f.pendiente - valor(f); return <span className={b ? "qbd-poco" : "qbd-cero"}>{b}</span>; } },
  ];
  const crear = () => {
    setError("");
    const porOrden = new Map<string, Record<string, number>>();
    for (const f of filasBase) {
      const v = valor(f);
      if (v > 0) porOrden.set(f.ordenId, { ...(porOrden.get(f.ordenId) ?? {}), [f.articuloId]: v });
    }
    if (!porOrden.size) return setError(t("Nothing to fill.", "No hay nada que surtir."));
    let s = e;
    for (const [ordenId, cantidades] of porOrden) {
      const r = crearEnvio(s, { id: nuevoId("pk"), numero: siguienteNumero(s.envios.map((x) => x.numero), "PK-", 801), ordenId, fecha: hoy, cantidades }, hoy);
      if (!r.ok) return setError(`${s.ordenes.find((o) => o.id === ordenId)?.numero}: ${msg(r.error)}`);
      s = r.e;
    }
    d({ tipo: "reemplazar", estado: s });
    setLlenar({});
    alTerminar();
  };
  const cortos = filas.filter((f) => f.backorder > 0).length;
  return (
    <>
      <p className="qbo-explica">{t("Every open order line that still needs product. When stock is short, the oldest order gets it first; change “Fill now” to give it to someone else (for example, a contractor waiting on a whole job from one lot).",
        "Cada renglón de orden abierta que todavía necesita producto. Si no alcanza, se le da primero a la orden más vieja; cambia «Surtir ahora» para dárselo a otro (por ejemplo, a un contratista que espera todo un trabajo de un mismo lote).")}</p>
      {cortos > 0 && <p className="qbo-error">{t(`${cortos} line(s) can't be filled completely with what's in stock.`, `${cortos} renglón(es) no se pueden surtir completos con lo que hay.`)}</p>}
      <TablaEstandar id="app-draft-qbd-hoja" filas={filas} claveDe={clave} columnas={columnas} ordenInicial={{ clave: "fecha", direccion: "asc" }}
        vacio={t("Every order is filled. Nothing waiting.", "Todas las órdenes están surtidas. No hay nada esperando.")} />
      <div className="qbo-barra"><button type="button" className="btn btn-primary btn-sm" data-accion="crear-listas" disabled={!filas.length} onClick={crear}>{t("Create pick lists", "Crear listas de surtido")}</button></div>
      {error && <p className="qbo-error" role="alert">{error}</p>}
    </>
  );
}

function Envios({ abierto, setAbierto }: { abierto: string | null; setAbierto: (id: string | null) => void }) {
  const { t } = usePrefs();
  const { e } = useQbd();
  const n = useN();
  const filas = useMemo(() => e.envios.map((x) => {
    const o = e.ordenes.find((y) => y.id === x.ordenId);
    return { ...x, orden: o?.numero ?? "—", cliente: o ? n.cliente(o.clienteId) : "—", renglones: x.lineas.length };
  }), [e, n]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "numero", en: "Pick list", es: "Lista", ancho: 100, fija: true, valor: (x) => x.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 100, valor: (x) => x.fecha },
    { key: "orden", en: "Order", es: "Orden", ancho: 95, valor: (x) => x.orden },
    { key: "cliente", en: "Customer", es: "Cliente", ancho: 230, valor: (x) => x.cliente },
    { key: "renglones", en: "Lines", es: "Renglones", ancho: 80, numerico: true, valor: (x) => x.renglones },
    { key: "estado", en: "Status", es: "Estado", ancho: 120, valor: (x) => x.estado, etiqueta: (v) => etiqueta(String(v), t), celda: (x) => <Insignia estado={x.estado} /> },
  ], [t]);
  return (
    <>
      <TablaEstandar id="app-draft-qbd-envios" filas={filas} claveDe={(x) => x.id} columnas={columnas} onFila={(x) => setAbierto(x.id)} ordenInicial={{ clave: "fecha", direccion: "desc" }}
        vacio={t("No pick lists yet. Create one from a sales order or from “Which orders to fill”.", "Todavía no hay listas. Créalas desde una orden de venta o desde «Qué órdenes surtir».")} />
      {abierto && <FichaEnvio id={abierto} onCerrar={() => setAbierto(null)} />}
    </>
  );
}

function FichaEnvio({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d } = useQbd();
  const n = useN();
  const msg = useError();
  const [codigo, setCodigo] = useState("");
  const [cuantas, setCuantas] = useState(0);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const x = e.envios.find((y) => y.id === id);
  if (!x) return null;
  const o = e.ordenes.find((y) => y.id === x.ordenId);
  const pasos = ["picking", "picked", "packed", "shipped"] as const;
  const ahora = pasos.indexOf(x.estado);
  const siguiente: Record<string, string> = {
    picking: t("Mark picked (takes it off the shelf)", "Marcar surtido (sale del estante)"),
    picked: t("Mark packed", "Marcar empacado"),
    packed: t("Mark shipped", "Marcar enviado"),
  };
  const escaneo = () => {
    const linea = x.lineas.find((l) => n.sku(l.articuloId).toUpperCase() === codigo.trim().toUpperCase());
    const r = escanear(e, x.id, codigo, cuantas || (linea ? linea.cantidad - linea.escaneado : 1), n.sku);
    if (r.error === "unknown") setAviso({ ok: false, texto: t(`“${codigo.trim()}” is not on this pick list.`, `«${codigo.trim()}» no está en esta lista.`) });
    else if (r.error === "complete") setAviso({ ok: false, texto: t("That line is already complete.", "Ese renglón ya está completo.") });
    else { d({ tipo: "reemplazar", estado: r.e }); setAviso({ ok: true, texto: `✓ ${n.articulo(r.articuloId!)}` }); }
    setCodigo("");
  };
  const avanzar = () => {
    const r = avanzarEnvio(e, x.id);
    if (!r.ok) return setAviso({ ok: false, texto: msg(r.error) });
    d({ tipo: "avanzarEnvio", id: x.id });
    setAviso(null);
  };
  return (
    <Ventana titulo={`${t("Pick list", "Lista de surtido")} ${x.numero}`} onCerrar={onCerrar} ancho={860} pie={<>
      {x.estado === "picking" && <button type="button" className="btn btn-ghost" onClick={() => { d({ tipo: "cancelarEnvio", id: x.id }); onCerrar(); }}>{t("Cancel pick list", "Cancelar lista")}</button>}
      {x.estado !== "shipped" && <button type="button" className="btn btn-primary" data-accion="avanzar-envio" onClick={avanzar}>{siguiente[x.estado]}</button>}
    </>}>
      <div className="qbo-form">
        <div className="qbo-explica">{o?.numero} · {o ? n.cliente(o.clienteId) : ""} · {o ? n.sitio(o.sitioId) : ""}</div>
        <div className="qbd-pasos" data-pasos>
          {pasos.map((p, i) => <span key={p} className={`qbd-paso${i < ahora ? " qbd-paso-hecho" : i === ahora ? " qbd-paso-ahora" : ""}`}>{i < ahora ? "✓ " : ""}{etiqueta(p, t)}</span>)}
        </div>
        {x.estado === "picking" && (
          <div className="qbd-escaner">
            <input value={codigo} autoFocus placeholder={t("Scan or type a SKU, then Enter", "Escanea o escribe un SKU y Enter")} aria-label={t("Scan SKU", "Escanear SKU")} data-campo="escanear"
              onChange={(ev) => setCodigo(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter" && codigo.trim()) escaneo(); }} />
            <input type="number" min={0} value={cuantas || ""} placeholder={t("qty (all)", "cant. (todo)")} aria-label={t("Quantity per scan", "Cantidad por escaneo")} style={{ flex: "0 0 110px" }} onChange={(ev) => setCuantas(Math.floor(Number(ev.target.value) || 0))} />
            <button type="button" className="btn btn-sm btn-ghost" disabled={!codigo.trim()} onClick={escaneo}>{t("Scan", "Escanear")}</button>
          </div>
        )}
        {aviso && <p className={aviso.ok ? "qbo-ok" : "qbo-error"} role="status">{aviso.texto}</p>}
        <div className="qbo-lista">
          {x.lineas.map((l) => {
            const j = n.juego(l.articuloId);
            return (
              <div key={l.articuloId} className="qbo-caja" data-renglon-lista={n.sku(l.articuloId)}>
                <div className="qbo-renglon"><span><b>{n.articulo(l.articuloId)}</b> · <code>{n.sku(l.articuloId)}</code></span><span className="qbo-num">{l.escaneado >= l.cantidad ? "✓ " : ""}{l.escaneado}/{l.cantidad} {n.unidad(j?.envio ?? n.base(l.articuloId))}</span></div>
                {l.tomas.map((tm) => {
                  const ex = e.existencias.find((y) => y.id === tm.existenciaId);
                  return <div key={tm.existenciaId} className="qbo-explica">→ {t("Take", "Toma")} {tm.cantidad} {t("from", "de")} <b>{ex ? n.bin(ex.binId) : "✓"}</b>{ex?.lote ? ` · ${t("lot", "lote")} ${ex.lote}` : ""}{ex?.caduca ? ` · ${t("expires", "caduca")} ${ex.caduca}` : ""}</div>;
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Ventana>
  );
}
