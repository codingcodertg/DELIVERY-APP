"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { telefonoEstandar } from "@/lib/recruiting/formato";
import { cabeEnCuenta, convertir, r2, siguiente } from "@/lib/app-draft/compfloor/logica";
import { NOMBRE_TIENDA, type Pago, type Tienda, type VentaMostrador } from "@/lib/app-draft/compfloor/tipos";
import { Campo } from "../quickbooks-online/piezas";
import { Ventana, dinero, nuevoId } from "../quickbooks-online/comun";
import { SelectorTienda, useCf, useDescribeLote, useTextos } from "./comun";
import { EditorDeVenta, borradorVacio, useCalculaLineas, type Borrador } from "./piezas";

/** Venta de mostrador: contado o a la cuenta del instalador (con límite), y el ticket para que el patio cargue. */
export function Mostrador() {
  const { t } = usePrefs();
  const { e, d, hoy } = useCf();
  const x = useTextos();
  const [clienteId, setClienteId] = useState("");
  const [tienda, setTienda] = useState<Tienda>("mca");
  const [pago, setPago] = useState<Pago>("cash");
  const [lineas, setLineas] = useState<Borrador[]>([borradorVacio()]);
  const [error, setError] = useState("");
  const [ticket, setTicket] = useState<VentaMostrador | null>(null);
  const cliente = e.clientes.find((c) => c.id === clienteId);
  const calc = useCalculaLineas(lineas, cliente?.tipo ?? null);
  const total = r2(calc.reduce((s, c) => s + c.importe, 0));
  const cuenta = cabeEnCuenta(cliente, total);
  const vender = () => {
    const buenas = calc.filter((c) => c.a && c.cajas > 0);
    if (!buenas.length) return setError(t("Add at least one product with a quantity.", "Agrega al menos un producto con cantidad."));
    if (buenas.some((c) => !c.b.existenciaId)) return setError(t("Pick the lot for each product — the yard loads from that lot.", "Elige el lote de cada producto: el patio carga de ese lote."));
    if (buenas.some((c) => c.falta > 0)) return setError(t("A line asks for more than is free in its lot.", "Una línea pide más de lo libre en su lote."));
    if (pago === "account" && !cuenta.ok) return setError(cliente?.limite == null ? t("This customer has no open account. Take cash or card.", "Este cliente no tiene cuenta abierta. Cobra en efectivo o tarjeta.") : t(`Over the credit limit: only ${dinero(cuenta.disponible)} available.`, `Pasa el límite de crédito: solo hay ${dinero(cuenta.disponible)} disponibles.`));
    const v: VentaMostrador = {
      id: nuevoId("cs"), numero: siguiente(e.ventas.map((y) => y.numero), "CS-", 9001), clienteId: clienteId || null, tienda, fecha: hoy, pago,
      lineas: buenas.map((c) => ({ articuloId: c.a!.id, existenciaId: c.b.existenciaId!, cajas: c.cajas, precioCaja: c.precio })), total,
    };
    d({ tipo: "venta", venta: v });
    setTicket(v);
    setLineas([borradorVacio()]);
    setError("");
  };
  return (
    <section className="qbo-seccion">
      <div className="qbo-caja" data-mostrador>
        <h2>{t("Counter sale", "Venta de mostrador")}</h2>
        <div className="qbo-form">
          <div className="qbo-campos">
            <Campo etiqueta={t("Customer (leave empty for walk-in)", "Cliente (vacío = de paso)")}>
              <select value={clienteId} data-campo="cliente" onChange={(ev) => { setClienteId(ev.target.value); const c = e.clientes.find((y) => y.id === ev.target.value); setPago(c?.limite != null ? "account" : "cash"); }}>
                <option value="">{t("Walk-in customer", "Cliente de paso")}</option>
                {e.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
            <Campo etiqueta={t("Store", "Tienda")}><SelectorTienda valor={tienda} onCambia={(s) => setTienda((s || "mca") as Tienda)} /></Campo>
          </div>
          {cliente && <p className="qbo-explica">{x.tipo(cliente.tipo)} · {telefonoEstandar(cliente.telefono)}{cliente.limite != null && <> · {t("account", "cuenta")}: {t("owes", "debe")} {dinero(cliente.saldo)} {t("of", "de")} {dinero(cliente.limite)} — <b>{dinero(cuenta.disponible)} {t("available", "disponible")}</b></>}</p>}
          <EditorDeVenta lineas={lineas} onCambia={setLineas} tienda={tienda} tipo={cliente?.tipo ?? null} modo="counter" />
          <div className="qbo-barra" role="radiogroup" aria-label={t("Payment", "Pago")}>
            {(["cash", "card", "account"] as Pago[]).map((p) => (
              <label key={p} className="cf-check"><input type="radio" name="cf-pago" value={p} checked={pago === p} disabled={p === "account" && cliente?.limite == null} onChange={() => setPago(p)} /> {p === "cash" ? t("Cash", "Efectivo") : p === "card" ? t("Card", "Tarjeta") : t("Charge to account", "Cargar a la cuenta")}</label>
            ))}
          </div>
          {pago === "account" && cliente?.limite != null && !cuenta.ok && total > 0 && <p className="cf-aviso qbo-rojo" role="alert">{t(`This sale (${dinero(total)}) is over the credit limit — ${dinero(cuenta.disponible)} available.`, `Esta venta (${dinero(total)}) pasa el límite de crédito: hay ${dinero(cuenta.disponible)} disponibles.`)}</p>}
          {error && <p className="qbo-error" role="alert">{error}</p>}
          <div><button type="button" className="btn btn-primary" data-accion="cobrar" onClick={vender}>{pago === "account" ? t(`Charge ${dinero(total)} to account`, `Cargar ${dinero(total)} a la cuenta`) : t(`Take ${dinero(total)}`, `Cobrar ${dinero(total)}`)}</button></div>
        </div>
      </div>
      {ticket && <Ticket v={ticket} onCerrar={() => setTicket(null)} />}
    </section>
  );
}

/** El ticket del patio: qué cargar, de qué lote y de qué bin. */
function Ticket({ v, onCerrar }: { v: VentaMostrador; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e } = useCf();
  const x = useTextos();
  const desc = useDescribeLote();
  const cliente = e.clientes.find((c) => c.id === v.clienteId);
  return (
    <Ventana titulo={t("Pick ticket for the warehouse", "Ticket de carga para el patio")} onCerrar={onCerrar} ancho={560} pie={<>
      <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖨 {t("Print", "Imprimir")}</button>
      <button type="button" className="btn btn-primary" onClick={onCerrar}>{t("Done", "Listo")}</button>
    </>}>
      <div className="cf-ticket" data-ticket={v.numero}>
        <div className="qbo-renglon"><b>{v.numero}</b><span>{NOMBRE_TIENDA[v.tienda]} · {v.fecha}</span></div>
        <div className="qbo-renglon"><span>{cliente?.nombre ?? t("Walk-in customer", "Cliente de paso")}</span><b>{v.pago === "account" ? t("ON ACCOUNT", "A CUENTA") : v.pago === "card" ? t("PAID · CARD", "PAGADO · TARJETA") : t("PAID · CASH", "PAGADO · EFECTIVO")}</b></div>
        {v.lineas.map((l, i) => {
          const a = e.articulos.find((y) => y.id === l.articuloId)!;
          const ex = e.existencias.find((y) => y.id === l.existenciaId);
          const c = convertir(a, l.cajas, "box");
          return (
            <div key={i} className="cf-ticket-linea">
              <b>☐ {l.cajas} {x.unidad("box", l.cajas)} · {a.sku}</b>
              <span>{a.nombre}{a.sqftPorCaja > 0 ? ` (${c.sqft} ${x.unidad("sqft")})` : ""}</span>
              <span className="qbo-explica">{desc(ex)}</span>
            </div>
          );
        })}
        <div className="qbo-renglon qbo-renglon-total"><span>{t("Total", "Total")}</span><span className="qbo-num">{dinero(v.total)}</span></div>
        <p className="qbo-explica">{t("Loaded by: ________   Checked by: ________", "Cargó: ________   Revisó: ________")}</p>
      </div>
    </Ventana>
  );
}
