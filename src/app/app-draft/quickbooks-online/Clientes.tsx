"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { telefonoEstandar } from "@/lib/recruiting/formato";
import { tasaDeImpuesto } from "@/lib/estimator/modelo";
import {
  antiguedadPorCobrar, facturasConSaldo, impuestoDe, r2, saldoDeCliente, sinAplicarNota, sinAplicarPago, subtotalDe,
  sumaDias, totalDe, validaAplicacion, type FilaDeAntiguedad,
} from "@/lib/app-draft/qbo/contabilidad";
import { siguienteNumero } from "@/lib/app-draft/qbo/estado";
import { TIENDAS } from "@/lib/app-draft/qbo/muestra";
import type { Aplicacion, Cliente, Factura, Linea, NotaDeCredito, PagoRecibido } from "@/lib/app-draft/qbo/tipos";
import { Estado, SubSecciones, Ventana, dinero, etiquetaDeEstado, nuevoId, useNombres, useQbo } from "./comun";
import { Aplicador, Campo, EditorDeLineas, type DocAbierto } from "./piezas";

type Sub = "customers" | "invoices" | "payments" | "credits" | "aging";

type Abierto =
  | { tipo: "factura"; id: string | null; clienteId?: string }
  | { tipo: "pago"; clienteId?: string; facturaId?: string }
  | { tipo: "verPago"; id: string }
  | { tipo: "nota"; clienteId?: string }
  | { tipo: "verNota"; id: string }
  | { tipo: "cliente"; id: string }
  | { tipo: "nuevoCliente" }
  | { tipo: "estadoDeCuenta"; id: string };

/** Clientes y cobros (cuentas por cobrar): clientes, facturas, pagos recibidos, notas de crédito y antigüedad. */
export function Clientes() {
  const { t } = usePrefs();
  const [sub, setSub] = useState<Sub>("invoices");
  const [abierto, setAbierto] = useState<Abierto | null>(null);
  const cerrar = () => setAbierto(null);
  return (
    <section className="qbo-seccion">
      <div className="qbo-barra">
        <button type="button" className="btn btn-primary btn-sm" data-accion="nueva-factura" onClick={() => setAbierto({ tipo: "factura", id: null })}>+ {t("New invoice", "Nueva factura")}</button>
        <button type="button" className="btn btn-green btn-sm" data-accion="recibir-pago" onClick={() => setAbierto({ tipo: "pago" })}>💵 {t("Receive payment", "Recibir pago")}</button>
        <button type="button" className="btn btn-ghost btn-sm" data-accion="nueva-nota" onClick={() => setAbierto({ tipo: "nota" })}>↩ {t("New credit memo", "Nueva nota de crédito")}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbierto({ tipo: "nuevoCliente" })}>+ {t("New customer", "Nuevo cliente")}</button>
      </div>
      <SubSecciones valor={sub} onCambia={setSub} opciones={[
        { clave: "invoices", texto: t("Invoices", "Facturas") },
        { clave: "customers", texto: t("Customers", "Clientes") },
        { clave: "payments", texto: t("Payments received", "Pagos recibidos") },
        { clave: "credits", texto: t("Credit memos", "Notas de crédito") },
        { clave: "aging", texto: t("Who owes and how late (aging)", "Quién debe y cuánto atraso (antigüedad)") },
      ]} />
      {sub === "customers" && <ListaClientes abrir={(id) => setAbierto({ tipo: "cliente", id })} />}
      {sub === "invoices" && <ListaFacturas abrir={(id) => setAbierto({ tipo: "factura", id })} />}
      {sub === "payments" && <ListaPagos abrir={(id) => setAbierto({ tipo: "verPago", id })} />}
      {sub === "credits" && <ListaNotas abrir={(id) => setAbierto({ tipo: "verNota", id })} />}
      {sub === "aging" && <AntiguedadCobrar abrir={(id) => setAbierto({ tipo: "cliente", id })} />}

      {abierto?.tipo === "factura" && <FichaFactura id={abierto.id} clienteId={abierto.clienteId} onCerrar={cerrar} cobrar={(facturaId, clienteId) => setAbierto({ tipo: "pago", facturaId, clienteId })} />}
      {abierto?.tipo === "pago" && <FormPago clienteInicial={abierto.clienteId} facturaInicial={abierto.facturaId} onCerrar={cerrar} />}
      {abierto?.tipo === "verPago" && <VerPago id={abierto.id} onCerrar={cerrar} />}
      {abierto?.tipo === "nota" && <FormNota clienteInicial={abierto.clienteId} onCerrar={cerrar} />}
      {abierto?.tipo === "verNota" && <VerNota id={abierto.id} onCerrar={cerrar} />}
      {abierto?.tipo === "cliente" && <FichaCliente id={abierto.id} onCerrar={cerrar} ir={setAbierto} />}
      {abierto?.tipo === "nuevoCliente" && <FormCliente onCerrar={cerrar} />}
      {abierto?.tipo === "estadoDeCuenta" && <EstadoDeCuenta id={abierto.id} onCerrar={cerrar} />}
    </section>
  );
}

