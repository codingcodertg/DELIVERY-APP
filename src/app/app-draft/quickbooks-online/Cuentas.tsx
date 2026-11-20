"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { asientoManualBalanceado, esDeudora, r2, saldoDeCuenta } from "@/lib/app-draft/qbo/contabilidad";
import { siguienteNumero } from "@/lib/app-draft/qbo/estado";
import type { LineaDeAsiento, RenglonDeLibro, TipoDeCuenta } from "@/lib/app-draft/qbo/tipos";
import { SelectorDeCuenta, SubSecciones, Ventana, dinero, nuevoId, useNombres, useQbo } from "./comun";
import { Campo } from "./piezas";

type Sub = "chart" | "journal" | "ledger";

export const TIPOS_DE_CUENTA: Record<TipoDeCuenta, [string, string]> = {
  bank: ["Bank", "Banco"], ar: ["Owed to us (A/R)", "Nos deben (por cobrar)"], asset: ["What we own", "Lo que tenemos"],
  ap: ["We owe vendors (A/P)", "Debemos a proveedores (por pagar)"], liability: ["Other debts", "Otras deudas"], equity: ["Owner's stake", "Del dueño"],
  income: ["Income", "Ingresos"], cogs: ["Cost of goods sold", "Costo de lo vendido"], expense: ["Expense", "Gasto"],
};

/** Cuentas y asientos: catálogo de cuentas con saldos, asiento manual (debe = haber) y el libro mayor completo. */
export function Cuentas() {
  const { t } = usePrefs();
  const [sub, setSub] = useState<Sub>("chart");
  const [cuenta, setCuenta] = useState<string | null>(null);
  const [asiento, setAsiento] = useState(false);
  return (
    <section className="qbo-seccion">
      <div className="qbo-barra"><button type="button" className="btn btn-primary btn-sm" data-accion="nuevo-asiento" onClick={() => setAsiento(true)}>+ {t("Journal entry", "Asiento manual")}</button></div>
      <SubSecciones valor={sub} onCambia={setSub} opciones={[
        { clave: "chart", texto: t("Chart of accounts", "Catálogo de cuentas") },
        { clave: "ledger", texto: t("General ledger (every posting)", "Libro mayor (cada movimiento)") },
        { clave: "journal", texto: t("Journal entries", "Asientos manuales") },
      ]} />
      {sub === "chart" && <Catalogo abrir={setCuenta} />}
      {sub === "ledger" && <Libro id="app-draft-qbo-libro" />}
      {sub === "journal" && <Libro id="app-draft-qbo-asientos" soloManuales />}
      {cuenta && <Ventana titulo={t("Account history", "Historial de la cuenta")} onCerrar={() => setCuenta(null)} ancho={980}><Libro id="app-draft-qbo-libro-cuenta" cuentaId={cuenta} /></Ventana>}
      {asiento && <FormAsiento onCerrar={() => setAsiento(false)} />}
    </section>
  );
}

function Catalogo({ abrir }: { abrir: (id: string) => void }) {
  const { t, lang } = usePrefs();
  const { e, libro } = useQbo();
  const filas = useMemo(() => e.cuentas.map((c) => ({ ...c, nombre: lang === "es" ? c.nombre_es : c.nombre_en, saldo: saldoDeCuenta(c, libro) })), [e, libro, lang]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "numero", en: "No.", es: "Núm.", ancho: 70, fija: true, valor: (c) => c.numero },
    { key: "nombre", en: "Account", es: "Cuenta", ancho: 300, valor: (c) => c.nombre },
    { key: "tipo", en: "Kind", es: "Clase", ancho: 220, valor: (c) => t(...TIPOS_DE_CUENTA[c.tipo]) },
    { key: "saldo", en: "Balance", es: "Saldo", ancho: 130, numerico: true, valor: (c) => c.saldo, celda: (c) => dinero(c.saldo) },
  ], [t]);
  return (
    <>
      <p className="qbo-explica">{t("Every dollar is filed in one of these accounts. Click one to see each movement that built its balance.", "Cada dólar se archiva en una de estas cuentas. Haz clic en una para ver cada movimiento que formó su saldo.")}</p>
      <TablaEstandar id="app-draft-qbo-cuentas" filas={filas} claveDe={(c) => c.id} columnas={columnas} onFila={(c) => abrir(c.id)} ordenInicial={{ clave: "numero", direccion: "asc" }} />
    </>
  );
}

