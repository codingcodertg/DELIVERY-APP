"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import {
  candidatosDeEnlace, cuentaDeConciliacion, r2, registroDelBanco, reglaQueAplica, saldoDeCuenta, saldoSegunBanco,
} from "@/lib/app-draft/qbo/contabilidad";
import type { MovimientoBancario } from "@/lib/app-draft/qbo/tipos";
import { Estado, SelectorDeCuenta, SubSecciones, Ventana, dinero, etiquetaDeEstado, nuevoId, useNombres, useQbo } from "./comun";
import { Campo } from "./piezas";

type Sub = "feed" | "rules" | "reconcile";

/** Banco y conciliación: movimientos importados del banco, categorizar o emparejar, reglas y conciliar. */
export function Banco() {
  const { t } = usePrefs();
  const { e, libro } = useQbo();
  const [sub, setSub] = useState<Sub>("feed");
  const banco = e.bancos[0];
  const cuenta = e.cuentas.find((c) => c.id === banco?.cuentaId);
  if (!banco || !cuenta) return <p className="qbo-gris">{t("No bank account.", "No hay cuenta de banco.")}</p>;
  return (
    <section className="qbo-seccion">
      <p className="qbo-nota">{t("Sample \"bank feed\": these transactions are made up. A real connection to the bank needs a paid provider (for example Plaid); nothing here talks to any bank.",
        "«Feed» del banco de ejemplo: estos movimientos son inventados. Conectarse de verdad al banco requiere un proveedor de pago (por ejemplo Plaid); nada aquí habla con ningún banco.")}</p>
      <div className="qbo-kpis">
        <div className="qbo-kpi"><span>{banco.nombre} ···{banco.ultimos4} · {t("bank says", "según el banco")}</span><b data-kpi="saldo-banco">{dinero(saldoSegunBanco(e, banco.id))}</b></div>
        <div className="qbo-kpi"><span>{t("Our books say", "Según nuestros libros")}</span><b data-kpi="saldo-libros">{dinero(saldoDeCuenta(cuenta, libro))}</b></div>
        <div className="qbo-kpi"><span>{t("To review", "Por revisar")}</span><b>{e.movimientos.filter((m) => m.estado === "new").length}</b></div>
      </div>
      <SubSecciones valor={sub} onCambia={setSub} opciones={[
        { clave: "feed", texto: t("Bank transactions", "Movimientos del banco") },
        { clave: "rules", texto: t("Rules", "Reglas") },
        { clave: "reconcile", texto: t("Reconcile", "Conciliar") },
      ]} />
      {sub === "feed" && <Movimientos />}
      {sub === "rules" && <Reglas />}
      {sub === "reconcile" && <Conciliar />}
    </section>
  );
}

function Movimientos() {
  const { t } = usePrefs();
  const { e, d } = useQbo();
  const n = useNombres();
  const [filtro, setFiltro] = useState<"new" | "all">("new");
  const [abierto, setAbierto] = useState<string | null>(null);
  const filas = useMemo(() => e.movimientos.filter((m) => filtro === "all" || m.estado === "new").map((m) => ({
    ...m,
    sugerencia: m.estado === "new" ? (candidatosDeEnlace(e, m.id)[0] ? t("Match found", "Pareja encontrada") : reglaQueAplica(e.reglas, m.descripcion) ? t("Rule applies", "Aplica una regla") : "") : "",
    destino: m.categoriaId ? n.cuenta(m.categoriaId) : m.enlace ? `${m.enlace.tipo === "payment" ? t("Payment", "Pago") : t("Bill payment", "Pago a proveedor")} ${(m.enlace.tipo === "payment" ? e.pagos : e.pagosProv).find((p) => p.id === m.enlace!.id)?.numero ?? ""}` : "",
  })), [e, filtro, n, t]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "fecha", en: "Date", es: "Fecha", ancho: 105, fija: true, valor: (m) => m.fecha },
    { key: "descripcion", en: "Bank description", es: "Descripción del banco", ancho: 240, valor: (m) => m.descripcion },
    { key: "monto", en: "Amount", es: "Monto", ancho: 110, numerico: true, valor: (m) => m.monto, celda: (m) => <span className={m.monto < 0 ? "qbo-rojo" : "qbo-verde"}>{dinero(m.monto)}</span> },
    { key: "estado", en: "Status", es: "Estado", ancho: 120, valor: (m) => m.estado, etiqueta: (v) => etiquetaDeEstado(String(v), t), celda: (m) => <Estado estado={m.estado} /> },
    { key: "sugerencia", en: "Suggestion", es: "Sugerencia", ancho: 140, valor: (m) => m.sugerencia },
    { key: "destino", en: "Recorded as", es: "Registrado como", ancho: 230, valor: (m) => m.destino },
  ], [t]);
  return (
    <>
      <div className="qbo-barra">
        <button type="button" className="btn btn-sm btn-ghost" aria-pressed={filtro === "new"} onClick={() => setFiltro(filtro === "new" ? "all" : "new")}>{filtro === "new" ? t("Show all", "Ver todos") : t("Only to review", "Solo por revisar")}</button>
        <button type="button" className="btn btn-sm btn-ghost" data-accion="aplicar-reglas" onClick={() => d({ tipo: "aplicarReglas" })}>⚡ {t("Apply rules to all", "Aplicar reglas a todos")}</button>
      </div>
      <p className="qbo-explica">{t("Each line came from the bank. Match it to a payment already recorded, or categorize it (say what it was) so it goes into the books.", "Cada renglón vino del banco. Empárejalo con un pago ya registrado, o categorízalo (di qué fue) para que entre a los libros.")}</p>
      <TablaEstandar id="app-draft-qbo-banco" filas={filas} claveDe={(m) => m.id} columnas={columnas} onFila={(m) => setAbierto(m.id)} ordenInicial={{ clave: "fecha", direccion: "desc" }} vacio={t("Nothing to review. All caught up.", "Nada por revisar. Todo al día.")} />
      {abierto && <FichaMovimiento id={abierto} onCerrar={() => setAbierto(null)} />}
    </>
  );
}