// ------------------------------------------------------------------ listas
function ListaClientes({ abrir }: { abrir: (id: string) => void }) {
  const { t } = usePrefs();
  const { e } = useQbo();
  const filas = useMemo(() => e.clientes.map((c) => ({ ...c, saldo: saldoDeCliente(e, c.id) })), [e]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "nombre", en: "Customer", es: "Cliente", ancho: 190, fija: true, valor: (c) => c.nombre },
    { key: "empresa", en: "Company", es: "Empresa", ancho: 190, valor: (c) => c.empresa },
    { key: "tipo", en: "Type", es: "Tipo", ancho: 110, valor: (c) => c.tipo },
    { key: "tienda", en: "Store", es: "Tienda", ancho: 130, valor: (c) => c.tienda },
    { key: "telefono", en: "Phone", es: "Teléfono", ancho: 130, valor: (c) => c.telefono },
    { key: "email", en: "Email", es: "Correo", ancho: 210, oculta: true, valor: (c) => c.email },
    { key: "plazo", en: "Terms (days)", es: "Plazo (días)", ancho: 100, numerico: true, valor: (c) => c.plazo },
    { key: "saldo", en: "Open balance", es: "Saldo abierto", ancho: 130, numerico: true, valor: (c) => c.saldo, celda: (c) => dinero(c.saldo) },
  ], []);
  return <TablaEstandar id="app-draft-qbo-clientes" filas={filas} claveDe={(c) => c.id} columnas={columnas} onFila={(c) => abrir(c.id)}
    ordenInicial={{ clave: "saldo", direccion: "desc" }} vacio={t("No customers yet.", "Todavía no hay clientes.")} />;
}

function ListaFacturas({ abrir }: { abrir: (id: string) => void }) {
  const { t } = usePrefs();
  const { e, hoy } = useQbo();
  const n = useNombres();
  const filas = useMemo(() => facturasConSaldo(e, hoy).map((x) => ({ ...x, cliente: n.cliente(x.factura.clienteId) })), [e, hoy, n]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "numero", en: "No.", es: "Núm.", ancho: 80, fija: true, valor: (x) => x.factura.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 105, valor: (x) => x.factura.fecha },
    { key: "cliente", en: "Customer", es: "Cliente", ancho: 190, valor: (x) => x.cliente },
    { key: "tienda", en: "Store", es: "Tienda", ancho: 130, oculta: true, valor: (x) => x.factura.tienda },
    { key: "vence", en: "Due", es: "Vence", ancho: 105, valor: (x) => x.factura.vence },
    { key: "total", en: "Total", es: "Total", ancho: 110, numerico: true, valor: (x) => x.total, celda: (x) => dinero(x.total) },
    { key: "saldo", en: "Still owed", es: "Falta pagar", ancho: 110, numerico: true, valor: (x) => x.saldo, celda: (x) => dinero(x.saldo) },
    { key: "estado", en: "Status", es: "Estado", ancho: 130, valor: (x) => x.estado, etiqueta: (v) => etiquetaDeEstado(String(v), t), celda: (x) => <Estado estado={x.estado} /> },
  ], [t]);
  return <TablaEstandar id="app-draft-qbo-facturas" filas={filas} claveDe={(x) => x.factura.id} columnas={columnas} onFila={(x) => abrir(x.factura.id)}
    ordenInicial={{ clave: "fecha", direccion: "desc" }} vacio={t("No invoices yet.", "Todavía no hay facturas.")} />;
}

const METODOS: Record<PagoRecibido["metodo"], [string, string]> = { check: ["Check", "Cheque"], card: ["Card", "Tarjeta"], cash: ["Cash", "Efectivo"], transfer: ["Bank transfer", "Transferencia"] };

function ListaPagos({ abrir }: { abrir: (id: string) => void }) {
  const { t } = usePrefs();
  const { e } = useQbo();
  const n = useNombres();
  const filas = useMemo(() => e.pagos.map((p) => ({ ...p, cliente: n.cliente(p.clienteId), sinAplicar: sinAplicarPago(p) })), [e, n]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "numero", en: "No.", es: "Núm.", ancho: 90, fija: true, valor: (p) => p.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 105, valor: (p) => p.fecha },
    { key: "cliente", en: "Customer", es: "Cliente", ancho: 190, valor: (p) => p.cliente },
    { key: "metodo", en: "Method", es: "Forma", ancho: 110, valor: (p) => t(...METODOS[p.metodo]) },
    { key: "referencia", en: "Reference", es: "Referencia", ancho: 100, valor: (p) => p.referencia },
    { key: "monto", en: "Amount", es: "Monto", ancho: 110, numerico: true, valor: (p) => p.monto, celda: (p) => dinero(p.monto) },
    { key: "sinAplicar", en: "Not applied yet", es: "Sin aplicar", ancho: 120, numerico: true, valor: (p) => p.sinAplicar, celda: (p) => dinero(p.sinAplicar) },
  ], [t]);
  return <TablaEstandar id="app-draft-qbo-pagos" filas={filas} claveDe={(p) => p.id} columnas={columnas} onFila={(p) => abrir(p.id)}
    ordenInicial={{ clave: "fecha", direccion: "desc" }} vacio={t("No payments yet.", "Todavía no hay pagos.")} />;
}

