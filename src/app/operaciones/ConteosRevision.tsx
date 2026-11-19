"use client";

import { mensajeDeError } from "@/lib/mensaje-de-error";
import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtMoney } from "@/lib/utils";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import {
  cuentasDeLinea, enCajas, estaContada, hayDiferencias, ordenarPorDiferencia, pendienteDeLinea, resumenDelConteo,
  type AccionDeConteo, type Conteo, type CuentasDeLinea, type Linea, type OrdenPendiente,
} from "@/lib/almacen-ops/conteos";
import {
  agregarPendiente, ajustarConteo, avanzarConteo, editarPendiente, firmarConteo, ponerSistema, quitarPendiente, volverARevision, type Conteos as Datos,
} from "@/lib/almacen-ops/conteos-datos";
import type { Contexto } from "./Operaciones";
import { FormAdjuntar, FormNota, FormPendiente, FormSistema } from "./ConteosFormularios";

/**
 * Operaciones de almacén (333): los dos paneles nuevos del conteo.
 *   PanelDeRevision (etapa 3): las órdenes pendientes POR PRODUCTO, después de contar (factura, cantidad vendida y no
 *                   entregada, nota). Lo contado − lo pendiente = lo real.
 *   PanelDeFirma (etapa 4): contado, pendiente, real, SISTEMA (tecleado si no venía), diferencia en piezas, cajas y $;
 *                   con diferencias pide la razón; firma, ajusta (las cantidades son la diferencia NUEVA) o vuelve a revisar.
 */

type Pon = (f: (d: Datos) => Datos) => void;
type Fila = { id: string; l: Linea; pend: number; c: CuentasDeLinea };