function FichaMovimiento({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d } = useQbo();
  const m = e.movimientos.find((x) => x.id === id) as MovimientoBancario | undefined;
  const regla = m ? reglaQueAplica(e.reglas, m.descripcion) : null;
  const [cuentaId, setCuentaId] = useState(m?.categoriaId ?? regla?.cuentaId ?? "");
  const [crearRegla, setCrearRegla] = useState(false);
  const [palabra, setPalabra] = useState(m?.descripcion.split(/\s+/)[0] ?? "");
  if (!m) return null;
  const candidatos = candidatosDeEnlace(e, m.id);
  const conciliado = e.conciliados.some((c) => c.startsWith(`bankTx:${m.id}:`));
  return (
    <Ventana titulo={`${m.descripcion} · ${dinero(m.monto)}`} onCerrar={onCerrar} ancho={640} pie={m.estado !== "new" && !conciliado ? <button type="button" className="btn btn-ghost" onClick={() => { d({ tipo: "deshacerMovimiento", id: m.id }); onCerrar(); }}>↶ {t("Undo", "Deshacer")}</button> : undefined}>
      <div className="qbo-form">
        <div className="qbo-explica">{m.fecha} · <Estado estado={m.estado} /></div>
        {m.estado === "new" ? (
          <>
            <div className="qbo-caja">
              <h2>{t("1. Match to something already recorded", "1. Emparejar con algo ya registrado")}</h2>
              {candidatos.length === 0 ? <p className="qbo-gris">{t("No recorded payment with this amount and date.", "No hay pago registrado con este monto y fecha.")}</p> : candidatos.map((c) => (
                <div key={c.id} className="qbo-renglon">
                  <span>{c.tipo === "payment" ? t("Payment received", "Pago recibido") : t("Bill payment", "Pago a proveedor")} {c.numero} · {c.nombre} · {c.fecha}</span>
                  <button type="button" className="btn btn-sm btn-green" data-accion="emparejar" onClick={() => { d({ tipo: "enlazar", id: m.id, enlace: { tipo: c.tipo, id: c.id } }); onCerrar(); }}>{t("Match", "Emparejar")}</button>
                </div>
              ))}
            </div>
            <div className="qbo-caja">
              <h2>{t("2. Or categorize it (what was it?)", "2. O categorizarlo (¿qué fue?)")}</h2>
              <SelectorDeCuenta valor={cuentaId} onCambia={setCuentaId} tipos={m.monto < 0 ? ["expense", "cogs", "asset", "liability", "equity"] : ["income", "equity", "liability"]} />
              <label className="qbo-explica" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={crearRegla} onChange={(ev) => setCrearRegla(ev.target.checked)} />
                {t("Always do this when the description contains", "Hacer siempre esto cuando la descripción contenga")}
              </label>
              {crearRegla && <input value={palabra} onChange={(ev) => setPalabra(ev.target.value)} aria-label={t("Words", "Palabras")} />}
              <div className="qbo-barra" style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" data-accion="categorizar" disabled={!cuentaId} onClick={() => {
                  if (crearRegla && palabra.trim()) d({ tipo: "guardarRegla", regla: { id: nuevoId("r"), contiene: palabra.trim(), cuentaId } });
                  d({ tipo: "categorizar", id: m.id, cuentaId });
                  onCerrar();
                }}>{t("Categorize", "Categorizar")}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { d({ tipo: "excluir", id: m.id }); onCerrar(); }}>{t("Exclude (duplicate / personal)", "Excluir (duplicado / personal)")}</button>
              </div>
            </div>
          </>
        ) : <p className="qbo-explica">{conciliado ? t("Already reconciled; it can't be undone here.", "Ya conciliado; aquí no se deshace.") : t("Already recorded. Undo to change it.", "Ya registrado. Deshaz para cambiarlo.")}</p>}
      </div>
    </Ventana>
  );
}