function ListaNotas({ abrir }: { abrir: (id: string) => void }) {
  const { t } = usePrefs();
  const { e } = useQbo();
  const n = useNombres();
  const filas = useMemo(() => e.notas.map((x) => ({ ...x, cliente: n.cliente(x.clienteId), total: totalDe(x.lineas, x.tasa), sinAplicar: sinAplicarNota(x) })), [e, n]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "numero", en: "No.", es: "Núm.", ancho: 90, fija: true, valor: (x) => x.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 105, valor: (x) => x.fecha },
    { key: "cliente", en: "Customer", es: "Cliente", ancho: 190, valor: (x) => x.cliente },
    { key: "motivo", en: "Reason", es: "Motivo", ancho: 200, valor: (x) => x.motivo },
    { key: "total", en: "Credit", es: "Crédito", ancho: 110, numerico: true, valor: (x) => x.total, celda: (x) => dinero(x.total) },
    { key: "sinAplicar", en: "Not used yet", es: "Sin usar", ancho: 110, numerico: true, valor: (x) => x.sinAplicar, celda: (x) => dinero(x.sinAplicar) },
  ], []);
  return (
    <>
      <p className="qbo-explica">{t("A credit memo is money we give back as credit (returns, damaged material). It lowers what the customer owes once applied to an invoice.",
        "Una nota de crédito es dinero que devolvemos como crédito (devoluciones, material dañado). Baja lo que el cliente debe cuando se aplica a una factura.")}</p>
      <TablaEstandar id="app-draft-qbo-notas" filas={filas} claveDe={(x) => x.id} columnas={columnas} onFila={(x) => abrir(x.id)}
        ordenInicial={{ clave: "fecha", direccion: "desc" }} vacio={t("No credit memos yet.", "Todavía no hay notas de crédito.")} />
    </>
  );
}

export function columnasDeAntiguedad(t: (en: string, es: string) => string, quien: [string, string]): ColumnaEstandar<FilaDeAntiguedad>[] {
  const num = (key: keyof FilaDeAntiguedad, en: string, es: string): ColumnaEstandar<FilaDeAntiguedad> => ({ key, en, es, ancho: 110, numerico: true, valor: (f) => f[key] as number, celda: (f) => dinero(f[key] as number) });
  return [
    { key: "nombre", en: quien[0], es: quien[1], ancho: 200, fija: true, valor: (f) => f.nombre },
    num("current", "Not due yet", "Aún no vence"),
    num("d1_30", "1–30 days late", "1–30 días tarde"),
    num("d31_60", "31–60 days late", "31–60 días tarde"),
    num("d61_90", "61–90 days late", "61–90 días tarde"),
    num("d90", "Over 90 days", "Más de 90 días"),
    num("total", "Total", "Total"),
  ];
}

export function totalesDeAntiguedad(filas: FilaDeAntiguedad[]) {
  const s = (k: keyof FilaDeAntiguedad) => dinero(r2(filas.reduce((a, f) => a + (f[k] as number), 0)));
  return { nombre: "Total", current: s("current"), d1_30: s("d1_30"), d31_60: s("d31_60"), d61_90: s("d61_90"), d90: s("d90"), total: s("total") };
}

function AntiguedadCobrar({ abrir }: { abrir: (id: string) => void }) {
  const { t } = usePrefs();
  const { e, hoy } = useQbo();
  const filas = useMemo(() => antiguedadPorCobrar(e, hoy), [e, hoy]);
  const columnas = useMemo(() => columnasDeAntiguedad(t, ["Customer", "Cliente"]), [t]);
  return (
    <>
      <p className="qbo-explica">{t("What each customer owes, split by how many days past the due date. Negative = customer credit we still hold.",
        "Lo que debe cada cliente, separado por cuántos días pasaron de la fecha de pago. Negativo = crédito a favor del cliente.")}</p>
      <TablaEstandar id="app-draft-qbo-antiguedad-ar" filas={filas} claveDe={(f) => f.id} columnas={columnas} onFila={(f) => abrir(f.id)}
        totales={totalesDeAntiguedad(filas)} vacio={t("Nobody owes us anything.", "Nadie nos debe nada.")} />
    </>
  );
}

