"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import {
  antiguedadPorPagar, facturasProvConSaldo, r2, saldoDeProveedor, sinAplicarCreditoProv, sumaDias, totalGasto, totalPagoProv,
} from "@/lib/app-draft/qbo/contabilidad";
import { siguienteNumero } from "@/lib/app-draft/qbo/estado";
import type { AplicacionAProveedor, FacturaProveedor, LineaDeGasto, PagoAProveedor } from "@/lib/app-draft/qbo/tipos";
import { Estado, SelectorDeCuenta, SubSecciones, Ventana, dinero, etiquetaDeEstado, nuevoId, useNombres, useQbo } from "./comun";
import { Aplicador, Campo } from "./piezas";
import { columnasDeAntiguedad, totalesDeAntiguedad } from "./Clientes";

type Sub = "bills" | "vendors" | "payments" | "credits" | "aging";
type Abierto = { tipo: "factura"; id: string | null; proveedorId?: string } | { tipo: "pagar"; facturaId?: string } | { tipo: "credito" } | { tipo: "proveedor"; id: string } | { tipo: "verPago"; id: string };

/** Proveedores y pagos (cuentas por pagar): facturas de proveedores, pagarlas (una o varias), créditos y antigüedad. */
export function Proveedores() {
  const { t } = usePrefs();
  const [sub, setSub] = useState<Sub>("bills");
  const [abierto, setAbierto] = useState<Abierto | null>(null);
  const cerrar = () => setAbierto(null);
  return (
    <section className="qbo-seccion">
      <div className="qbo-barra">
        <button type="button" className="btn btn-primary btn-sm" data-accion="nueva-factura-prov" onClick={() => setAbierto({ tipo: "factura", id: null })}>+ {t("Enter a bill", "Registrar factura de proveedor")}</button>
        <button type="button" className="btn btn-green btn-sm" data-accion="pagar-facturas" onClick={() => setAbierto({ tipo: "pagar" })}>💸 {t("Pay bills", "Pagar facturas")}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbierto({ tipo: "credito" })}>↩ {t("Vendor credit", "Crédito de proveedor")}</button>
      </div>
      <SubSecciones valor={sub} onCambia={setSub} opciones={[
        { clave: "bills", texto: t("Bills", "Facturas de proveedores") },
        { clave: "vendors", texto: t("Vendors", "Proveedores") },
        { clave: "payments", texto: t("Bill payments", "Pagos hechos") },
        { clave: "credits", texto: t("Vendor credits", "Créditos de proveedores") },
        { clave: "aging", texto: t("What we owe and how late (aging)", "Qué debemos y cuánto atraso (antigüedad)") },
      ]} />
      {sub === "bills" && <ListaFacturasProv abrir={(id) => setAbierto({ tipo: "factura", id })} />}
      {sub === "vendors" && <ListaProveedores abrir={(id) => setAbierto({ tipo: "proveedor", id })} />}
      {sub === "payments" && <ListaPagosProv abrir={(id) => setAbierto({ tipo: "verPago", id })} />}
      {sub === "credits" && <ListaCreditos />}
      {sub === "aging" && <AntiguedadPagar abrir={(id) => setAbierto({ tipo: "proveedor", id })} />}
      {abierto?.tipo === "factura" && <FichaFacturaProv id={abierto.id} proveedorId={abierto.proveedorId} onCerrar={cerrar} pagar={(facturaId) => setAbierto({ tipo: "pagar", facturaId })} />}
      {abierto?.tipo === "pagar" && <PagarFacturas facturaInicial={abierto.facturaId} onCerrar={cerrar} />}
      {abierto?.tipo === "credito" && <FormCreditoProv onCerrar={cerrar} />}
      {abierto?.tipo === "proveedor" && <FichaProveedor id={abierto.id} onCerrar={cerrar} ir={setAbierto} />}
      {abierto?.tipo === "verPago" && <VerPagoProv id={abierto.id} onCerrar={cerrar} />}
    </section>
  );
}