const TIPO_DOC: Record<RenglonDeLibro["tipo"], [string, string]> = {
  invoice: ["Invoice", "Factura"], payment: ["Payment", "Pago"], credit: ["Credit memo", "Nota de crédito"], bill: ["Bill", "Factura de proveedor"],
  billPayment: ["Bill payment", "Pago a proveedor"], vendorCredit: ["Vendor credit", "Crédito de proveedor"], journal: ["Journal entry", "Asiento"], bankTx: ["Bank", "Banco"],
};

function Libro({ id, cuentaId, soloManuales }: { id: string; cuentaId?: string; soloManuales?: boolean }) {
  const { t } = usePrefs();
  const { e, libro } = useQbo();
  const n = useNombres();
  const filas = useMemo(() => {
    let base = libro.filter((r) => (!cuentaId || r.cuentaId === cuentaId) && (!soloManuales || r.tipo === "journal"));
    if (cuentaId) {
      const c = e.cuentas.find((x) => x.id === cuentaId)!;
      let corrido = 0;
      base = base.map((r) => { corrido = r2(corrido + (esDeudora(c.tipo) ? r.debe - r.haber : r.haber - r.debe)); return { ...r, corrido }; });
    }
    return base.map((r) => ({ ...r, cuenta: n.cuenta(r.cuentaId), corrido: (r as RenglonDeLibro & { corrido?: number }).corrido ?? null }));
  }, [libro, cuentaId, soloManuales, n, e.cuentas]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "fecha", en: "Date", es: "Fecha", ancho: 105, fija: true, valor: (r) => r.fecha },
    { key: "tipo", en: "Type", es: "Tipo", ancho: 140, valor: (r) => t(...TIPO_DOC[r.tipo]) },
    { key: "memo", en: "Memo", es: "Concepto", ancho: 220, valor: (r) => r.memo },
    { key: "nombre", en: "Name", es: "Nombre", ancho: 170, valor: (r) => r.nombre },
    { key: "cuenta", en: "Account", es: "Cuenta", ancho: 240, valor: (r) => r.cuenta },
    { key: "debe", en: "Debit", es: "Debe", ancho: 110, numerico: true, valor: (r) => r.debe || null, celda: (r) => (r.debe ? dinero(r.debe) : "") },
    { key: "haber", en: "Credit", es: "Haber", ancho: 110, numerico: true, valor: (r) => r.haber || null, celda: (r) => (r.haber ? dinero(r.haber) : "") },
    ...(cuentaId ? [{ key: "corrido", en: "Running balance", es: "Saldo corrido", ancho: 130, numerico: true as const, valor: (r: (typeof filas)[number]) => r.corrido, celda: (r: (typeof filas)[number]) => dinero(r.corrido ?? 0) }] : []),
  ], [t, cuentaId]);
  const debe = r2(filas.reduce((a, r) => a + r.debe, 0));
  const haber = r2(filas.reduce((a, r) => a + r.haber, 0));
  return (
    <>
      {!cuentaId && <p className="qbo-explica">{t("Debit and credit are the two sides of every movement: each document writes both, and they always add up to the same total.", "Debe y haber son los dos lados de cada movimiento: cada documento escribe los dos, y siempre suman lo mismo.")}</p>}
      <TablaEstandar id={id} filas={filas} claveDe={(r) => r.clave} columnas={columnas} ordenInicial={{ clave: "fecha", direccion: cuentaId ? "asc" : "desc" }}
        totales={{ fecha: "Total", debe: dinero(debe), haber: dinero(haber) }} vacio={t("No entries.", "Sin movimientos.")} />
    </>
  );
}

