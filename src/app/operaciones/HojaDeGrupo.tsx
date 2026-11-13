"use client";

import { mensajeDeError } from "@/lib/mensaje-de-error";
import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtMoney } from "@/lib/utils";
import {
  aprobarGrupo, borrarGrupo, enlacesDeFotos, firmarGrupo, grupoConReportes, quitarFirmaGrupo, sacarDeGrupo, type Reporte,
} from "@/lib/almacen-ops/datos";
import { firmaDe, firmaValida, nombreDeSlot, puedeFirmarSlot, SLOTS_DE_FIRMA, type FirmaDeMerma } from "@/lib/almacen-ops/firmas";
import { estadoDelGrupo, grupoAprobado, puedeAprobarGrupo, puedeImprimirGrupo, type GrupoDeMerma } from "@/lib/almacen-ops/grupos";
import { EMPRESA, RECORDATORIO_EN, RECORDATORIO_ES, filasDeHoja, tiendasDeHoja, totalDeHoja } from "@/lib/almacen-ops/etapas";
import { etiquetaDeOpcion } from "@/lib/almacen-ops/pasos";
import { repartoDeReporte } from "@/lib/almacen-ops/perdida";
import { fmtDia } from "@/lib/almacen-ops/fecha-del-dano";
import { puedeCorregirMerma } from "@/lib/almacen-ops/visibilidad";
import { particionaPorEtapa, resumenDeBloque } from "@/lib/almacen-ops/bloque";
import { aplicarEtapa, AdjuntarYMarcar, ErrorParcial } from "./EtapasDeMerma";
import { FirmaPad } from "./FirmaPad";
import { aprobarGrupoDePractica, borrarGrupoDePractica, esGrupoDePractica, firmarGrupoDePractica, grupoDePractica, quitarFirmaDePractica, sacarDeGrupoDePractica } from "@/lib/practica/grupos-de-practica";
import { esAdminDeLaApp } from "@/lib/almacen-ops/nivel";
import { VisorDeFotos } from "./VisorDeFotos";
import { Tarjeta } from "./ListaDeReportes";
import type { Contexto } from "./Operaciones";
import { SelectorDeColumnasDeHoja, useColumnasDeHoja } from "./ColumnasDeHoja";
import { COLUMNAS_DE_HOJA, tramoDelTotal } from "@/lib/almacen-ops/columnas-de-hoja";
import { CerrarX } from "./CerrarX";
import "./reportes/hoja-de-aprobacion/hoja.css";

/**
 * Hoja de aprobación DIGITAL de un grupo (281). La versión interactiva de la hoja impresa: se ven las dos firmas, cada
 * fila abre las fotos de ese reporte, y aquí mismo el gerente y el supervisor firman; con las dos firmas se aprueba el
 * grupo y todas sus mermas pasan a aprobada. Sin las dos firmas, el botón de aprobar no aparece (y la base también lo exige).
 */