function ListaFacturasProv({ abrir }: { abrir: (id: string) => void }) {
  const { t } = usePrefs();
  const { e, hoy } = useQbo();
  const n = useNombres();
  const [soloAbiertas, setSoloAbiertas] = useState(true);
  const filas = useMemo(() => facturasProvConSaldo(e, hoy).filter((x) => !soloAbiertas || x.saldo > 0.005).map((x) => ({ ...x, proveedor: n.proveedor(x.factura.proveedorId) })), [e, hoy, n, soloAbiertas]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "numero", en: "Vendor's no.", es: "Núm. del proveedor", ancho: 130, fija: true, valor: (x) => x.factura.numero },
    { key: "proveedor", en: "Vendor", es: "Proveedor", ancho: 200, valor: (x) => x.proveedor },
    { key: "fecha", en: "Bill date", es: "Fecha", ancho: 105, valor: (x) => x.factura.fecha },
    { key: "vence", en: "Due", es: "Vence", ancho: 105, valor: (x) => x.factura.vence },
    { key: "total", en: "Total", es: "Total", ancho: 110, numerico: true, valor: (x) => x.total, celda: (x) => dinero(x.total) },
    { key: "saldo", en: "Still to pay", es: "Falta pagar", ancho: 110, numerico: true, valor: (x) => x.saldo, celda: (x) => dinero(x.saldo) },
    { key: "estado", en: "Status", es: "Estado", ancho: 120, valor: (x) => x.estado, etiqueta: (v) => etiquetaDeEstado(String(v), t), celda: (x) => <Estado estado={x.estado} /> },
  ], [t]);
  return <TablaEstandar id="app-draft-qbo-facturas-prov" filas={filas} claveDe={(x) => x.factura.id} columnas={columnas} onFila={(x) => abrir(x.factura.id)}
    ordenInicial={{ clave: "vence", direccion: "asc" }} vacio={t("No unpaid bills.", "No hay facturas por pagar.")}
    barra={<label className="qbo-explica" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" style={{ width: "auto" }} checked={soloAbiertas} onChange={(ev) => setSoloAbiertas(ev.target.checked)} />{t("Unpaid only", "Solo por pagar")}</label>} />;
}

function ListaProveedores({ abrir }: { abrir: (id: string) => void }) {
  const { t } = usePrefs();
  const { e } = useQbo();
  const n = useNombres();
  const filas = useMemo(() => e.proveedores.map((p) => ({ ...p, saldo: saldoDeProveedor(e, p.id) })), [e]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "nombre", en: "Vendor", es: "Proveedor", ancho: 220, fija: true, valor: (p) => p.nombre },
    { key: "telefono", en: "Phone", es: "Teléfono", ancho: 130, valor: (p) => p.telefono },
    { key: "email", en: "Email", es: "Correo", ancho: 230, valor: (p) => p.email },
    { key: "plazo", en: "Terms (days)", es: "Plazo (días)", ancho: 100, numerico: true, valor: (p) => p.plazo },
    { key: "cuenta", en: "Usual account", es: "Cuenta habitual", ancho: 220, oculta: true, valor: (p) => n.cuenta(p.cuentaPorDefecto) },
    { key: "saldo", en: "We owe", es: "Les debemos", ancho: 120, numerico: true, valor: (p) => p.saldo, celda: (p) => dinero(p.saldo) },
  ], [n]);
  return <TablaEstandar id="app-draft-qbo-proveedores" filas={filas} claveDe={(p) => p.id} columnas={columnas} onFila={(p) => abrir(p.id)} ordenInicial={{ clave: "saldo", direccion: "desc" }} vacio={t("No vendors.", "Sin proveedores.")} />;
}