function FormAsiento({ onCerrar }: { onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbo();
  const [fecha, setFecha] = useState(hoy);
  const [memo, setMemo] = useState("");
  const [lineas, setLineas] = useState<LineaDeAsiento[]>([{ cuentaId: "", debe: 0, haber: 0 }, { cuentaId: "", debe: 0, haber: 0 }]);
  const buenas = lineas.filter((l) => l.cuentaId && (l.debe > 0 || l.haber > 0));
  const b = asientoManualBalanceado(buenas);
  const pon = (i: number, c: Partial<LineaDeAsiento>) => setLineas(lineas.map((l, k) => (k === i ? { ...l, ...c } : l)));
  return (
    <Ventana titulo={t("Journal entry", "Asiento manual")} onCerrar={onCerrar} ancho={820} pie={<button type="button" className="btn btn-primary" data-accion="guardar-asiento" disabled={!b.cuadra} onClick={() => {
      d({ tipo: "guardarAsiento", asiento: { id: nuevoId("je"), numero: siguienteNumero(e.asientos.map((a) => a.numero), "JE-", 1001), fecha, memo, lineas: buenas } });
      onCerrar();
    }}>{t("Save entry", "Guardar asiento")}</button>}>
      <div className="qbo-form">
        <p className="qbo-explica">{t("For adjustments that no invoice or bill covers (e.g. depreciation, loan interest). Each line goes to one side; both sides must be equal.", "Para ajustes que no cubre ninguna factura (p. ej. depreciación, intereses de un préstamo). Cada línea va a un lado; los dos lados deben ser iguales.")}</p>
        <div className="qbo-campos">
          <Campo etiqueta={t("Date", "Fecha")}><input type="date" value={fecha} onChange={(ev) => setFecha(ev.target.value)} /></Campo>
          <Campo etiqueta={t("Memo", "Concepto")}><input value={memo} onChange={(ev) => setMemo(ev.target.value)} /></Campo>
        </div>
        <div className="qbo-linea qbo-linea-cabeza" style={{ gridTemplateColumns: "minmax(0,3fr) minmax(80px,1fr) minmax(80px,1fr) 32px" }}><span>{t("Account", "Cuenta")}</span><span>{t("Debit", "Debe")}</span><span>{t("Credit", "Haber")}</span><span /></div>
        {lineas.map((l, i) => (
          <div key={i} className="qbo-linea" style={{ gridTemplateColumns: "minmax(0,3fr) minmax(80px,1fr) minmax(80px,1fr) 32px" }}>
            <SelectorDeCuenta valor={l.cuentaId} onCambia={(v) => pon(i, { cuentaId: v })} />
            <input type="number" min={0} step="0.01" aria-label={t("Debit", "Debe")} value={l.debe || ""} onChange={(ev) => pon(i, { debe: Number(ev.target.value) || 0, haber: 0 })} />
            <input type="number" min={0} step="0.01" aria-label={t("Credit", "Haber")} value={l.haber || ""} onChange={(ev) => pon(i, { haber: Number(ev.target.value) || 0, debe: 0 })} />
            <button type="button" className="btn btn-sm btn-ghost" aria-label={t("Remove line", "Quitar línea")} onClick={() => setLineas(lineas.filter((_, k) => k !== i))}>✕</button>
          </div>
        ))}
        <div><button type="button" className="btn btn-sm btn-ghost" onClick={() => setLineas([...lineas, { cuentaId: "", debe: 0, haber: 0 }])}>+ {t("Add line", "Agregar línea")}</button></div>
        <div className="qbo-totales">
          <div><span>{t("Debits", "Debe")}</span><span className="qbo-num">{dinero(b.debe)}</span></div>
          <div><span>{t("Credits", "Haber")}</span><span className="qbo-num">{dinero(b.haber)}</span></div>
          <div>{b.cuadra ? <b className="qbo-ok">{t("Balanced ✓", "Cuadra ✓")}</b> : <b className="qbo-error">{t("Difference", "Diferencia")} {dinero(r2(b.debe - b.haber))}</b>}</div>
        </div>
      </div>
    </Ventana>
  );
}