// ------------------------------------------------------------------ factura
function FichaFactura({ id, clienteId, onCerrar, cobrar }: { id: string | null; clienteId?: string; onCerrar: () => void; cobrar: (facturaId: string, clienteId: string) => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbo();
  const existente = id ? e.facturas.find((f) => f.id === id) ?? null : null;
  const saldo = existente ? facturasConSaldo(e, hoy).find((x) => x.factura.id === existente.id)! : null;
  const tocada = !!saldo && (saldo.pagado > 0 || saldo.acreditado > 0);
  const inicialCliente = existente?.clienteId ?? clienteId ?? "";
  const cli0 = e.clientes.find((c) => c.id === inicialCliente);
  const [f, setF] = useState<Factura>(() => existente ?? {
    id: nuevoId("inv"), numero: siguienteNumero(e.facturas.map((x) => x.numero), "", 1001), clienteId: inicialCliente,
    tienda: cli0?.tienda ?? TIENDAS[0], fecha: hoy, vence: sumaDias(hoy, cli0?.plazo ?? 30),
    lineas: [{ articuloId: "", descripcion: "", cantidad: 1, precio: 0 }], tasa: tasaDeImpuesto(cli0?.tienda ?? TIENDAS[0]), borrador: true, enviada: false, nota: "",
  });
  const [error, setError] = useState("");
  const lineas = f.lineas.filter((l) => l.articuloId && l.cantidad > 0);
  const pon = (c: Partial<Factura>) => setF((x) => ({ ...x, ...c }));

  const guardarComo = (borrador: boolean) => {
    if (!f.clienteId) return setError(t("Choose a customer.", "Elige un cliente."));
    if (!lineas.length) return setError(t("Add at least one line with a product and quantity.", "Agrega al menos una línea con producto y cantidad."));
    d({ tipo: "guardarFactura", factura: { ...f, lineas, borrador, enviada: borrador ? false : true } });
    onCerrar();
  };

  const titulo = existente ? `${t("Invoice", "Factura")} #${f.numero}` : t("New invoice", "Nueva factura");
  if (tocada && existente && saldo) {
    // Con pagos o créditos ya aplicados se ve, no se edita (cambiarla movería lo ya cobrado).
    return (
      <Ventana titulo={titulo} onCerrar={onCerrar} pie={<>
        <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖨 {t("Print", "Imprimir")}</button>
        {saldo.saldo > 0 && <button type="button" className="btn btn-green" data-accion="cobrar" onClick={() => cobrar(existente.id, existente.clienteId)}>💵 {t("Receive payment", "Recibir pago")}</button>}
      </>}>
        <ResumenFactura f={existente} />
        <div className="qbo-totales">
          <div><span>{t("Paid", "Pagado")}</span><span className="qbo-num">{dinero(saldo.pagado)}</span></div>
          <div><span>{t("Credits applied", "Créditos aplicados")}</span><span className="qbo-num">{dinero(saldo.acreditado)}</span></div>
          <div><b>{t("Still owed", "Falta pagar")}</b><b className="qbo-num" data-saldo-factura>{dinero(saldo.saldo)}</b></div>
        </div>
        <p className="qbo-explica">{t("This invoice already has payments or credits, so it can't be edited. To fix it, issue a credit memo.", "Esta factura ya tiene pagos o créditos, así que no se edita. Para corregirla, haz una nota de crédito.")}</p>
      </Ventana>
    );
  }
  return (
    <Ventana titulo={titulo} onCerrar={onCerrar} ancho={860} pie={<>
      {existente?.borrador && <button type="button" className="btn btn-danger" onClick={() => { d({ tipo: "borrarFactura", id: existente.id }); onCerrar(); }}>{t("Delete draft", "Borrar borrador")}</button>}
      <button type="button" className="btn btn-ghost" data-accion="guardar-borrador" onClick={() => guardarComo(true)}>{t("Save as draft", "Guardar borrador")}</button>
      <button type="button" className="btn btn-primary" data-accion="guardar-enviar" onClick={() => guardarComo(false)}>{t("Save and send", "Guardar y enviar")}</button>
      {existente && !existente.borrador && saldo && saldo.saldo > 0 && <button type="button" className="btn btn-green" onClick={() => cobrar(existente.id, existente.clienteId)}>💵 {t("Receive payment", "Recibir pago")}</button>}
    </>}>
      <div className="qbo-form">
        {existente && <div><Estado estado={saldo!.estado} /></div>}
        <div className="qbo-campos">
          <Campo etiqueta={t("Customer", "Cliente")}>
            <select value={f.clienteId} data-campo="cliente" onChange={(ev) => {
              const c = e.clientes.find((x) => x.id === ev.target.value);
              pon(c ? { clienteId: c.id, tienda: c.tienda, tasa: tasaDeImpuesto(c.tienda), vence: sumaDias(f.fecha, c.plazo) } : { clienteId: "" });
            }}>
              <option value="">{t("Choose…", "Elige…")}</option>
              {e.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.empresa ? ` · ${c.empresa}` : ""}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("Store (sets the tax)", "Tienda (define el impuesto)")}>
            <select value={f.tienda} onChange={(ev) => pon({ tienda: ev.target.value, tasa: tasaDeImpuesto(ev.target.value) })}>
              {TIENDAS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("Invoice date", "Fecha")}><input type="date" value={f.fecha} onChange={(ev) => pon({ fecha: ev.target.value })} /></Campo>
          <Campo etiqueta={t("Due date", "Vence")}><input type="date" value={f.vence} onChange={(ev) => pon({ vence: ev.target.value })} /></Campo>
        </div>
        <EditorDeLineas lineas={f.lineas} onCambia={(l) => pon({ lineas: l })} />
        <div className="qbo-totales">
          <div><span>{t("Subtotal", "Subtotal")}</span><span className="qbo-num">{dinero(subtotalDe(lineas))}</span></div>
          <div><span>{t("Sales tax", "Impuesto")} {f.tasa}%</span><span className="qbo-num">{dinero(impuestoDe(lineas, f.tasa))}</span></div>
          <div><b>{t("Total", "Total")}</b><b className="qbo-num" data-total-factura>{dinero(totalDe(lineas, f.tasa))}</b></div>
        </div>
        <Campo etiqueta={t("Note to the customer", "Nota para el cliente")}><textarea rows={2} value={f.nota} onChange={(ev) => pon({ nota: ev.target.value })} /></Campo>
        {error && <p className="qbo-error" role="alert">{error}</p>}
      </div>
    </Ventana>
  );
}