function Reglas() {
  const { t } = usePrefs();
  const { e, d } = useQbo();
  const n = useNombres();
  const [contiene, setContiene] = useState("");
  const [cuentaId, setCuentaId] = useState("");
  const filas = useMemo(() => e.reglas.map((r) => ({ ...r, cuenta: n.cuenta(r.cuentaId), coinciden: e.movimientos.filter((m) => m.estado === "new" && m.descripcion.toLowerCase().includes(r.contiene.toLowerCase())).length })), [e, n]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "contiene", en: "If the description contains", es: "Si la descripción contiene", ancho: 220, fija: true, valor: (r) => r.contiene },
    { key: "cuenta", en: "Put it in account", es: "Ponerlo en la cuenta", ancho: 260, valor: (r) => r.cuenta },
    { key: "coinciden", en: "Matching now", es: "Coinciden ahora", ancho: 120, numerico: true, valor: (r) => r.coinciden },
  ], []);
  return (
    <>
      <div className="qbo-caja">
        <h2>{t("New rule", "Nueva regla")}</h2>
        <div className="qbo-campos">
          <Campo etiqueta={t("If the description contains", "Si la descripción contiene")}><input value={contiene} data-campo="regla-contiene" placeholder="HOME DEPOT" onChange={(ev) => setContiene(ev.target.value)} /></Campo>
          <Campo etiqueta={t("Put it in account", "Ponerlo en la cuenta")}><SelectorDeCuenta valor={cuentaId} onCambia={setCuentaId} /></Campo>
        </div>
        <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={!contiene.trim() || !cuentaId} onClick={() => { d({ tipo: "guardarRegla", regla: { id: nuevoId("r"), contiene: contiene.trim(), cuentaId } }); setContiene(""); setCuentaId(""); }}>{t("Add rule", "Agregar regla")}</button>
      </div>
      <TablaEstandar id="app-draft-qbo-reglas" filas={filas} claveDe={(r) => r.id} columnas={columnas} vacio={t("No rules yet.", "Todavía no hay reglas.")}
        acciones={(r) => <button type="button" className="btn btn-sm btn-ghost" aria-label={t("Delete rule", "Borrar regla")} onClick={() => d({ tipo: "borrarRegla", id: r.id })}>🗑</button>} />
    </>
  );
}

/**
 * Conciliar: se escribe el saldo final del estado de cuenta del banco y se marcan los movimientos de nuestros libros que
 * el banco ya muestra. Cuando la diferencia llega a 0, se termina y quedan marcados como conciliados.
 */