const METODOS: Record<PagoAProveedor["metodo"], [string, string]> = { check: ["Check", "Cheque"], ach: ["Bank transfer (ACH)", "Transferencia (ACH)"], card: ["Card", "Tarjeta"] };

function ListaPagosProv({ abrir }: { abrir: (id: string) => void }) {
  const { t } = usePrefs();
  const { e } = useQbo();
  const n = useNombres();
  const filas = useMemo(() => e.pagosProv.map((p) => ({ ...p, proveedor: n.proveedor(p.proveedorId), total: totalPagoProv(p) })), [e, n]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "numero", en: "No.", es: "Núm.", ancho: 100, fija: true, valor: (p) => p.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 105, valor: (p) => p.fecha },
    { key: "proveedor", en: "Vendor", es: "Proveedor", ancho: 220, valor: (p) => p.proveedor },
    { key: "metodo", en: "Method", es: "Forma", ancho: 150, valor: (p) => t(...METODOS[p.metodo]) },
    { key: "total", en: "Amount", es: "Monto", ancho: 110, numerico: true, valor: (p) => p.total, celda: (p) => dinero(p.total) },
  ], [t]);
  return <TablaEstandar id="app-draft-qbo-pagos-prov" filas={filas} claveDe={(p) => p.id} columnas={columnas} onFila={(p) => abrir(p.id)} ordenInicial={{ clave: "fecha", direccion: "desc" }} vacio={t("No bill payments yet.", "Todavía no hay pagos.")} />;
}

function ListaCreditos() {
  const { t } = usePrefs();
  const { e } = useQbo();
  const n = useNombres();
  const filas = useMemo(() => e.creditosProv.map((c) => ({ ...c, proveedor: n.proveedor(c.proveedorId), total: totalGasto(c.lineas), libre: sinAplicarCreditoProv(c) })), [e, n]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "numero", en: "No.", es: "Núm.", ancho: 100, fija: true, valor: (c) => c.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 105, valor: (c) => c.fecha },
    { key: "proveedor", en: "Vendor", es: "Proveedor", ancho: 220, valor: (c) => c.proveedor },
    { key: "motivo", en: "Reason", es: "Motivo", ancho: 200, valor: (c) => c.motivo },
    { key: "total", en: "Credit", es: "Crédito", ancho: 110, numerico: true, valor: (c) => c.total, celda: (c) => dinero(c.total) },
    { key: "libre", en: "Not used yet", es: "Sin usar", ancho: 110, numerico: true, valor: (c) => c.libre, celda: (c) => dinero(c.libre) },
  ], []);
  return (
    <>
      <p className="qbo-explica">{t("A vendor credit is money a vendor owes us back (returned or broken material). It lowers what we owe them.", "Un crédito de proveedor es dinero que el proveedor nos devuelve (material devuelto o roto). Baja lo que le debemos.")}</p>
      <TablaEstandar id="app-draft-qbo-creditos-prov" filas={filas} claveDe={(c) => c.id} columnas={columnas} vacio={t("No vendor credits yet.", "Todavía no hay créditos de proveedores.")} />
    </>
  );
}

function AntiguedadPagar({ abrir }: { abrir: (id: string) => void }) {
  const { t } = usePrefs();
  const { e, hoy } = useQbo();
  const filas = useMemo(() => antiguedadPorPagar(e, hoy), [e, hoy]);
  const columnas = useMemo(() => columnasDeAntiguedad(t, ["Vendor", "Proveedor"]), [t]);
  return <TablaEstandar id="app-draft-qbo-antiguedad-ap" filas={filas} claveDe={(f) => f.id} columnas={columnas} onFila={(f) => abrir(f.id)} totales={totalesDeAntiguedad(filas)} vacio={t("We owe nothing.", "No debemos nada.")} />;
}