export function PanelDeRevision({ c, lineas, pendientes, ctx, pon, acciones, sin333, onError, nombre }: {
  c: Conteo; lineas: Linea[]; pendientes: OrdenPendiente[]; ctx: Contexto; pon: Pon; acciones: AccionDeConteo[]; sin333: boolean; onError: (m: string | null) => void; nombre: (id: string | null) => string;
}) {
  const { t } = usePrefs();
  const [editando, setEditando] = useState<{ linea: Linea | null; orden: OrdenPendiente | null } | null>(null);
  const [terminando, setTerminando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const puede = acciones.includes("pendiente") && !sin333;
  const contadas = useMemo(() => lineas.filter(estaContada).sort((a, b) => a.position - b.position), [lineas]);
  const lineaDe = (id: string) => lineas.find((l) => l.id === id) ?? null;
  const ppbDe = (id: string) => lineaDe(id)?.pieces_per_box ?? null;

  const quitar = async (o: OrdenPendiente) => {
    setOcupado(true); onError(null);
    try {
      if (!ctx.demo) await quitarPendiente(createClient(), o.id);
      pon((d) => ({ ...d, pendientes: d.pendientes.filter((x) => x.id !== o.id) }));
    } catch (e) { onError(mensajeDeError(e)); } finally { setOcupado(false); }
  };

  const columnas: ColumnaEstandar<OrdenPendiente>[] = [
    { key: "factura", en: "Invoice", es: "Factura", valor: (o) => o.invoice_no },
    { key: "producto", en: "Product", es: "Producto", valor: (o) => lineaDe(o.line_id)?.sku ?? "", celda: (o) => {
      const l = lineaDe(o.line_id);
      return l ? <><span className="hoja-folio">{l.sku}</span> {l.name}</> : "—";
    } },
    { key: "vendido", en: "Sold (pcs)", es: "Vendido (pzas)", numerico: true, valor: (o) => o.qty },
    { key: "cajas", en: "Boxes", es: "Cajas", numerico: true, valor: (o) => enCajas(o.qty, ppbDe(o.line_id)), celda: (o) => enCajas(o.qty, ppbDe(o.line_id)) ?? "—" },
    { key: "nota", en: "Note", es: "Nota", valor: (o) => o.note ?? "", envuelve: true },
    { key: "quien", en: "Entered by", es: "Lo anotó", valor: (o) => o.entered_by_name ?? nombre(o.entered_by), oculta: true },
    { key: "cuando", en: "When", es: "Cuándo", valor: (o) => o.entered_at, celda: (o) => fmtDateTime(o.entered_at), oculta: true },
    { key: "quitar", en: "", es: "", valor: () => null, fija: true, ancho: 44, celda: (o) => (puede ? (
      <button type="button" className="btn btn-sm btn-ghost" disabled={ocupado} onClick={(e) => { e.stopPropagation(); void quitar(o); }} data-accion="quitar-pendiente" aria-label={t("Remove order", "Quitar orden")}>✕</button>
    ) : null) },
  ];

  const guardar = async (x: { lineId: string; factura: string; cajas: number | null; sueltas: number | null; total: number | null; nota: string }) => {
    const ed = editando;
    let id = ed?.orden?.id ?? `p-${Date.now()}`;
    if (!ctx.demo) {
      const sb = createClient();
      id = ed?.orden ? (await editarPendiente(sb, ed.orden.id, x), ed.orden.id) : await agregarPendiente(sb, x.lineId, x);
    }
    const ahora = new Date().toISOString();
    const qty = (x.total ?? 0) + (x.cajas != null && x.sueltas != null ? x.cajas * (ppbDe(x.lineId) ?? 0) + x.sueltas : 0);
    pon((d) => ({
      ...d,
      pendientes: ed?.orden
        ? d.pendientes.map((o) => (o.id === id ? { ...o, invoice_no: x.factura, qty, note: x.nota || null, edited_by_name: ctx.yo.full_name, edited_at: ahora } : o))
        : [...d.pendientes, { id, count_id: c.id, line_id: x.lineId, invoice_no: x.factura, qty, note: x.nota || null, entered_by: ctx.yo.id, entered_by_name: ctx.yo.full_name, entered_at: ahora, edited_by_name: null, edited_at: null }],
    }));
    setEditando(null);
  };

  const terminar = async (nota: string) => {
    setOcupado(true); onError(null);
    try {
      if (!ctx.demo) await avanzarConteo(createClient(), c.id, "sign_off", nota || null);
      const ahora = new Date().toISOString();
      pon((d) => ({ ...d, conteos: d.conteos.map((x) => (x.id === c.id ? { ...x, stage: "sign_off", orders_reviewed_at: ahora, orders_reviewed_by: ctx.yo.id, orders_note: nota || null } : x)) }));
      setTerminando(false);
    } catch (e) { onError(mensajeDeError(e)); } finally { setOcupado(false); }
  };

  return (
    <section className="ops-etapas" data-panel-revision={c.id}>
      <h4>{t("Pending orders", "Órdenes pendientes")} <span className="ops-cuenta">{pendientes.length}</span></h4>
      <p className="hint">{t("After the count: for each product, the invoices that already sold part of it and are not delivered yet. Counted minus pending is the actual.", "Después de contar: por producto, las facturas que ya vendieron parte y no se han entregado. Contado menos pendiente es lo real.")}</p>
      {sin333 && <p className="ops-aviso" data-aviso-333>{t("Pending orders need migration 333 in the database. Until it is applied, they cannot be saved.", "Las órdenes pendientes necesitan la migración 333 de la base. Hasta que se aplique, no se pueden guardar.")}</p>}
      <ul className="ops-lineas-conteo" data-revision-lineas={contadas.length}>
        {contadas.map((l) => {
          const cu = cuentasDeLinea(l, pendienteDeLinea(pendientes, l.id));
          return (
            <li key={l.id} className="ops-linea-conteo contada" data-revision-linea={l.id}>
              <div className="ops-linea-conteo-boton">
                <span className="ops-linea-conteo-nombre"><span className="hoja-folio">{l.sku}</span> {l.name}{l.size_in ? <span className="hint"> · {l.size_in}</span> : null}</span>
                <span className="ops-linea-conteo-cifras">
                  <span>{t("Counted", "Contado")}: <b>{cu.contado ?? "—"}</b></span>
                  <span>{t("Pending", "Pendiente")}: <b data-pendiente={cu.pendiente}>{cu.pendiente}</b></span>
                  <span>{t("Actual", "Real")}: <b>{cu.real ?? "—"}</b></span>
                </span>
              </div>
              {puede && <button type="button" className="btn btn-sm" onClick={() => setEditando({ linea: l, orden: null })} data-accion="agregar-pendiente">＋ {t("Add order", "Agregar orden")}</button>}
            </li>
          );
        })}
      </ul>
      <TablaEstandar id={`pendientes-${c.id}`} data-tabla={`pendientes-${c.id}`} filas={pendientes} claveDe={(o) => o.id} columnas={columnas}
        onFila={puede ? (o) => setEditando({ linea: lineaDe(o.line_id), orden: o }) : undefined}
        vacio={t("No pending orders recorded. If there are none, go on to sign off.", "No hay órdenes pendientes anotadas. Si no hay, sigue a firmar.")} />
      {puede && !terminando && (
        <div className="ops-etapa-acciones" data-paso="3">
          <button type="button" className="ops-boton ops-boton-primario" onClick={() => setTerminando(true)} disabled={ocupado} data-accion="terminar-revision">✅ {t("Review done, go to sign off", "Revisión lista, pasar a firmar")}</button>
        </div>
      )}
      {terminando && (
        <FormNota titulo={t("General note for the review (optional)", "Nota general de la revisión (opcional)")} texto={t("e.g. checked the open invoices with the cashier", "p. ej. revisé las facturas abiertas con caja")}
          boton={t("Go to sign off", "Pasar a firmar")} ocupado={ocupado} onCancelar={() => setTerminando(false)} onListo={(n) => void terminar(n)} />
      )}
      {editando && (
        <FormPendiente lineas={contadas} inicial={editando.orden} lineaFija={editando.linea} onCerrar={() => setEditando(null)} onListo={guardar} />
      )}
    </section>
  );
}

export function PanelDeFirma({ c, lineas, pendientes, ctx, pon, acciones, onError, nombre }: {
  c: Conteo; lineas: Linea[]; pendientes: OrdenPendiente[]; ctx: Contexto; pon: Pon; acciones: AccionDeConteo[]; onError: (m: string | null) => void; nombre: (id: string | null) => string;
}) {
  const { t } = usePrefs();
  const [cambiando, setCambiando] = useState<Linea | null>(null);
  const [firmando, setFirmando] = useState(false);
  const [ajustando, setAjustando] = useState(false);
  const [volviendo, setVolviendo] = useState(false);
  const [razon, setRazon] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const gestiona = acciones.includes("firmar") || acciones.includes("ajustar") || acciones.includes("volver");
  const filas: Fila[] = useMemo(() => ordenarPorDiferencia(lineas.filter(estaContada), pendientes).map((l) => {
    const pend = pendienteDeLinea(pendientes, l.id);
    return { id: l.id, l, pend, c: cuentasDeLinea(l, pend) };
  }), [lineas, pendientes]);
  const resumen = resumenDelConteo(lineas, pendientes);
  const sinSistema = lineas.filter((l) => estaContada(l) && l.system_qty == null).length;
  const sinContar = lineas.filter((l) => !estaContada(l)).length;
  const dif = hayDiferencias(lineas, pendientes);
  const firmado = !!c.signed_at;
  const puedeFirmar = acciones.includes("firmar") && sinSistema === 0 && sinContar === 0 && (!dif || razon.trim().length >= 2);
  const cambiarSistema = gestiona && c.stage === "sign_off";
  const ajuste = filas.filter((f) => f.c.diferencia != null && f.c.diferencia !== 0);

  const ponerSis = async (l: Linea, qty: number) => {
    if (!ctx.demo) await ponerSistema(createClient(), l.id, qty);
    const ahora = new Date().toISOString();
    pon((d) => ({
      ...d,
      lineas: d.lineas.map((x) => (x.id === l.id ? { ...x, system_qty: qty, system_qty_set_by: ctx.yo.id, system_qty_set_by_name: ctx.yo.full_name, system_qty_set_at: ahora } : x)),
      conteos: d.conteos.map((x) => (x.id === c.id && x.signed_at ? { ...x, signed_at: null, signed_by: null, signed_by_name: null, signed_sheet: null, sign_note: null } : x)),
    }));
    setCambiando(null);
  };

  const columnas: ColumnaEstandar<Fila>[] = [
    { key: "producto", en: "Product", es: "Producto", valor: (f) => f.l.sku, celda: (f) => <><span className="hoja-folio">{f.l.sku}</span> {f.l.name}{f.l.size_in ? <span className="hint"> · {f.l.size_in}</span> : null}</>, ancho: 220, envuelve: true },
    { key: "contado", en: "Counted", es: "Contado", numerico: true, valor: (f) => f.c.contado },
    { key: "pendiente", en: "Pending", es: "Pendiente", numerico: true, valor: (f) => f.c.pendiente },
    { key: "real", en: "Actual", es: "Real", numerico: true, valor: (f) => f.c.real },
    { key: "sistema", en: "System", es: "Sistema", numerico: true, valor: (f) => f.c.sistema, celda: (f) => (f.c.sistema == null
      ? <span className="ops-kpi-rojo" data-sin-sistema>{t("Enter", "Teclear")}</span> : f.c.sistema) },
    { key: "dif", en: "Diff (pcs)", es: "Dif. (pzas)", numerico: true, valor: (f) => f.c.diferencia, celda: (f) => (f.c.diferencia == null ? "—" : (
      <span className={f.c.diferencia === 0 ? "ops-kpi-verde" : "ops-kpi-rojo"} data-diferencia={f.c.diferencia}>{f.c.diferencia > 0 ? "+" : ""}{f.c.diferencia}</span>)) },
    { key: "cajas", en: "Diff (boxes)", es: "Dif. (cajas)", numerico: true, valor: (f) => enCajas(f.c.diferencia, f.l.pieces_per_box), celda: (f) => {
      const cj = enCajas(f.c.diferencia, f.l.pieces_per_box);
      return cj == null ? "—" : <span className={cj === 0 ? "" : "ops-kpi-rojo"}>{cj > 0 ? "+" : ""}{cj}</span>;
    } },
    { key: "valor", en: "$", es: "$", numerico: true, valor: (f) => f.c.valor, celda: (f) => (f.c.valor == null ? "—" : (
      <span className={f.c.valor === 0 ? "" : "ops-kpi-rojo"}>{f.c.valor > 0 ? "+" : ""}{fmtMoney(f.c.valor)}</span>)) },
  ];

  const firmar = async (rutas: string[]) => {
    setOcupado(true); onError(null);
    try {
      const hoja = rutas[0] ?? null;
      const nota = dif ? razon.trim() : "";
      if (!ctx.demo) await firmarConteo(createClient(), c.id, hoja, nota || null);
      pon((d) => ({ ...d, conteos: d.conteos.map((x) => (x.id === c.id ? { ...x, signed_at: new Date().toISOString(), signed_by: ctx.yo.id, signed_by_name: ctx.yo.full_name, signed_sheet: hoja, sign_note: nota || null } : x)) }));
      setFirmando(false);
    } catch (e) { onError(mensajeDeError(e)); } finally { setOcupado(false); }
  };

  const ajustar = async (rutas: string[]) => {
    setOcupado(true); onError(null);
    try {
      if (!ctx.demo) await ajustarConteo(createClient(), c.id, rutas);
      pon((d) => ({ ...d, conteos: d.conteos.map((x) => (x.id === c.id ? { ...x, stage: "adjusted", adjusted_at: new Date().toISOString(), adjusted_by: ctx.yo.id, adjustment_shots: rutas } : x)) }));
      setAjustando(false);
    } catch (e) { onError(mensajeDeError(e)); } finally { setOcupado(false); }
  };

  const volver = async (nota: string) => {
    setOcupado(true); onError(null);
    try {
      if (!ctx.demo) await volverARevision(createClient(), c.id, nota);
      pon((d) => ({ ...d, conteos: d.conteos.map((x) => (x.id === c.id ? { ...x, stage: "review", signed_at: null, signed_by: null, signed_by_name: null, signed_sheet: null, sign_note: null, orders_note: nota || x.orders_note } : x)) }));
      setVolviendo(false);
    } catch (e) { onError(mensajeDeError(e)); } finally { setOcupado(false); }
  };

  return (
    <section className="ops-etapas" data-panel-firma={c.id}>
      <h4>{t("Counted, pending and system", "Contado, pendiente y sistema")} <span className="ops-cuenta">{resumen.contadas}/{resumen.lineas}</span></h4>
      <p className="hint">{t("Actual = counted − pending. Difference = actual − system. Tap a line to type the system quantity.", "Real = contado − pendiente. Diferencia = real − sistema. Toca una línea para teclear la cantidad del sistema.")}</p>
      {sinSistema > 0 && cambiarSistema && <p className="ops-aviso" data-falta-sistema={sinSistema}>{t(`${sinSistema} lines have no system quantity. Tap each one to type it.`, `Faltan ${sinSistema} cantidades del sistema. Toca cada línea para teclearla.`)}</p>}
      <p className="ops-resumen-conteo" data-resumen data-exactitud={resumen.exactitudPct ?? ""}>
        <span className="ops-insignia ops-insignia-ok">{resumen.exactas} {t("exact", "exactas")}</span>
        <span className={`ops-insignia ${resumen.conDiferencia > 0 ? "ops-insignia-repetida" : ""}`}>{resumen.conDiferencia} {t("with difference", "con diferencia")}</span>
        <span className="ops-insignia" data-faltan={resumen.faltanPiezas}>{t("Missing", "Faltan")} {resumen.faltanPiezas} {t("pcs", "pzas")} · {fmtMoney(resumen.faltanValor)}</span>
        <span className="ops-insignia" data-sobran={resumen.sobranPiezas}>{t("Over", "Sobran")} {resumen.sobranPiezas} {t("pcs", "pzas")} · {fmtMoney(resumen.sobranValor)}</span>
        <span className="ops-insignia">{t("Net", "Neto")} {resumen.valorNeto > 0 ? "+" : ""}{fmtMoney(resumen.valorNeto)}</span>
      </p>
      <TablaEstandar id={`firma-${c.id}`} data-tabla={`firma-${c.id}`} filas={filas} claveDe={(f) => f.id} columnas={columnas}
        claseDeFila={(f) => (f.c.diferencia == null ? "sin-sistema" : f.c.diferencia !== 0 ? "con-diferencia" : "")}
        onFila={cambiarSistema ? (f) => setCambiando(f.l) : undefined}
        vacio={t("No counted lines.", "No hay líneas contadas.")} />

      {/* Firma: la razón si hay diferencias; el sistema en todas las líneas */}
      {acciones.includes("firmar") && (
        <div className="ops-etapa-acciones" data-firma-panel>
          {dif && <label className="ops-cantidad"><span>{t("Reason for the differences (required)", "Razón de las diferencias (obligatoria)")}</span>
            <textarea className="ops-campo" rows={2} value={razon} onChange={(e) => setRazon(e.target.value)} placeholder={t("e.g. 2 boxes broken in the back, pick not recorded", "p. ej. 2 cajas rotas atrás, surtido no registrado")} data-campo="razon-firma" />
          </label>}
          {!firmando && (
            <button type="button" className="ops-boton ops-boton-primario" onClick={() => setFirmando(true)} disabled={!puedeFirmar || ocupado} data-accion="firmar">✍️ {t("Sign off", "Firmar")}</button>
          )}
          {!puedeFirmar && <p className="hint">{sinContar > 0 ? t("Some lines are not counted yet.", "Faltan líneas por contar.") : sinSistema > 0 ? t("Type the system quantity of every line first.", "Primero teclea la cantidad del sistema de cada línea.") : dif ? t("Write the reason to sign with differences.", "Escribe la razón para firmar con diferencias.") : ""}</p>}
          {firmando && <FormAdjuntar ctx={ctx} titulo={t("Sign off", "Firmar")} texto={t(`Your name (${ctx.yo.full_name}) and today's date are recorded. Optionally attach the signed printed sheet (photo or PDF).`, `Quedan tu nombre (${ctx.yo.full_name}) y la fecha de hoy. Si quieres, adjunta la hoja impresa firmada (foto o PDF).`)}
            boton={t("Sign off", "Firmar")} opcional multiple={false} que="hoja" ocupado={ocupado} onCancelar={() => setFirmando(false)} onListo={(r) => void firmar(r)} />}
        </div>
      )}

      {/* Firmado: el ajuste (la diferencia NUEVA, después de pendientes) y volver a revisar */}
      {firmado && (
        <div className="ops-etapa-acciones" data-firmado-panel>
          <p className="hint" data-firmado>✍️ {t("Signed by", "Firmó")} {c.signed_by_name ?? nombre(c.signed_by)} · {fmtDateTime(c.signed_at)}</p>
          {c.sign_note && <p className="ops-nota-fallo">🗒 {c.sign_note}</p>}
          {acciones.includes("ajustar") && ajuste.length > 0 && (
            <div className="ops-ajuste-resumen" data-ajuste={ajuste.length}>
              <p><strong>{t("To adjust in the ERP (new difference, after pending orders)", "Para ajustar en el ERP (la diferencia nueva, después de pendientes)")}</strong></p>
              <ul className="ops-fotos-lista">
                {ajuste.map((f) => <li key={f.id} className="ops-insignia" data-ajuste-linea={f.id}><span className="hoja-folio">{f.l.sku}</span> {f.c.diferencia! > 0 ? "+" : ""}{f.c.diferencia} {t("pcs", "pzas")}{enCajas(f.c.diferencia, f.l.pieces_per_box) != null && ` (${enCajas(f.c.diferencia, f.l.pieces_per_box)} ${t("boxes", "cajas")})`} · {fmtMoney(f.c.valor ?? 0)}</li>)}
              </ul>
            </div>
          )}
          {acciones.includes("ajustar") && !ajustando && <button type="button" className="ops-boton ops-boton-primario" onClick={() => setAjustando(true)} disabled={ocupado} data-accion="ajustar">🧾 {t("Adjusted in ERP: upload screenshot", "Ajustado en el ERP: subir captura")}</button>}
          {ajustando && <FormAdjuntar ctx={ctx} titulo={t("Adjust & screenshot", "Ajustar y captura")} texto={t("Upload the ERP screenshot(s) showing the adjustment. The count closes as Adjusted.", "Sube la(s) captura(s) del ERP con el ajuste hecho. El conteo se cierra como Ajustado.")}
            boton={t("Upload and mark Adjusted", "Subir y marcar Ajustado")} opcional={false} multiple que="ajuste" ocupado={ocupado} onCancelar={() => setAjustando(false)} onListo={(r) => void ajustar(r)} />}
          {acciones.includes("volver") && !volviendo && <button type="button" className="btn btn-sm" onClick={() => setVolviendo(true)} disabled={ocupado} data-accion="volver-revision">↩ {t("Back to review", "Volver a revisar")}</button>}
          {volviendo && <FormNota titulo={t("Back to review", "Volver a revisar")} texto={t("Why? (optional)", "¿Por qué? (opcional)")} boton={t("Back to review", "Volver a revisar")} ocupado={ocupado} onCancelar={() => setVolviendo(false)} onListo={(n) => void volver(n)} />}
        </div>
      )}

      {cambiando && (
        <FormSistema l={cambiando} pendiente={pendienteDeLinea(pendientes, cambiando.id)} onCerrar={() => setCambiando(null)} onListo={(qty) => ponerSis(cambiando, qty)} />
      )}
    </section>
  );
}