function Conciliar() {
  const { t } = usePrefs();
  const { e, d, hoy, libro } = useQbo();
  const banco = e.bancos[0];
  const [fechaCorte, setFechaCorte] = useState(hoy);
  const [saldoFinal, setSaldoFinal] = useState<number>(() => saldoSegunBanco(e, banco.id));
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [hecho, setHecho] = useState("");
  const ya = useMemo(() => new Set(e.conciliados), [e.conciliados]);
  const registro = useMemo(() => registroDelBanco(libro, banco.cuentaId), [libro, banco.cuentaId]);
  const pendientes = useMemo(() => registro.filter((r) => !ya.has(r.clave) && r.fecha <= fechaCorte), [registro, ya, fechaCorte]);
  const c = cuentaDeConciliacion(registro, ya, marcados, saldoFinal);
  const columnas = useMemo<ColumnaEstandar<(typeof pendientes)[number]>[]>(() => [
    { key: "fecha", en: "Date", es: "Fecha", ancho: 105, fija: true, valor: (r) => r.fecha },
    { key: "memo", en: "What", es: "Qué", ancho: 230, valor: (r) => r.memo },
    { key: "nombre", en: "Who", es: "Quién", ancho: 180, valor: (r) => r.nombre },
    { key: "entra", en: "Money in", es: "Entra", ancho: 110, numerico: true, valor: (r) => (r.efecto > 0 ? r.efecto : null), celda: (r) => (r.efecto > 0 ? dinero(r.efecto) : "") },
    { key: "sale", en: "Money out", es: "Sale", ancho: 110, numerico: true, valor: (r) => (r.efecto < 0 ? -r.efecto : null), celda: (r) => (r.efecto < 0 ? dinero(-r.efecto) : "") },
  ], []);
  return (
    <>
      <p className="qbo-explica">{t("Reconciling = checking our books against the bank statement. Type the ending balance printed on the statement, then tick every line the statement shows. When the difference is $0.00, you're done.",
        "Conciliar = comprobar nuestros libros contra el estado de cuenta del banco. Escribe el saldo final que trae el estado de cuenta y marca cada renglón que aparece en él. Cuando la diferencia sea $0.00, terminaste.")}</p>
      <div className="qbo-campos">
        <Campo etiqueta={t("Statement end date", "Fecha de corte")}><input type="date" value={fechaCorte} onChange={(ev) => setFechaCorte(ev.target.value)} /></Campo>
        <Campo etiqueta={t("Statement ending balance", "Saldo final del estado de cuenta")}><input type="number" step="0.01" inputMode="decimal" data-campo="saldo-final" value={saldoFinal} onChange={(ev) => setSaldoFinal(Number(ev.target.value) || 0)} /></Campo>
      </div>
      <div className="qbo-kpis">
        <div className="qbo-kpi"><span>{t("Starting (already reconciled)", "Inicial (ya conciliado)")}</span><b>{dinero(c.inicial)}</b></div>
        <div className="qbo-kpi"><span>{t("Ticked now", "Marcado ahora")}</span><b>{dinero(c.marcado)}</b></div>
        <div className="qbo-kpi"><span>{t("Cleared balance", "Saldo despejado")}</span><b>{dinero(c.despejado)}</b></div>
        <div className={`qbo-kpi${Math.abs(c.diferencia) < 0.005 ? "" : " qbo-kpi-alerta"}`}><span>{t("Difference (must be $0.00)", "Diferencia (debe ser $0.00)")}</span><b data-kpi="diferencia" className={Math.abs(c.diferencia) < 0.005 ? "qbo-verde" : ""}>{dinero(c.diferencia)}</b></div>
      </div>
      <div className="qbo-barra">
        <button type="button" className="btn btn-sm btn-ghost" data-accion="marcar-vistos" onClick={() => {
          // Ayuda del prototipo: marca lo que el «feed» del banco ya trae (emparejado o categorizado).
          const vistos = new Set<string>();
          for (const m of e.movimientos) {
            if (m.fecha > fechaCorte) continue;
            if (m.enlace) registro.filter((r) => r.origen === `${m.enlace!.tipo}:${m.enlace!.id}`).forEach((r) => vistos.add(r.clave));
            if (m.estado === "categorized") registro.filter((r) => r.origen === `bankTx:${m.id}`).forEach((r) => vistos.add(r.clave));
          }
          setMarcados(new Set([...vistos].filter((k) => pendientes.some((p) => p.clave === k))));
        }}>✓ {t("Tick what the bank feed shows", "Marcar lo que trae el banco")}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMarcados(new Set())}>{t("Clear ticks", "Quitar marcas")}</button>
        <button type="button" className="btn btn-sm btn-green" data-accion="terminar-conciliacion" disabled={Math.abs(c.diferencia) >= 0.005 || marcados.size === 0} onClick={() => {
          d({ tipo: "conciliar", id: nuevoId("rec"), bancoId: banco.id, fechaCorte, saldoFinal: r2(saldoFinal), claves: [...marcados], hecha: hoy });
          setMarcados(new Set());
          setHecho(t("Reconciled. Those lines are now locked as cleared.", "Conciliado. Esos renglones quedan marcados como despejados."));
        }}>{t("Finish reconciling", "Terminar conciliación")}</button>
      </div>
      {hecho && <p className="qbo-ok" role="status">{hecho}</p>}
      <TablaEstandar id="app-draft-qbo-conciliar" filas={pendientes} claveDe={(r) => r.clave} columnas={columnas} seleccion={{ marcadas: marcados, onCambia: setMarcados }}
        ordenInicial={{ clave: "fecha", direccion: "asc" }} vacio={t("Nothing left to reconcile up to this date.", "No queda nada por conciliar hasta esta fecha.")} />
      {e.conciliaciones.length > 0 && (
        <div className="qbo-caja">
          <h2>{t("Past reconciliations", "Conciliaciones hechas")}</h2>
          {e.conciliaciones.map((x) => <div key={x.id} className="qbo-renglon"><span>{t("Statement", "Estado de cuenta")} {x.fechaCorte} · {t("done", "hecha")} {x.hecha}</span><span className="qbo-num">{dinero(x.saldoFinal)}</span></div>)}
        </div>
      )}
    </>
  );
}
