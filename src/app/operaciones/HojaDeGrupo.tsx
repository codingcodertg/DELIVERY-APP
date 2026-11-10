"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtMoney } from "@/lib/utils";
import {
  aprobarGrupo, enlacesDeFotos, firmarGrupo, grupoConReportes, quitarFirmaGrupo, type Reporte,
} from "@/lib/almacen-ops/datos";
import { firmaDe, firmaValida, nombreDeSlot, puedeFirmarSlot, SLOTS_DE_FIRMA, type FirmaDeMerma } from "@/lib/almacen-ops/firmas";
import { estadoDelGrupo, grupoAprobado, puedeAprobarGrupo, type GrupoDeMerma } from "@/lib/almacen-ops/grupos";
import { EMPRESA, RECORDATORIO_EN, RECORDATORIO_ES, filasDeHoja, tiendasDeHoja, totalDeHoja } from "@/lib/almacen-ops/etapas";
import { etiquetaDeOpcion } from "@/lib/almacen-ops/pasos";
import { repartoDeReporte } from "@/lib/almacen-ops/perdida";
import { fmtDia } from "@/lib/almacen-ops/fecha-del-dano";
import { puedeCorregirMerma } from "@/lib/almacen-ops/visibilidad";
import { FirmaPad } from "./FirmaPad";
import { VisorDeFotos } from "./VisorDeFotos";
import { Tarjeta } from "./ListaDeReportes";
import type { Contexto } from "./Operaciones";
import "./reportes/hoja-de-aprobacion/hoja.css";

/**
 * Hoja de aprobación DIGITAL de un grupo (281). La versión interactiva de la hoja impresa: se ven las dos firmas, cada
 * fila abre las fotos de ese reporte, y aquí mismo el gerente y el supervisor firman; con las dos firmas se aprueba el
 * grupo y todas sus mermas pasan a aprobada. Sin las dos firmas, el botón de aprobar no aparece (y la base también lo exige).
 */