export function HojaDeGrupo({ grupoId, ctx, onSalir }: { grupoId: string; ctx: Contexto; onSalir: () => void }) {
  const { t, lang } = usePrefs();
  // Ayuda de Roberto (12 nov): qué columnas lleva la hoja (las ocultas tampoco se imprimen).
  const cols = useColumnasDeHoja(ctx.yo.id);
  const [grupo, setGrupo] = useState<GrupoDeMerma | null>(null);
  const [reportes, setReportes] = useState<Reporte[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [firmando, setFirmando] = useState<null | "gerente" | "supervisor">(null);
  const [fotosDe, setFotosDe] = useState<Reporte | null>(null);
  // Selección parcial dentro del grupo (dueño, 10 nov): marcar algunos miembros y desecharlos/ajustarlos en bloque.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [avisoB, setAvisoB] = useState<string | null>(null);
  const [ajustB, setAjustB] = useState(false);
  // Click en el folio: abre el reporte en la app para revisarlo (dueño, 10 nov), sin salir de la hoja.
  const [verReporte, setVerReporte] = useState<Reporte | null>(null);
  // 296: confirmar «Borrar grupo» en la propia hoja (los diálogos del navegador no se usan).
  const [confirmaBorrar, setConfirmaBorrar] = useState(false);

  const practica = esGrupoDePractica(grupoId);
  const recarga = useCallback(async () => {
    // Modo enseñanza: el grupo vive en memoria (grupos-de-practica); no se lee la base.
    if (esGrupoDePractica(grupoId)) {
      const g = grupoDePractica(grupoId);
      if (!g) { setError(t("This practice group is gone (practice groups are cleared when you leave teaching mode or press «Clear practice»).", "Este grupo de práctica ya no está (se borran al salir del modo enseñanza o con «Borrar práctica»).")); setGrupo(null); }
      else { setGrupo(g.grupo); setReportes(g.reportes); setError(null); }
      setCargando(false); return;
    }
    if (ctx.demo) { setCargando(false); setError(t("Groups are not available in demo mode.", "Los grupos no están en el modo demo.")); return; }
    try {
      const r = await grupoConReportes(createClient(), grupoId);
      if (!r) { setError(t("This group no longer exists, or migration 281 is not applied yet.", "Este grupo ya no existe, o falta aplicar la migración 281.")); setGrupo(null); }
      else { setGrupo(r.grupo); setReportes(r.reportes); setError(null); }
    } catch (e) { setError(mensajeDeError(e)); }
    setCargando(false);
  }, [grupoId, ctx.demo, t]);

  useEffect(() => { void recarga(); }, [recarga]);

  const corre = async (f: () => Promise<void>) => {
    setOcupado(true); setError(null);
    try { await f(); await recarga(); } catch (e) { setError(mensajeDeError(e)); }
    setOcupado(false);
  };

  if (cargando) return <p className="hint" data-grupo-cargando>{t("Loading…", "Cargando…")}</p>;
  if (error && !grupo) return (
    <div className="ops-merma">
      <button type="button" className="btn btn-ghost" onClick={onSalir}>✕ {t("Close", "Cerrar")}</button>
      <p className="ops-aviso ops-aviso-error">{error}</p>
    </div>
  );
  if (!grupo) return null;

  const firmas = grupo.firmas ?? [];
  const aprobado = grupoAprobado(grupo);
  const gestiona = puedeCorregirMerma(ctx.yo, { kind: "scrap", store: grupo.store });
  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "";
  const filas = filasDeHoja(reportes, nombre, (m) => etiquetaDeOpcion("scrap", "reason", m, lang) || (m ?? ""), (r) => repartoDeReporte(r).damaged);

  // Subconjunto marcado y a qué puede pasar (desechar = las aprobadas; ajustar = las desechadas, con una sola foto).
  const selReportes = reportes.filter((r) => sel.has(r.id));
  const bDesechar = particionaPorEtapa(selReportes, "dumped");
  const bAjustar = particionaPorEtapa(selReportes, "adjusted");
  const alternarSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Las casillas para desechar/ajustar en bloque salen cuando el grupo ya está aprobado (sus mermas están en «approved»
  // y de ahí pueden ir a desechada → ajustada) y quien mira gestiona.
  const conCasillas = gestiona && aprobado;
  // 296 (dueño, 11 nov: «an option to undo»): con el grupo PENDIENTE, quien gestiona puede sacar una merma o borrar el
  // grupo; las mermas vuelven a «Fotografiada». Ya aprobado, se deshace la etapa desde la tarjeta de cada merma.
  const editaGrupo = gestiona && !aprobado;
  const sacar = (r: Reporte) => {
    const ultima = reportes.length <= 1;
    void corre(async () => {
      if (practica) sacarDeGrupoDePractica(grupo.id, r.id);
      else await sacarDeGrupo(createClient(), r.id);
      setAvisoB(t("Removed from the group: it is back to «Photographed». The group's signatures were cleared.", "Se sacó del grupo: volvió a «Fotografiada». Las firmas del grupo se borraron."));
      if (ultima) onSalir();
    });
  };
  const borrar = async () => {
    setOcupado(true); setError(null);
    try {
      if (practica) borrarGrupoDePractica(grupo.id);
      else await borrarGrupo(createClient(), grupo.id);
      onSalir();
    } catch (e) { setError(mensajeDeError(e)); setOcupado(false); }
  };
  const marcarDesechadasG = async () => {
    const { elegibles, omitidos } = bDesechar;
    if (elegibles.length === 0) { setAvisoB(resumenDeBloque("dumped", 0, omitidos.length, lang)); return; }
    setOcupado(true); setError(null);
    try {
      const h = await aplicarEtapa(ctx, elegibles, "dumped", null);
      setAvisoB(resumenDeBloque("dumped", h.length, omitidos.length, lang));
      setSel(new Set());
      await recarga();
    } catch (e) {
      if (e instanceof ErrorParcial) { setAvisoB(e.message); await recarga(); } else setError(mensajeDeError(e));
    } finally { setOcupado(false); }
  };

  // Celdas fijas de la izquierda: casilla (si hay), «Sacar» (si se edita), «#» y fotos.
  const fijasIzq = (conCasillas ? 1 : 0) + (editaGrupo ? 1 : 0) + 2;
  const tramoTotal = tramoDelTotal(cols.ocultas, fijasIzq);
  return (
    <div className="ops-merma" data-hoja-grupo={grupo.id}>
      <div className="hoja-barra no-imprimir">
        {/* Dueño, 11 nov: el estado a la izquierda. Reunión 12 nov: «Imprimir» sube AQUÍ ARRIBA (lo demás sigue abajo). */}
        <span className={`ops-etapa-chip${aprobado ? " ops-grupo-aprobado" : ""}`} data-grupo-estado={aprobado ? "aprobado" : "pendiente"}>{estadoDelGrupo(grupo, lang)}</span>
        <span className="hoja-barra-acciones">
          {/* Aprobada: quien la ve. Pendiente (dueño, 12 nov): quien gestiona la tienda, para firmarla en papel. */}
          {puedeImprimirGrupo({ aprobado, gestiona }) && <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()} data-accion="imprimir-grupo">🖨 {t("Print", "Imprimir")}</button>}
          <SelectorDeColumnasDeHoja ocultas={cols.ocultas} alterna={cols.alterna} lang={lang} t={t} />
        </span>
      </div>
      {error && <p className="ops-aviso ops-aviso-error no-imprimir">{error}</p>}
      <article className="hoja-aprobacion">
        {/* Impresa sin aprobar (dueño, 12 nov): que se vea en el papel que falta la aprobación; las líneas de firma
            vacías de abajo son para firmar a mano. */}
        {!aprobado && (
          <p className="hoja-banda-pendiente" data-hoja-pendiente>
            ⏳ {lang === "es" ? "PENDIENTE DE APROBACIÓN" : "PENDING APPROVAL — PENDIENTE DE APROBACIÓN"}
          </p>
        )}
        <header className="hoja-cabecera">
          <div>
            <h1>{EMPRESA}</h1>
            <h2>{t("Scrap approval sheet", "Hoja de aprobación de merma")} · {grupo.name}</h2>
          </div>
          <dl className="hoja-datos">
            <dt>{t("Store", "Tienda")}</dt><dd data-hoja-tienda>{tiendasDeHoja(filas) || grupo.store}</dd>
            <dt>{t("Date", "Fecha")}</dt><dd data-hoja-fecha>{fmtDia((grupo.approved_at ?? grupo.created_at).slice(0, 10), lang)}</dd>
            <dt>{t("Reports", "Reportes")}</dt><dd>{filas.length}</dd>
          </dl>
        </header>

        <p className="hoja-recordatorio" data-recordatorio>
          <strong>{RECORDATORIO_ES}</strong>
          <span lang="en">{RECORDATORIO_EN}</span>
        </p>

        {conCasillas && sel.size > 0 && (
          <div className="ops-seleccion no-imprimir" role="region" data-seleccion-grupo={sel.size}>
            <span>{t(`${sel.size} selected`, `${sel.size} seleccionada${sel.size === 1 ? "" : "s"}`)}</span>
            <button type="button" className="btn" disabled={ocupado || bDesechar.elegibles.length === 0} onClick={() => { setAjustB(false); void marcarDesechadasG(); }} data-accion="desechar-bloque-grupo">🗑 {t(`Mark as dumped (${bDesechar.elegibles.length})`, `Marcar como desechadas (${bDesechar.elegibles.length})`)}</button>
            <button type="button" className="btn" disabled={ocupado || bAjustar.elegibles.length === 0} onClick={() => { setAvisoB(null); setAjustB((x) => !x); }} data-accion="ajustar-bloque-grupo" aria-pressed={ajustB}>🧾 {t(`Mark as adjusted (${bAjustar.elegibles.length})`, `Marcar como ajustadas (${bAjustar.elegibles.length})`)}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSel(new Set()); setAjustB(false); setAvisoB(null); }}>{t("Clear", "Quitar")}</button>
          </div>
        )}
        {avisoB && <div className="hint no-imprimir" role="status" data-aviso-bloque-grupo>{avisoB}</div>}
        {ajustB && bAjustar.elegibles.length > 0 && (
          <div className="no-imprimir">
            <AdjuntarYMarcar reportes={bAjustar.elegibles} ctx={ctx} etapa="adjusted" etiqueta={t("Choose the system screenshot (one photo for all)", "Elegir la captura del sistema (una foto para todas)")}
              onListo={(n) => { setAjustB(false); setSel(new Set()); setAvisoB(resumenDeBloque("adjusted", n.length, bAjustar.omitidos.length, lang)); void recarga(); }}
              onParcial={() => void recarga()} onCancelar={() => setAjustB(false)} />
          </div>
        )}

        <table className="hoja-tabla" data-hoja-filas={filas.length}>
          <thead>
            <tr>
              {conCasillas && <th className="no-imprimir" aria-label={t("Select", "Marcar")} />}
              {editaGrupo && <th className="no-imprimir" aria-label={t("Remove from group", "Sacar del grupo")} />}
              <th>#</th><th aria-label={t("Photos", "Fotos")} className="no-imprimir" />
              {cols.ve("folio") && <th>{t("Folio", "Folio")}</th>}
              {cols.ve("dia") && <th>{t("Date broken", "Fecha del daño")}</th>}
              {cols.ve("producto") && <th>{t("Product", "Producto")}</th>}
              {cols.ve("danadas") && <th className="num">{t("Damaged pcs", "Dañadas (pzas)")}</th>}
              {cols.ve("cajas") && <th className="num">{t("Damaged boxes", "Cajas dañadas")}</th>}
              {cols.ve("perdida") && <th className="num">{t("Loss", "Pérdida")}</th>}
              {cols.ve("motivo") && <th>{t("Reason", "Motivo")}</th>}
              {cols.ve("rompio") && <th>{t("Broken by", "Lo rompió")}</th>}
              {cols.ve("reporto") && <th>{t("Reported by", "Lo reportó")}</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, n) => {
              const r = reportes.find((x) => x.id === f.id);
              const conFoto = !!r && r.photos.length > 0;
              return (
                <tr key={f.id} data-hoja-reporte={f.id}>
                  {conCasillas && <td className="no-imprimir ops-col-casilla">{r && <input type="checkbox" checked={sel.has(f.id)} onChange={() => alternarSel(f.id)} aria-label={t("Select", "Marcar")} data-marca-grupo={f.id} />}</td>}
                  {editaGrupo && <td className="no-imprimir">{r && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => sacar(r)} data-accion="sacar-del-grupo" data-sacar={f.id}
                      title={t("Remove from the group (back to «Photographed»)", "Sacar del grupo (vuelve a «Fotografiada»)")}>↩ {t("Remove", "Sacar")}</button>
                  )}</td>}
                  <td>{n + 1}</td>
                  <td className="no-imprimir">
                    {conFoto && (
                      <button type="button" className="ops-icono-fotos" data-ver-fotos={f.id} onClick={() => setFotosDe(r!)}
                        title={t("See photos", "Ver fotos")} aria-label={t(`See ${r!.photos.length} photos`, `Ver ${r!.photos.length} fotos`)}>📷 {r!.photos.length}</button>
                    )}
                  </td>
                  {cols.ve("folio") && <td className="hoja-folio">{r
                    ? <button type="button" className="ops-folio-link" onClick={() => setVerReporte(r)} data-abrir-reporte={f.id} title={t("Open this report", "Abrir este reporte")}>{f.folio}</button>
                    : f.folio}</td>}
                  {cols.ve("dia") && <td>{fmtDia(f.dia, lang)}</td>}
                  {cols.ve("producto") && <td>{f.producto}</td>}
                  {cols.ve("danadas") && <td className="num">{f.danadas}</td>}
                  {cols.ve("cajas") && <td className="num">{f.cajas}</td>}
                  {cols.ve("perdida") && <td className="num">{fmtMoney(f.perdida)}</td>}
                  {cols.ve("motivo") && <td>{f.motivo}</td>}
                  {cols.ve("rompio") && <td>{f.rompio}</td>}
                  {cols.ve("reporto") && <td>{f.reporto}</td>}
                </tr>
              );
            })}
            {filas.length === 0 && <tr><td colSpan={fijasIzq + COLUMNAS_DE_HOJA.length - cols.ocultas.length} className="hoja-vacia">{t("No reports in this group.", "No hay reportes en este grupo.")}</td></tr>}
          </tbody>
          {filas.length > 0 && (
            <tfoot>{tramoTotal
              ? <tr><td colSpan={tramoTotal.antes} className="num">{t("Total", "Total")}</td><td className="num" data-hoja-total>{fmtMoney(totalDeHoja(filas))}</td>{tramoTotal.despues > 0 && <td colSpan={tramoTotal.despues} />}</tr>
              : <tr><td colSpan={fijasIzq + COLUMNAS_DE_HOJA.length - cols.ocultas.length} className="num" data-hoja-total>{t("Total", "Total")}: {fmtMoney(totalDeHoja(filas))}</td></tr>}</tfoot>
          )}
        </table>
        {filas.some((f) => f.producto.endsWith(" *")) && <p className="hoja-nota">* {t("Product not in the catalog (name as written).", "Producto fuera del catálogo (nombre tal como se escribió).")}</p>}

        {/* Las dos firmas: dibujadas en la app. Si falta y quien mira gestiona, puede firmar aquí mismo. */}
        <section className="hoja-firmas hoja-firmas-digital">
          {SLOTS_DE_FIRMA.map((slot) => {
            const fm = firmaDe(firmas, slot);
            const puede = !aprobado && gestiona && puedeFirmarSlot(firmas, slot, ctx.yo.id, ctx.yo);
            return (
              <div className="hoja-firma" key={slot} data-firma-grupo={slot}>
                {firmaValida(fm?.signature_png)
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img className="hoja-firma-img" src={fm!.signature_png!} alt={nombreDeSlot(slot, lang)} />
                  : <span className="hoja-linea" />}
                <span>{slot === "gerente" ? t("Manager (approval)", "Gerente (autorización)") : t("Warehouse supervisor", "Supervisor de almacén")}</span>
                {fm && <span className="hoja-firma-quien" data-firmo={fm.signer_id ?? ""}>{fm.signer_name ?? ""}</span>}
                {!fm && puede && (
                  <button type="button" className="btn btn-sm btn-primary no-imprimir" disabled={ocupado} data-accion="firmar-grupo" data-slot={slot}
                    onClick={() => setFirmando(slot)}>✍ {t(`Sign as ${nombreDeSlot(slot, lang).toLowerCase()}`, `Firmar como ${nombreDeSlot(slot, lang).toLowerCase()}`)}</button>
                )}
                {/* 296: quita SU firma quien firmó (y el admin de la app, cualquiera), antes de aprobarse; también en práctica. */}
                {fm && !aprobado && gestiona && (fm.signer_id === ctx.yo.id || esAdminDeLaApp(ctx.yo)) && (
                  <button type="button" className="btn btn-ghost btn-sm no-imprimir" disabled={ocupado} data-accion="quitar-firma-grupo" data-slot={slot}
                    onClick={() => void corre(async () => { if (practica) quitarFirmaDePractica(grupo.id, slot); else await quitarFirmaGrupo(createClient(), grupo.id, slot); })}>{t("Remove signature", "Quitar firma")}</button>
                )}
              </div>
            );
          })}
        </section>

        {firmando && (
          <FirmaPad etiqueta={t(`Draw the ${nombreDeSlot(firmando, lang).toLowerCase()} signature`, `Dibuja la firma del ${nombreDeSlot(firmando, lang).toLowerCase()}`)}
            guardando={ocupado}
            onCancelar={() => setFirmando(null)}
            onFirmar={(png) => void corre(async () => {
              if (practica) firmarGrupoDePractica(grupo.id, firmando, png, { id: ctx.yo.id, nombre: ctx.yo.full_name });
              else await firmarGrupo(createClient(), grupo.id, firmando, png);
              setFirmando(null);
            })} />
        )}

        {/* Dueño (11 nov): sin botón «Aprobar grupo» ni aviso abajo — con la segunda firma el grupo se aprueba solo (283;
            en práctica también, `firmarGrupoDePractica`). Lo que falta ya lo dice el chip de arriba. */}
        {aprobado && <p className="hoja-pie" data-grupo-aprobado>{t("Approved — all reports in this group are now Approved.", "Aprobado — todas las mermas de este grupo quedaron Aprobadas.")}{grupo.approved_by ? ` · ${nombre(grupo.approved_by)}` : ""}</p>}
      </article>

      {/* Reunión 11 nov, 11 PM: los botones de acción ABAJO, como en el resto de la app (Cerrar al final). */}
      {confirmaBorrar && editaGrupo && (
        <div className="ops-aviso no-imprimir" role="alertdialog" data-confirma-borrar-grupo>
          <p>{t(`Delete this group? Its ${reportes.length} report(s) go back to «Photographed», without a group, and the signatures are cleared.`,
            `¿Borrar este grupo? Sus ${reportes.length} merma(s) vuelven a «Fotografiada», sin grupo, y las firmas se borran.`)}</p>
          <div className="ops-etapa-acciones">
            <button type="button" className="btn btn-danger" disabled={ocupado} onClick={() => void borrar()} data-accion="confirmar-borrar-grupo">{t("Yes, delete group", "Sí, borrar grupo")}</button>
            <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={() => setConfirmaBorrar(false)}>{t("Cancel", "Cancelar")}</button>
          </div>
        </div>
      )}

      <div className="modal-actions no-imprimir" data-acciones-grupo>
        {editaGrupo && <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={() => setConfirmaBorrar(true)} data-accion="borrar-grupo">🗑 {t("Delete group", "Borrar grupo")}</button>}
        <button type="button" className="btn btn-primary" onClick={onSalir} data-accion="cerrar-grupo">✕ {t("Close", "Cerrar")}</button>
      </div>

      {fotosDe && <ModalDeFotos r={fotosDe} ctx={ctx} onCerrar={() => setFotosDe(null)} />}
      {verReporte && <Tarjeta r={verReporte} ctx={ctx} onCerrar={() => setVerReporte(null)}
        onCambio={(n) => { setVerReporte(n); setReportes((rs) => rs.map((x) => (x.id === n.id ? n : x))); }} />}
    </div>
  );
}

/** Un visor simple de las fotos de un reporte (el ícono 📷 de cada fila de la hoja). */
function ModalDeFotos({ r, ctx, onCerrar }: { r: Reporte; ctx: Contexto; onCerrar: () => void }) {
  const { t, lang } = usePrefs();
  const [fotos, setFotos] = useState<string[]>([]);
  useEffect(() => {
    if (ctx.demo || r.photos.length === 0) return;
    let vivo = true;
    void enlacesDeFotos(createClient(), r.photos).then((u) => { if (vivo) setFotos(u); });
    return () => { vivo = false; };
  }, [r.photos, ctx.demo]);
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-tarjeta-reporte" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-fotos-reporte={r.id}>
        <CerrarX onCerrar={onCerrar} />
        <h3>📷 {r.product_name ?? t("Photos", "Fotos")}</h3>
        <p className="sub">{fmtDia(r.broken_on ?? r.created_at.slice(0, 10), lang)} · {r.store}</p>
        <VisorDeFotos fotos={fotos} demo={ctx.demo} />
        <div className="modal-actions"><button type="button" className="btn btn-primary" onClick={onCerrar}>{t("Close", "Cerrar")}</button></div>
      </div>
    </div>
  );
}