function ResumenFactura({ f }: { f: Factura | NotaDeCredito }) {
  const { t } = usePrefs();
  const n = useNombres();
  return (
    <div className="qbo-form">
      <div className="qbo-explica">{n.cliente(f.clienteId)} · {f.fecha}{"vence" in f ? ` · ${t("due", "vence")} ${f.vence}` : ""}</div>
      {f.lineas.map((l, i) => (
        <div key={i} className="qbo-renglon"><span>{l.descripcion} <span className="qbo-gris">× {l.cantidad} @ {dinero(l.precio)}</span></span><span className="qbo-num">{dinero(r2(l.cantidad * l.precio))}</span></div>
      ))}
      <div className="qbo-totales">
        <div><span>{t("Subtotal", "Subtotal")}</span><span className="qbo-num">{dinero(subtotalDe(f.lineas))}</span></div>
        <div><span>{t("Sales tax", "Impuesto")} {f.tasa}%</span><span className="qbo-num">{dinero(impuestoDe(f.lineas, f.tasa))}</span></div>
        <div><b>{t("Total", "Total")}</b><b className="qbo-num">{dinero(totalDe(f.lineas, f.tasa))}</b></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pagos
function abiertasDe(e: ReturnType<typeof useQbo>["e"], hoy: string, clienteId: string): DocAbierto[] {
  return facturasConSaldo(e, hoy).filter((x) => x.factura.clienteId === clienteId && !x.factura.borrador && x.saldo > 0.005)
    .map((x) => ({ id: x.factura.id, numero: x.factura.numero, fecha: x.factura.fecha, vence: x.factura.vence, saldo: x.saldo }));
}

function FormPago({ clienteInicial, facturaInicial, onCerrar }: { clienteInicial?: string; facturaInicial?: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbo();
  const [clienteId, setClienteId] = useState(clienteInicial ?? "");
  const abiertas = clienteId ? abiertasDe(e, hoy, clienteId) : [];
  const fac0 = abiertas.find((a) => a.id === facturaInicial);
  const [monto, setMonto] = useState<number>(fac0?.saldo ?? 0);
  const [aplicado, setAplicado] = useState<Aplicacion[]>(fac0 ? [{ facturaId: fac0.id, monto: fac0.saldo }] : []);
  const [fecha, setFecha] = useState(hoy);
  const [metodo, setMetodo] = useState<PagoRecibido["metodo"]>("check");
  const [referencia, setReferencia] = useState("");
  const [error, setError] = useState("");
  const guardar = () => {
    if (!clienteId) return setError(t("Choose a customer.", "Elige un cliente."));
    if (!(monto > 0)) return setError(t("Enter the amount received.", "Escribe el monto recibido."));
    const saldos = Object.fromEntries(abiertas.map((a) => [a.id, a.saldo]));
    const err = validaAplicacion(monto, aplicado, saldos);
    if (err) return setError(err === "over-amount" ? t("You applied more than the amount received.", "Aplicaste más de lo recibido.") : t("An amount is larger than what that invoice owes.", "Un monto pasa de lo que debe esa factura."));
    d({ tipo: "recibirPago", pago: { id: nuevoId("pay"), numero: siguienteNumero(e.pagos.map((p) => p.numero), "P-", 2001), clienteId, fecha, monto: r2(monto), metodo, referencia, cuentaBanco: "a-1000", aplicado } });
    onCerrar();
  };
  return (
    <Ventana titulo={t("Receive payment", "Recibir pago")} onCerrar={onCerrar} pie={<button type="button" className="btn btn-green" data-accion="guardar-pago" onClick={guardar}>{t("Save payment", "Guardar pago")}</button>}>
      <div className="qbo-form">
        <div className="qbo-campos">
          <Campo etiqueta={t("Customer", "Cliente")}>
            <select value={clienteId} data-campo="cliente-pago" onChange={(ev) => { setClienteId(ev.target.value); setAplicado([]); }}>
              <option value="">{t("Choose…", "Elige…")}</option>
              {e.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({dinero(saldoDeCliente(e, c.id))})</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("Amount received", "Monto recibido")}><input type="number" min={0} step="0.01" inputMode="decimal" data-campo="monto-pago" value={monto || ""} onChange={(ev) => setMonto(Number(ev.target.value) || 0)} /></Campo>
          <Campo etiqueta={t("Date", "Fecha")}><input type="date" value={fecha} onChange={(ev) => setFecha(ev.target.value)} /></Campo>
          <Campo etiqueta={t("Method", "Forma de pago")}>
            <select value={metodo} onChange={(ev) => setMetodo(ev.target.value as PagoRecibido["metodo"])}>
              {Object.entries(METODOS).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("Reference (check #)", "Referencia (núm. de cheque)")}><input value={referencia} onChange={(ev) => setReferencia(ev.target.value)} /></Campo>
        </div>
        <p className="qbo-explica">{t("Pick which invoices this payment pays. It can pay one or many, in full or in part.", "Elige qué facturas paga este pago. Puede pagar una o varias, completas o en parte.")}</p>
        {clienteId ? <Aplicador abiertos={abiertas} aplicado={aplicado} onCambia={setAplicado} disponible={monto} /> : <p className="qbo-gris">{t("Choose a customer to see their open invoices.", "Elige un cliente para ver sus facturas abiertas.")}</p>}
        {error && <p className="qbo-error" role="alert">{error}</p>}
      </div>
    </Ventana>
  );
}

function VerPago({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e } = useQbo();
  const n = useNombres();
  const p = e.pagos.find((x) => x.id === id);
  if (!p) return null;
  return (
    <Ventana titulo={`${t("Payment", "Pago")} ${p.numero}`} onCerrar={onCerrar} ancho={560}>
      <div className="qbo-form">
        <div className="qbo-explica">{n.cliente(p.clienteId)} · {p.fecha} · {t(...METODOS[p.metodo])} {p.referencia}</div>
        <div className="qbo-renglon qbo-renglon-total"><span>{t("Amount", "Monto")}</span><span className="qbo-num">{dinero(p.monto)}</span></div>
        {p.aplicado.map((a) => <div key={a.facturaId} className="qbo-renglon"><span>{t("Applied to invoice", "Aplicado a la factura")} #{e.facturas.find((f) => f.id === a.facturaId)?.numero}</span><span className="qbo-num">{dinero(a.monto)}</span></div>)}
        <div className="qbo-renglon"><span>{t("Not applied (customer credit)", "Sin aplicar (crédito del cliente)")}</span><span className="qbo-num">{dinero(sinAplicarPago(p))}</span></div>
      </div>
    </Ventana>
  );
}

// ------------------------------------------------------------------ notas de crédito
function FormNota({ clienteInicial, onCerrar }: { clienteInicial?: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbo();
  const [clienteId, setClienteId] = useState(clienteInicial ?? "");
  const cli = e.clientes.find((c) => c.id === clienteId);
  const [lineas, setLineas] = useState<Linea[]>([{ articuloId: "", descripcion: "", cantidad: 1, precio: 0 }]);
  const [motivo, setMotivo] = useState("");
  const [aplicado, setAplicado] = useState<Aplicacion[]>([]);
  const [error, setError] = useState("");
  const tasa = tasaDeImpuesto(cli?.tienda);
  const buenas = lineas.filter((l) => l.articuloId && l.cantidad > 0);
  const total = totalDe(buenas, tasa);
  const abiertas = clienteId ? abiertasDe(e, hoy, clienteId) : [];
  const guardar = () => {
    if (!clienteId) return setError(t("Choose a customer.", "Elige un cliente."));
    if (!buenas.length) return setError(t("Add what is being credited.", "Agrega lo que se acredita."));
    const err = validaAplicacion(total, aplicado, Object.fromEntries(abiertas.map((a) => [a.id, a.saldo])));
    if (err) return setError(t("You applied more than the credit or than an invoice owes.", "Aplicaste más que el crédito o que lo que debe una factura."));
    d({ tipo: "guardarNota", nota: { id: nuevoId("cm"), numero: siguienteNumero(e.notas.map((x) => x.numero), "CM-", 501), clienteId, fecha: hoy, lineas: buenas, tasa, motivo, aplicado } });
    onCerrar();
  };
  return (
    <Ventana titulo={t("New credit memo", "Nueva nota de crédito")} onCerrar={onCerrar} ancho={860} pie={<button type="button" className="btn btn-primary" data-accion="guardar-nota" onClick={guardar}>{t("Save credit memo", "Guardar nota")}</button>}>
      <div className="qbo-form">
        <div className="qbo-campos">
          <Campo etiqueta={t("Customer", "Cliente")}>
            <select value={clienteId} data-campo="cliente-nota" onChange={(ev) => { setClienteId(ev.target.value); setAplicado([]); }}>
              <option value="">{t("Choose…", "Elige…")}</option>
              {e.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("Reason", "Motivo")}><input value={motivo} placeholder={t("e.g. returned boxes", "p. ej. cajas devueltas")} onChange={(ev) => setMotivo(ev.target.value)} /></Campo>
        </div>
        <EditorDeLineas lineas={lineas} onCambia={setLineas} />
        <div className="qbo-totales"><div><b>{t("Credit total (with tax)", "Total del crédito (con impuesto)")} {tasa}%</b><b className="qbo-num">{dinero(total)}</b></div></div>
        <p className="qbo-explica">{t("Apply it now to open invoices, or leave it as credit to use later.", "Aplícala ya a facturas abiertas, o déjala como crédito para después.")}</p>
        {clienteId && <Aplicador abiertos={abiertas} aplicado={aplicado} onCambia={setAplicado} disponible={total} />}
        {error && <p className="qbo-error" role="alert">{error}</p>}
      </div>
    </Ventana>
  );
}

function VerNota({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbo();
  const nota = e.notas.find((x) => x.id === id);
  const [aplicado, setAplicado] = useState<Aplicacion[]>([]);
  const [error, setError] = useState("");
  if (!nota) return null;
  const libre = sinAplicarNota(nota);
  const abiertas = abiertasDe(e, hoy, nota.clienteId);
  return (
    <Ventana titulo={`${t("Credit memo", "Nota de crédito")} ${nota.numero}`} onCerrar={onCerrar} pie={libre > 0 ? <button type="button" className="btn btn-primary" data-accion="aplicar-nota" onClick={() => {
      const err = validaAplicacion(libre, aplicado, Object.fromEntries(abiertas.map((a) => [a.id, a.saldo])));
      if (err || !aplicado.length) return setError(t("Choose invoices and amounts within the credit left.", "Elige facturas y montos dentro del crédito que queda."));
      d({ tipo: "aplicarNota", id: nota.id, aplicado });
      onCerrar();
    }}>{t("Apply credit", "Aplicar crédito")}</button> : undefined}>
      <ResumenFactura f={nota} />
      <p className="qbo-explica">{t("Reason", "Motivo")}: {nota.motivo || "—"}</p>
      {nota.aplicado.map((a) => <div key={a.facturaId} className="qbo-renglon"><span>{t("Applied to invoice", "Aplicada a la factura")} #{e.facturas.find((f) => f.id === a.facturaId)?.numero}</span><span className="qbo-num">{dinero(a.monto)}</span></div>)}
      <div className="qbo-renglon qbo-renglon-total"><span>{t("Credit left to use", "Crédito que queda")}</span><span className="qbo-num">{dinero(libre)}</span></div>
      {libre > 0 && <div style={{ marginTop: 10 }}><Aplicador abiertos={abiertas} aplicado={aplicado} onCambia={setAplicado} disponible={libre} /></div>}
      {error && <p className="qbo-error" role="alert">{error}</p>}
    </Ventana>
  );
}

// ------------------------------------------------------------------ cliente
function FichaCliente({ id, onCerrar, ir }: { id: string; onCerrar: () => void; ir: (a: Abierto) => void }) {
  const { t } = usePrefs();
  const { e, hoy } = useQbo();
  const c = e.clientes.find((x) => x.id === id);
  if (!c) return null;
  const facturas = facturasConSaldo(e, hoy).filter((x) => x.factura.clienteId === id).sort((a, b) => b.factura.fecha.localeCompare(a.factura.fecha));
  return (
    <Ventana titulo={c.nombre} onCerrar={onCerrar} pie={<>
      <button type="button" className="btn btn-ghost" data-accion="estado-de-cuenta" onClick={() => ir({ tipo: "estadoDeCuenta", id })}>📄 {t("Statement", "Estado de cuenta")}</button>
      <button type="button" className="btn btn-ghost" onClick={() => ir({ tipo: "nota", clienteId: id })}>↩ {t("Credit memo", "Nota de crédito")}</button>
      <button type="button" className="btn btn-green" onClick={() => ir({ tipo: "pago", clienteId: id })}>💵 {t("Receive payment", "Recibir pago")}</button>
      <button type="button" className="btn btn-primary" onClick={() => ir({ tipo: "factura", id: null, clienteId: id })}>+ {t("Invoice", "Factura")}</button>
    </>}>
      <div className="qbo-form">
        <div className="qbo-explica">{c.empresa ?? t("Homeowner", "Dueño de casa")} · {c.telefono} · {c.email} · {c.tienda} · {c.plazo ? `Net ${c.plazo}` : t("Due on receipt", "Al recibir")}</div>
        <div className="qbo-renglon qbo-renglon-total"><span>{t("Open balance", "Saldo abierto")}</span><span className="qbo-num" data-saldo-cliente>{dinero(saldoDeCliente(e, id))}</span></div>
        <h4 style={{ margin: "6px 0 0" }}>{t("Invoices", "Facturas")}</h4>
        {facturas.length === 0 ? <p className="qbo-gris">{t("No invoices.", "Sin facturas.")}</p> : facturas.map((x) => (
          <button key={x.factura.id} type="button" className="qbo-renglon" style={{ width: "100%", background: "none", textAlign: "left" }} onClick={() => ir({ tipo: "factura", id: x.factura.id })}>
            <span>#{x.factura.numero} · {x.factura.fecha} <Estado estado={x.estado} /></span>
            <span className="qbo-num">{dinero(x.saldo)} / {dinero(x.total)}</span>
          </button>
        ))}
      </div>
    </Ventana>
  );
}

function FormCliente({ onCerrar }: { onCerrar: () => void }) {
  const { t } = usePrefs();
  const { d } = useQbo();
  const [c, setC] = useState<Cliente>({ id: nuevoId("c"), nombre: "", empresa: null, tipo: "contractor", telefono: "", email: "", tienda: TIENDAS[0], plazo: 30 });
  const [error, setError] = useState("");
  const pon = (x: Partial<Cliente>) => setC((y) => ({ ...y, ...x }));
  return (
    <Ventana titulo={t("New customer", "Nuevo cliente")} onCerrar={onCerrar} ancho={620} pie={<button type="button" className="btn btn-primary" onClick={() => {
      if (!c.nombre.trim()) return setError(t("Name is required.", "Falta el nombre."));
      d({ tipo: "guardarCliente", cliente: { ...c, nombre: c.nombre.trim(), empresa: c.empresa?.trim() || null, telefono: telefonoEstandar(c.telefono), email: c.email.trim().toLowerCase() } });
      onCerrar();
    }}>{t("Save", "Guardar")}</button>}>
      <div className="qbo-campos">
        <Campo etiqueta={t("Name", "Nombre")}><input value={c.nombre} onChange={(ev) => pon({ nombre: ev.target.value })} /></Campo>
        <Campo etiqueta={t("Company (optional)", "Empresa (opcional)")}><input value={c.empresa ?? ""} onChange={(ev) => pon({ empresa: ev.target.value })} /></Campo>
        <Campo etiqueta={t("Type", "Tipo")}>
          <select value={c.tipo} onChange={(ev) => pon({ tipo: ev.target.value as Cliente["tipo"] })}>
            <option value="contractor">{t("Contractor", "Contratista")}</option><option value="homeowner">{t("Homeowner", "Dueño de casa")}</option><option value="designer">{t("Designer", "Diseñador")}</option>
          </select>
        </Campo>
        <Campo etiqueta={t("Phone", "Teléfono")}><input type="tel" value={c.telefono} onChange={(ev) => pon({ telefono: ev.target.value })} onBlur={() => pon({ telefono: telefonoEstandar(c.telefono) })} /></Campo>
        <Campo etiqueta={t("Email", "Correo")}><input type="email" value={c.email} onChange={(ev) => pon({ email: ev.target.value })} /></Campo>
        <Campo etiqueta={t("Store", "Tienda")}><select value={c.tienda} onChange={(ev) => pon({ tienda: ev.target.value })}>{TIENDAS.map((s) => <option key={s}>{s}</option>)}</select></Campo>
        <Campo etiqueta={t("Days to pay (0 = on receipt)", "Días para pagar (0 = al recibir)")}><input type="number" min={0} value={c.plazo} onChange={(ev) => pon({ plazo: Number(ev.target.value) || 0 })} /></Campo>
      </div>
      {error && <p className="qbo-error" role="alert">{error}</p>}
    </Ventana>
  );
}

/** Estado de cuenta: cada factura, pago y nota del cliente con el saldo corrido. Se imprime. */
function EstadoDeCuenta({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e } = useQbo();
  const c = e.clientes.find((x) => x.id === id);
  if (!c) return null;
  const movs = [
    ...e.facturas.filter((f) => f.clienteId === id && !f.borrador).map((f) => ({ fecha: f.fecha, que: `${t("Invoice", "Factura")} #${f.numero}`, monto: totalDe(f.lineas, f.tasa) })),
    ...e.pagos.filter((p) => p.clienteId === id).map((p) => ({ fecha: p.fecha, que: `${t("Payment", "Pago")} ${p.numero}`, monto: -p.monto })),
    ...e.notas.filter((n) => n.clienteId === id).map((n) => ({ fecha: n.fecha, que: `${t("Credit memo", "Nota de crédito")} ${n.numero}`, monto: -totalDe(n.lineas, n.tasa) })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));
  let corrido = 0;
  return (
    <Ventana titulo={`${t("Statement", "Estado de cuenta")} · ${c.nombre}`} onCerrar={onCerrar} pie={<button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖨 {t("Print", "Imprimir")}</button>}>
      <div className="qbo-form" data-estado-de-cuenta>
        <div className="qbo-explica">RDZ Tile Group · {c.nombre}{c.empresa ? ` · ${c.empresa}` : ""}</div>
        {movs.length === 0 ? <p className="qbo-gris">{t("No activity.", "Sin movimientos.")}</p> : movs.map((m, i) => {
          corrido = r2(corrido + m.monto);
          return <div key={i} className="qbo-renglon"><span>{m.fecha} · {m.que}</span><span className="qbo-num">{dinero(m.monto)} · <b>{dinero(corrido)}</b></span></div>;
        })}
        <div className="qbo-renglon qbo-renglon-total"><span>{t("Balance due", "Saldo a pagar")}</span><span className="qbo-num">{dinero(saldoDeCliente(e, id))}</span></div>
      </div>
    </Ventana>
  );
}