export function HojaDeGrupo({ grupoId, ctx, onSalir }: { grupoId: string; ctx: Contexto; onSalir: () => void }) {
  const { t, lang } = usePrefs();
  const [grupo, setGrupo] = useState<GrupoDeMerma | null>(null);
  const [reportes, setReportes] = useState<Reporte[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [firmando, setFirmando] = useState<null | "gerente" | "supervisor">(null);
  const [fotosDe, setFotosDe] = useState<Reporte | null>(null);
  // Click en el folio: abre el reporte en la app para revisarlo (dueño, 10 nov), sin salir de la hoja.
  const [verReporte, setVerReporte] = useState<Reporte | null>(null);

  const recarga = useCallback(async () => {
    if (ctx.demo) { setCargando(false); setError(t("Groups are not available in demo mode.", "Los grupos no están en el modo demo.")); return; }
    try {
      const r = await grupoConReportes(createClient(), grupoId);
      if (!r) { setError(t("This group no longer exists, or migration 281 is not applied yet.", "Este grupo ya no existe, o falta aplicar la migración 281.")); setGrupo(null); }
      else { setGrupo(r.grupo); setReportes(r.reportes); setError(null); }
    } catch (e) { setError((e as Error).message); }
    setCargando(false);
  }, [grupoId, ctx.demo, t]);

  useEffect(() => { void recarga(); }, [recarga]);

  const corre = async (f: () => Promise<void>) => {
    setOcupado(true); setError(null);
    try { await f(); await recarga(); } catch (e) { setError((e as Error).message); }
    setOcupado(false);
  };

  if (cargando) return <p className="hint" data-grupo-cargando>{t("Loading…", "Cargando…")}</p>;
  if (error && !grupo) return (
    <div className="ops-merma">
      <button type="button" className="btn btn-ghost" onClick={onSalir}>← {t("Back to scrap", "Volver a la merma")}</button>
      <p className="ops-aviso ops-aviso-error">{error}</p>
    </div>
  );
  if (!grupo) return null;

  const firmas = grupo.firmas ?? [];
  const aprobado = grupoAprobado(grupo);
  const gestiona = puedeCorregirMerma(ctx.yo, { kind: "scrap", store: grupo.store });
  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "";
  const filas = filasDeHoja(reportes, nombre, (m) => etiquetaDeOpcion("scrap", "reason", m, lang) || (m ?? ""), (r) => repartoDeReporte(r).damaged);

  return (
    <div className="ops-merma" data-hoja-grupo={grupo.id}>
      <div className="hoja-barra no-imprimir">
        <button type="button" className="btn btn-ghost" onClick={onSalir}>← {t("Back to scrap", "Volver a la merma")}</button>
        <span className={`ops-etapa-chip${aprobado ? " ops-grupo-aprobado" : ""}`} data-grupo-estado={aprobado ? "aprobado" : "pendiente"}>{estadoDelGrupo(grupo, lang)}</span>
        <button type="button" className="btn" onClick={() => window.print()} data-accion="imprimir-grupo">🖨 {t("Print", "Imprimir")}</button>
      </div>
      {error && <p className="ops-aviso ops-aviso-error no-imprimir">{error}</p>}

      <article className="hoja-aprobacion">
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

        <table className="hoja-tabla" data-hoja-filas={filas.length}>
          <thead>
            <tr>
              <th>#</th><th aria-label={t("Photos", "Fotos")} className="no-imprimir" />
              <th>{t("Folio", "Folio")}</th>
              <th>{t("Date broken", "Fecha del daño")}</th>
              <th>{t("Product", "Producto")}</th>
              <th className="num">{t("Damaged pcs", "Pzas dañadas")}</th>
              <th className="num">{t("Loss", "Pérdida")}</th>
              <th>{t("Reason", "Motivo")}</th>
              <th>{t("Broken by", "Lo rompió")}</th>
              <th>{t("Reported by", "Lo reportó")}</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, n) => {
              const r = reportes.find((x) => x.id === f.id);
              const conFoto = !!r && r.photos.length > 0;
              return (
                <tr key={f.id} data-hoja-reporte={f.id}>
                  <td>{n + 1}</td>
                  <td className="no-imprimir">
                    {conFoto && (
                      <button type="button" className="ops-icono-fotos" data-ver-fotos={f.id} onClick={() => setFotosDe(r!)}
                        title={t("See photos", "Ver fotos")} aria-label={t(`See ${r!.photos.length} photos`, `Ver ${r!.photos.length} fotos`)}>📷 {r!.photos.length}</button>
                    )}
                  </td>
                  <td className="hoja-folio">{r
                    ? <button type="button" className="ops-folio-link" onClick={() => setVerReporte(r)} data-abrir-reporte={f.id} title={t("Open this report", "Abrir este reporte")}>{f.folio}</button>
                    : f.folio}</td>
                  <td>{fmtDia(f.dia, lang)}</td>
                  <td>{f.producto}</td>
                  <td className="num">{f.danadas}</td>
                  <td className="num">{fmtMoney(f.perdida)}</td>
                  <td>{f.motivo}</td>
                  <td>{f.rompio}</td>
                  <td>{f.reporto}</td>
                </tr>
              );
            })}
            {filas.length === 0 && <tr><td colSpan={10} className="hoja-vacia">{t("No reports in this group.", "No hay reportes en este grupo.")}</td></tr>}
          </tbody>
          {filas.length > 0 && (
            <tfoot><tr><td colSpan={6} className="num">{t("Total", "Total")}</td><td className="num" data-hoja-total>{fmtMoney(totalDeHoja(filas))}</td><td colSpan={3} /></tr></tfoot>
          )}
        </table>
        {filas.some((f) => f.producto.endsWith(" *")) && <p className="hoja-nota">* {t("Product not in the catalog (name as written).", "Producto fuera del catálogo (nombre tal como se escribió).")}</p>}

        {/* Las dos firmas: dibujadas en la app. Si falta y quien mira gestiona, puede firmar aquí mismo. */}
        <section className="hoja-firmas hoja-firmas-digital">
          {SLOTS_DE_FIRMA.map((slot) => {
            const fm = firmaDe(firmas, slot);
            const puede = !aprobado && gestiona && puedeFirmarSlot(firmas, slot, ctx.yo.id);
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
                {fm && !aprobado && gestiona && fm.signer_id === ctx.yo.id && (
                  <button type="button" className="btn btn-ghost btn-sm no-imprimir" disabled={ocupado} data-accion="quitar-firma-grupo" data-slot={slot}
                    onClick={() => void corre(() => quitarFirmaGrupo(createClient(), grupo.id, slot))}>{t("Remove", "Quitar")}</button>
                )}
              </div>
            );
          })}
        </section>

        {firmando && (
          <FirmaPad etiqueta={t(`Draw the ${nombreDeSlot(firmando, lang).toLowerCase()} signature`, `Dibuja la firma del ${nombreDeSlot(firmando, lang).toLowerCase()}`)}
            guardando={ocupado}
            onCancelar={() => setFirmando(null)}
            onFirmar={(png) => void corre(async () => { await firmarGrupo(createClient(), grupo.id, firmando, png); setFirmando(null); })} />
        )}

        {!aprobado && gestiona && (
          <div className="ops-exportar no-imprimir">
            <button type="button" className="btn btn-primary" disabled={ocupado || !puedeAprobarGrupo(grupo)} data-accion="aprobar-grupo"
              onClick={() => void corre(() => aprobarGrupo(createClient(), grupo.id))}>
              ✅ {t("Approve group", "Aprobar grupo")}
            </button>
            {!puedeAprobarGrupo(grupo) && <span className="hint" data-falta-firma>{estadoDelGrupo(grupo, lang)}</span>}
          </div>
        )}
        {aprobado && <p className="hoja-pie" data-grupo-aprobado>{t("Approved — all reports in this group are now Approved.", "Aprobado — todas las mermas de este grupo quedaron Aprobadas.")}{grupo.approved_by ? ` · ${nombre(grupo.approved_by)}` : ""}</p>}
      </article>

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
        <h3>📷 {r.product_name ?? t("Photos", "Fotos")}</h3>
        <p className="sub">{fmtDia(r.broken_on ?? r.created_at.slice(0, 10), lang)} · {r.store}</p>
        <VisorDeFotos fotos={fotos} demo={ctx.demo} />
        <div className="modal-actions"><button type="button" className="btn btn-primary" onClick={onCerrar}>{t("Close", "Cerrar")}</button></div>
      </div>
    </div>
  );
}