// ------------------------------------------------------------------ factura de proveedor
function EditorDeGasto({ lineas, onCambia }: { lineas: LineaDeGasto[]; onCambia: (l: LineaDeGasto[]) => void }) {
  const { t } = usePrefs();
  const pon = (i: number, c: Partial<LineaDeGasto>) => onCambia(lineas.map((l, k) => (k === i ? { ...l, ...c } : l)));
  return (
    <div className="qbo-lineas">
      {lineas.map((l, i) => (
        <div key={i} className="qbo-linea" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,2fr) minmax(90px,1fr) 32px" }}>
          <SelectorDeCuenta valor={l.cuentaId} onCambia={(v) => pon(i, { cuentaId: v })} tipos={["asset", "expense", "cogs"]} etiqueta={t("What it was for (account)", "Para qué fue (cuenta)")} />
          <input aria-label={t("Description", "Descripción")} placeholder={t("Description", "Descripción")} value={l.descripcion} onChange={(ev) => pon(i, { descripcion: ev.target.value })} />
          <input type="number" min={0} step="0.01" inputMode="decimal" aria-label={t("Amount", "Monto")} value={l.monto || ""} onChange={(ev) => pon(i, { monto: Number(ev.target.value) || 0 })} />
          <button type="button" className="btn btn-sm btn-ghost" aria-label={t("Remove line", "Quitar línea")} onClick={() => onCambia(lineas.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      <div><button type="button" className="btn btn-sm btn-ghost" onClick={() => onCambia([...lineas, { cuentaId: "", descripcion: "", monto: 0 }])}>+ {t("Add line", "Agregar línea")}</button></div>
    </div>
  );
}

function FichaFacturaProv({ id, proveedorId, onCerrar, pagar }: { id: string | null; proveedorId?: string; onCerrar: () => void; pagar: (facturaId: string) => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbo();
  const n = useNombres();
  const existente = id ? e.facturasProv.find((b) => b.id === id) ?? null : null;
  const s = existente ? facturasProvConSaldo(e, hoy).find((x) => x.factura.id === existente.id)! : null;
  const prov0 = e.proveedores.find((p) => p.id === (proveedorId ?? ""));
  const [b, setB] = useState<FacturaProveedor>(() => existente ?? {
    id: nuevoId("bill"), numero: "", proveedorId: prov0?.id ?? "", fecha: hoy, vence: sumaDias(hoy, prov0?.plazo ?? 30), ordenId: null, nota: "",
    lineas: [{ cuentaId: prov0?.cuentaPorDefecto ?? "", descripcion: "", monto: 0 }],
  });
  const [error, setError] = useState("");
  const pon = (c: Partial<FacturaProveedor>) => setB((x) => ({ ...x, ...c }));
  if (existente && s && (s.pagado > 0 || s.acreditado > 0 || existente.ordenId)) {
    return (
      <Ventana titulo={`${t("Bill", "Factura")} ${existente.numero}`} onCerrar={onCerrar} pie={s.saldo > 0 ? <button type="button" className="btn btn-green" onClick={() => pagar(existente.id)}>💸 {t("Pay this bill", "Pagar esta factura")}</button> : undefined}>
        <div className="qbo-form">
          <div className="qbo-explica">{n.proveedor(existente.proveedorId)} · {existente.fecha} · {t("due", "vence")} {existente.vence} {existente.nota ? `· ${existente.nota}` : ""} <Estado estado={s.estado} /></div>
          {existente.lineas.map((l, i) => <div key={i} className="qbo-renglon"><span>{l.descripcion} <span className="qbo-gris">· {n.cuenta(l.cuentaId)}</span></span><span className="qbo-num">{dinero(l.monto)}</span></div>)}
          <div className="qbo-totales">
            <div><span>{t("Total", "Total")}</span><span className="qbo-num">{dinero(s.total)}</span></div>
            <div><span>{t("Paid", "Pagado")}</span><span className="qbo-num">{dinero(s.pagado)}</span></div>
            <div><b>{t("Still to pay", "Falta pagar")}</b><b className="qbo-num">{dinero(s.saldo)}</b></div>
          </div>
        </div>
      </Ventana>
    );
  }
  const guardar = () => {
    const lineas = b.lineas.filter((l) => l.cuentaId && l.monto > 0);
    if (!b.proveedorId) return setError(t("Choose a vendor.", "Elige un proveedor."));
    if (!b.numero.trim()) return setError(t("Write the vendor's bill number.", "Escribe el número de factura del proveedor."));
    if (!lineas.length) return setError(t("Add at least one line with an account and amount.", "Agrega al menos una línea con cuenta y monto."));
    d({ tipo: "guardarFacturaProv", factura: { ...b, numero: b.numero.trim(), lineas } });
    onCerrar();
  };
  return (
    <Ventana titulo={existente ? `${t("Bill", "Factura")} ${existente.numero}` : t("Enter a bill", "Registrar factura de proveedor")} onCerrar={onCerrar} ancho={820} pie={<button type="button" className="btn btn-primary" data-accion="guardar-factura-prov" onClick={guardar}>{t("Save bill", "Guardar factura")}</button>}>
      <div className="qbo-form">
        <p className="qbo-explica">{t("A bill is an invoice a vendor sent us. Saving it records that we owe them; paying it comes later.", "Una factura de proveedor es lo que un proveedor nos cobra. Guardarla registra que le debemos; pagarla viene después.")}</p>
        <div className="qbo-campos">
          <Campo etiqueta={t("Vendor", "Proveedor")}>
            <select value={b.proveedorId} data-campo="proveedor" onChange={(ev) => {
              const p = e.proveedores.find((x) => x.id === ev.target.value);
              pon(p ? { proveedorId: p.id, vence: sumaDias(b.fecha, p.plazo), lineas: b.lineas.map((l) => ({ ...l, cuentaId: l.cuentaId || p.cuentaPorDefecto })) } : { proveedorId: "" });
            }}>
              <option value="">{t("Choose…", "Elige…")}</option>
              {e.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("Vendor's bill no.", "Núm. de factura del proveedor")}><input value={b.numero} data-campo="numero-factura-prov" onChange={(ev) => pon({ numero: ev.target.value })} /></Campo>
          <Campo etiqueta={t("Bill date", "Fecha")}><input type="date" value={b.fecha} onChange={(ev) => pon({ fecha: ev.target.value })} /></Campo>
          <Campo etiqueta={t("Due date", "Vence")}><input type="date" value={b.vence} onChange={(ev) => pon({ vence: ev.target.value })} /></Campo>
        </div>
        <EditorDeGasto lineas={b.lineas} onCambia={(l) => pon({ lineas: l })} />
        <div className="qbo-totales"><div><b>{t("Total", "Total")}</b><b className="qbo-num">{dinero(totalGasto(b.lineas))}</b></div></div>
        {error && <p className="qbo-error" role="alert">{error}</p>}
      </div>
    </Ventana>
  );
}

/** Pagar facturas: se marcan una o varias (de uno o varios proveedores); sale un pago por proveedor. */
function PagarFacturas({ facturaInicial, onCerrar }: { facturaInicial?: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbo();
  const n = useNombres();
  const abiertas = facturasProvConSaldo(e, hoy).filter((x) => x.saldo > 0.005).sort((a, b) => a.factura.vence.localeCompare(b.factura.vence));
  const ini = abiertas.find((x) => x.factura.id === facturaInicial);
  const [aplicado, setAplicado] = useState<AplicacionAProveedor[]>(ini ? [{ facturaId: ini.factura.id, monto: ini.saldo }] : []);
  const [fecha, setFecha] = useState(hoy);
  const [metodo, setMetodo] = useState<PagoAProveedor["metodo"]>("check");
  const total = r2(aplicado.reduce((a, x) => a + x.monto, 0));
  const pagar = () => {
    const porProv = new Map<string, AplicacionAProveedor[]>();
    for (const a of aplicado) {
      const b = abiertas.find((x) => x.factura.id === a.facturaId);
      if (!b || a.monto <= 0) continue;
      porProv.set(b.factura.proveedorId, [...(porProv.get(b.factura.proveedorId) ?? []), { facturaId: a.facturaId, monto: Math.min(a.monto, b.saldo) }]);
    }
    let numeros = e.pagosProv.map((p) => p.numero);
    for (const [proveedorId, aps] of porProv) {
      const numero = siguienteNumero(numeros, "CHK-", 5401);
      numeros = [...numeros, numero];
      d({ tipo: "pagarProveedor", pago: { id: nuevoId("bp"), numero, proveedorId, fecha, cuentaBanco: "a-1000", metodo, aplicado: aps } });
    }
    onCerrar();
  };
  return (
    <Ventana titulo={t("Pay bills", "Pagar facturas")} onCerrar={onCerrar} ancho={820} pie={<button type="button" className="btn btn-green" data-accion="confirmar-pago-prov" disabled={total <= 0} onClick={pagar}>{t("Pay", "Pagar")} {dinero(total)}</button>}>
      <div className="qbo-form">
        <div className="qbo-campos">
          <Campo etiqueta={t("Payment date", "Fecha del pago")}><input type="date" value={fecha} onChange={(ev) => setFecha(ev.target.value)} /></Campo>
          <Campo etiqueta={t("Pay with", "Pagar con")}>
            <select value={metodo} onChange={(ev) => setMetodo(ev.target.value as PagoAProveedor["metodo"])}>{Object.entries(METODOS).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}</select>
          </Campo>
          <Campo etiqueta={t("From account", "Desde la cuenta")}><input value={n.cuenta("a-1000")} readOnly /></Campo>
        </div>
        <p className="qbo-explica">{t("Tick the bills to pay. You can pay part of a bill by changing the amount.", "Marca las facturas a pagar. Puedes pagar parte de una cambiando el monto.")}</p>
        <Aplicador disponible={null} aplicado={aplicado} onCambia={setAplicado}
          abiertos={abiertas.map((x) => ({ id: x.factura.id, numero: `${x.factura.numero} · ${n.proveedor(x.factura.proveedorId)}`, fecha: x.factura.fecha, vence: x.factura.vence, saldo: x.saldo }))} />
      </div>
    </Ventana>
  );
}

function FormCreditoProv({ onCerrar }: { onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbo();
  const n = useNombres();
  const [proveedorId, setProveedorId] = useState("");
  const [lineas, setLineas] = useState<LineaDeGasto[]>([{ cuentaId: "a-1300", descripcion: "", monto: 0 }]);
  const [motivo, setMotivo] = useState("");
  const [aplicado, setAplicado] = useState<AplicacionAProveedor[]>([]);
  const [error, setError] = useState("");
  const buenas = lineas.filter((l) => l.cuentaId && l.monto > 0);
  const total = totalGasto(buenas);
  const abiertas = facturasProvConSaldo(e, hoy).filter((x) => x.factura.proveedorId === proveedorId && x.saldo > 0.005);
  return (
    <Ventana titulo={t("Vendor credit", "Crédito de proveedor")} onCerrar={onCerrar} ancho={820} pie={<button type="button" className="btn btn-primary" onClick={() => {
      if (!proveedorId || !buenas.length) return setError(t("Choose a vendor and add the credit lines.", "Elige proveedor y agrega las líneas del crédito."));
      if (aplicado.reduce((a, x) => a + x.monto, 0) > total + 0.005) return setError(t("You applied more than the credit.", "Aplicaste más que el crédito."));
      d({ tipo: "guardarCreditoProv", credito: { id: nuevoId("vc"), numero: siguienteNumero(e.creditosProv.map((c) => c.numero), "VC-", 101), proveedorId, fecha: hoy, lineas: buenas, motivo, aplicado } });
      onCerrar();
    }}>{t("Save credit", "Guardar crédito")}</button>}>
      <div className="qbo-form">
        <div className="qbo-campos">
          <Campo etiqueta={t("Vendor", "Proveedor")}>
            <select value={proveedorId} onChange={(ev) => { setProveedorId(ev.target.value); setAplicado([]); }}>
              <option value="">{t("Choose…", "Elige…")}</option>
              {e.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("Reason", "Motivo")}><input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} /></Campo>
        </div>
        <EditorDeGasto lineas={lineas} onCambia={setLineas} />
        <div className="qbo-totales"><div><b>{t("Credit", "Crédito")}</b><b className="qbo-num">{dinero(total)}</b></div></div>
        {proveedorId && <Aplicador disponible={total} aplicado={aplicado} onCambia={setAplicado} abiertos={abiertas.map((x) => ({ id: x.factura.id, numero: x.factura.numero, fecha: x.factura.fecha, vence: x.factura.vence, saldo: x.saldo }))} />}
        {error && <p className="qbo-error" role="alert">{error}</p>}
        <span className="qbo-explica">{n.cuenta("a-1300")}</span>
      </div>
    </Ventana>
  );
}

function FichaProveedor({ id, onCerrar, ir }: { id: string; onCerrar: () => void; ir: (a: Abierto) => void }) {
  const { t } = usePrefs();
  const { e, hoy } = useQbo();
  const p = e.proveedores.find((x) => x.id === id);
  if (!p) return null;
  const bills = facturasProvConSaldo(e, hoy).filter((x) => x.factura.proveedorId === id).sort((a, b) => b.factura.fecha.localeCompare(a.factura.fecha));
  return (
    <Ventana titulo={p.nombre} onCerrar={onCerrar} pie={<button type="button" className="btn btn-primary" onClick={() => ir({ tipo: "factura", id: null, proveedorId: id })}>+ {t("Enter a bill", "Registrar factura")}</button>}>
      <div className="qbo-form">
        <div className="qbo-explica">{p.telefono} · {p.email} · {p.plazo ? `Net ${p.plazo}` : t("Due on receipt", "Al recibir")}</div>
        <div className="qbo-renglon qbo-renglon-total"><span>{t("We owe", "Les debemos")}</span><span className="qbo-num">{dinero(saldoDeProveedor(e, id))}</span></div>
        {bills.map((x) => (
          <button key={x.factura.id} type="button" className="qbo-renglon" style={{ width: "100%", background: "none", textAlign: "left" }} onClick={() => ir({ tipo: "factura", id: x.factura.id })}>
            <span>{x.factura.numero} · {x.factura.fecha} <Estado estado={x.estado} /></span><span className="qbo-num">{dinero(x.saldo)} / {dinero(x.total)}</span>
          </button>
        ))}
      </div>
    </Ventana>
  );
}

function VerPagoProv({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e } = useQbo();
  const n = useNombres();
  const p = e.pagosProv.find((x) => x.id === id);
  if (!p) return null;
  return (
    <Ventana titulo={`${t("Bill payment", "Pago a proveedor")} ${p.numero}`} onCerrar={onCerrar} ancho={560}>
      <div className="qbo-explica">{n.proveedor(p.proveedorId)} · {p.fecha} · {t(...METODOS[p.metodo])}</div>
      {p.aplicado.map((a) => <div key={a.facturaId} className="qbo-renglon"><span>{t("Bill", "Factura")} {e.facturasProv.find((b) => b.id === a.facturaId)?.numero}</span><span className="qbo-num">{dinero(a.monto)}</span></div>)}
      <div className="qbo-renglon qbo-renglon-total"><span>{t("Total", "Total")}</span><span className="qbo-num">{dinero(totalPagoProv(p))}</span></div>
    </Ventana>
  );
}
