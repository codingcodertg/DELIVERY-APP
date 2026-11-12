"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/utils";
import { ETAPAS, actorDeEtapa, etapaDe, etapaVisible, documentoDeGrupo, nombreDeEtapaVisible, fechaDeEtapa, fechaDeLaEtapaActual, nombreDeEtapa, puedeCambiarEtapa, puedeDeshacerEtapa, siguienteEtapa, siguientePasoDeMerma, type Etapa } from "@/lib/almacen-ops/etapas";
import { aprobarMerma, cambiarEtapa, enlacesDeFotos, listarGrupos, firmarMerma, firmasDeReporte, quitarFirma, subirAdjunto, subirFoto, tipoDeAdjuntoValido, type Reporte } from "@/lib/almacen-ops/datos";
import { SLOTS_DE_FIRMA, firmaDe, firmasFaltantes, mensajePendienteDeFirma, nombreDeSlot, puedeAprobar, puedeFirmarSlot, requiereFirma, tieneAmbasFirmas, type FirmaDeMerma, type SlotDeFirma } from "@/lib/almacen-ops/firmas";
import { detalleParaConsola, leerFotoDelTelefono, mensajeDeFotoFallida } from "@/lib/almacen-ops/foto-del-telefono";
import { FirmaPad } from "./FirmaPad";
import { HojaDeGrupo } from "./HojaDeGrupo";
import { HojaBorrador } from "./HojaBorrador";
import { crearBorradorDeGrupo } from "@/lib/almacen-ops/borradores-de-grupo";
import { slotsQueMeTocan } from "@/lib/almacen-ops/grupos";
import { esGrupoDePractica, grupoDePractica } from "@/lib/practica/grupos-de-practica";
import type { Contexto } from "./Operaciones";

/**
 * D-921 (migración 270): la etapa de una merma en la lista (chip) y en la tarjeta (línea de tiempo + lo que el
 * gerente hace: adjuntar la hoja firmada → Aprobada; marcar Desechada; subir la captura → Ajustada; admin: deshacer).
 */

/** El chip de etapa con la fecha de la etapa actual. Solo lectura; sale también en «Mis reportes». */
export function ChipDeEtapa({ r, conFecha = true }: { r: Reporte; conFecha?: boolean }) {
  const { lang } = usePrefs();
  if (r.kind !== "scrap") return null;
  // «⏳ Pendiente» (Roberto, 11 nov): en un grupo y sin aprobar — etapa derivada entre «Fotografiada» y «Aprobada».
  const e = etapaVisible(r);
  const f = fechaDeLaEtapaActual(r);
  const nombreE = nombreDeEtapaVisible(e, lang);
  return (
    <span className="ops-etapa" data-etapa={e} title={nombreE}>
      <span className="ops-etapa-nombre">{e === "pending" ? "⏳ " : ""}{nombreE}</span>
      {conFecha && f && <span className="ops-etapa-fecha">{fmtDateTime(f)}</span>}
    </span>
  );
}

/** El aviso «Pendiente: firma del …» (280). Sale en la lista y en la tarjeta mientras falte una firma. */
export function AvisoPendienteDeFirma({ r }: { r: Reporte }) {
  const { lang } = usePrefs();
  const m = mensajePendienteDeFirma(r, lang);
  if (!m) return null;
  return <span className="ops-firma-aviso" data-firma-pendiente title={m}>✍ {m}</span>;
}

const mensajeDeError = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));

/**
 * Sube la hoja firmada o la captura: una imagen pasa por el mismo lector que las fotos de merma (D-917: bytes en el
 * acto, JPEG comprimido); un PDF se sube tal cual. Devuelve la ruta en el cubo.
 */
export async function subirPrueba(ctx: Contexto, f: File, que: "hoja" | "ajuste", lang: "en" | "es"): Promise<string> {
  if (ctx.demo) return `demo/${que}.jpg`;
  const sb = createClient();
  if (f.type === "application/pdf") return subirAdjunto(sb, ctx.yo.id, f, f.type, que);
  const leida = await leerFotoDelTelefono(f);
  if (!leida.ok) {
    console.error(detalleParaConsola(leida, f, navigator.userAgent, "galeria"));
    throw new Error(mensajeDeFotoFallida(leida.motivo, lang));
  }
  return subirFoto(sb, ctx.yo.id, leida.jpg);
}

/**
 * Aplica una etapa (con su adjunto) a varios reportes y devuelve cómo quedan. En el demo no toca la base. Si uno falla
 * a mitad, los que ya cambiaron se devuelven igual (`hechos`) y el error dice cuál falló: nada se queda a medias en la pantalla.
 */
export async function aplicarEtapa(ctx: Contexto, reportes: readonly Reporte[], etapa: Etapa, prueba: string | null): Promise<Reporte[]> {
  const sb = ctx.demo ? null : createClient();
  const ahora = new Date().toISOString();
  const hechos: Reporte[] = [];
  for (const r of reportes) {
    try {
      if (sb) await cambiarEtapa(sb, r.id, etapa, prueba);
    } catch (e) {
      throw new ErrorParcial(hechos, `${reportes.length > 1 ? `${hechos.length}/${reportes.length} · ` : ""}${mensajeDeError(e)}`);
    }
    hechos.push(conEtapa(r, etapa, prueba, ahora, ctx.yo.id));
  }
  return hechos;
}

/** Un fallo a mitad de una selección: lleva los reportes que SÍ cambiaron. */
export class ErrorParcial extends Error {
  constructor(public hechos: Reporte[], mensaje: string) { super(mensaje); }
}

/** Cómo queda la fila después de la transición (lo mismo que escribe la base, para no releer). */
export function conEtapa(r: Reporte, etapa: Etapa, prueba: string | null, ahora: string, yo: string): Reporte {
  const n: Reporte = { ...r, stage: etapa };
  const actual = etapaDe(r);
  if (ETAPAS.indexOf(etapa) < ETAPAS.indexOf(actual)) {
    // Deshacer un paso: se borra lo de la etapa que se deshace.
    if (actual === "adjusted") Object.assign(n, { adjusted_at: null, adjusted_by: null, adjustment_proof: null });
    if (actual === "dumped") Object.assign(n, { dumped_at: null, dumped_by: null });
    // 296: deshacer la aprobación saca la merma de su grupo (lo mismo que hace la base).
    if (actual === "approved") Object.assign(n, { approved_at: null, approved_by: null, approval_sheet: null, scrap_group_id: null });
    return n;
  }
  if (etapa === "approved") Object.assign(n, { approved_at: ahora, approved_by: yo, approval_sheet: prueba });
  if (etapa === "dumped") Object.assign(n, { dumped_at: ahora, dumped_by: yo });
  if (etapa === "adjusted") Object.assign(n, { adjusted_at: ahora, adjusted_by: yo, adjustment_proof: prueba });
  return n;
}

/**
 * Elegir el fichero (imagen o PDF) y aplicarle la etapa a los reportes dados. Lo usan la tarjeta (un reporte) y la
 * lista (la selección entera con la misma hoja firmada).
 */
export function AdjuntarYMarcar({ reportes, ctx, etapa, etiqueta, onListo, onCancelar, onParcial }: {
  reportes: readonly Reporte[]; ctx: Contexto; etapa: "approved" | "adjusted"; etiqueta: string;
  onListo: (nuevos: Reporte[]) => void; onCancelar?: () => void;
  /** En la selección: los que sí cambiaron antes de que uno fallara. */
  onParcial?: (hechos: Reporte[]) => void;
}) {
  const { t, lang } = usePrefs();
  const entrada = useRef<HTMLInputElement>(null);
  const [fichero, setFichero] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const que = etapa === "approved" ? "hoja" : "ajuste";
  useEffect(() => {
    if (!fichero || fichero.type === "application/pdf") { setVista(null); return; }
    const u = URL.createObjectURL(fichero);
    setVista(u);
    return () => URL.revokeObjectURL(u);
  }, [fichero]);
  const elige = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!tipoDeAdjuntoValido(f.type) && !f.type.startsWith("image/")) { setError(t("Only a photo or a PDF.", "Solo una foto o un PDF.")); return; }
    setFichero(f);
  };
  const guarda = async () => {
    if (!fichero) return;
    setGuardando(true); setError(null);
    try {
      const ruta = await subirPrueba(ctx, fichero, que, lang);
      onListo(await aplicarEtapa(ctx, reportes, etapa, ruta));
    } catch (e) {
      setError(mensajeDeError(e));
      if (e instanceof ErrorParcial && e.hechos.length > 0) onParcial?.(e.hechos);
    } finally { setGuardando(false); }
  };
  return (
    <div className="ops-corregir ops-adjuntar" data-adjuntar={etapa}>
      <p className="hint">{etapa === "approved"
        ? t(`Attach the signed approval sheet (photo or PDF). ${reportes.length === 1 ? "This report" : `These ${reportes.length} reports`} will turn Approved.`,
          `Adjunta la hoja de aprobación firmada (foto o PDF). ${reportes.length === 1 ? "Este reporte" : `Estos ${reportes.length} reportes`} pasa${reportes.length === 1 ? "" : "n"} a Aprobada.`)
        : t("Upload the screenshot showing it was registered in the inventory system. The report will turn Adjusted.",
          "Sube la captura de pantalla de que quedó registrado en el sistema de inventario. El reporte pasa a Ajustada.")}</p>
      {vista && (
        // eslint-disable-next-line @next/next/no-img-element
        <div className="ops-fotos-lista"><figure><img src={vista} alt={etiqueta} /></figure></div>
      )}
      {fichero && !vista && <p className="hint" data-adjunto-pdf>📄 {fichero.name}</p>}
      <button type="button" className="ops-opcion ops-camara" onClick={() => entrada.current?.click()} disabled={guardando} data-accion={`elegir-${que}`}>
        📎 {fichero ? t("Choose another file", "Elegir otro fichero") : etiqueta}
      </button>
      <input ref={entrada} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { elige(e.target.files?.[0]); e.target.value = ""; }} data-entrada={que} />
      {error && <p className="ops-aviso ops-aviso-error" role="alert" data-aviso="adjunto-fallido">{error}</p>}
      <div className="modal-actions">
        {onCancelar && <button type="button" className="btn" onClick={onCancelar} disabled={guardando}>{t("Cancel", "Cancelar")}</button>}
        <button type="button" className="btn btn-primary" onClick={() => void guarda()} disabled={!fichero || guardando} data-accion={`marcar-${etapa}`}>
          {guardando ? t("Saving…", "Guardando…") : etapa === "approved" ? t("Attach and approve", "Adjuntar y aprobar") : t("Upload and mark Adjusted", "Subir y marcar Ajustada")}
        </button>
      </div>
    </div>
  );
}

/** La línea de tiempo de la tarjeta: cada etapa con su fecha, quién, y la miniatura de la hoja / la captura. */
export function LineaDeEtapas({ r, ctx, onCambio }: { r: Reporte; ctx: Contexto; onCambio: (n: Reporte) => void }) {
  const { t, lang } = usePrefs();
  const [accion, setAccion] = useState<"adjusted" | null>(null);
  const [desechando, setDesechando] = useState(false);
  // Reunión 11 nov, 11 PM: «Marcar como Desechada» de un toque, sin la segunda confirmación (el admin puede deshacer).
  const desechar = async () => {
    setDesechando(true); setError(null);
    try { onCambio((await aplicarEtapa(ctx, [r], "dumped", null))[0]); } catch (e) { setError(mensajeDeError(e)); } finally { setDesechando(false); }
  };
  const [error, setError] = useState<string | null>(null);
  const [enlaces, setEnlaces] = useState<Record<string, string>>({});
  const [firmas, setFirmas] = useState<FirmaDeMerma[]>(r.firmas ?? []);
  const nombre = (id: string | null) => (id ? ctx.personas.find((p) => p.id === id)?.full_name ?? "—" : "");
  const actual = etapaDe(r);
  const gestiona = puedeCambiarEtapa(ctx.yo, r);
  const deshace = puedeDeshacerEtapa(ctx.yo, r);
  const siguiente = gestiona ? siguienteEtapa(r) : null;
  const conFirmas = { ...r, firmas };
  // Las firmas CON el dibujo (la lista las trae sin imagen): se traen al abrir la tarjeta de una merma que se firma.
  useEffect(() => {
    if (ctx.demo || r.kind !== "scrap") return;
    let vivo = true;
    void firmasDeReporte(createClient(), r.id).then((f) => { if (vivo) setFirmas(f); }).catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id, ctx.demo]);
  const adjuntos = [r.approval_sheet, r.adjustment_proof].filter((x): x is string => !!x);
  const [hojaDeGrupo, setHojaDeGrupo] = useState<string | null>(null);
  // Siguiente paso (dueño, 11 nov) y lo que necesita: el borrador de grupo con esta sola merma y, si está en un grupo
  // pendiente, si me falta firmar alguna línea que me toca.
  const paso = siguientePasoDeMerma(ctx.yo, r);
  const [borrador, setBorrador] = useState<string | null>(null);
  const iniciarAprobacionAqui = () => setBorrador(crearBorradorDeGrupo(ctx.yo.id, fmtDateTime(new Date().toISOString()), [r]));
  const [faltaMiFirma, setFaltaMiFirma] = useState(false);
  useEffect(() => {
    if (paso !== "abrir-grupo" || !r.scrap_group_id || ctx.demo) { setFaltaMiFirma(false); return; }
    const mios = slotsQueMeTocan(ctx.yo);
    if (mios.length === 0) { setFaltaMiFirma(false); return; }
    let vivo = true;
    const grupo = esGrupoDePractica(r.scrap_group_id) ? grupoDePractica(r.scrap_group_id)?.grupo ?? null : null;
    const decide = (firmas: readonly FirmaDeMerma[] | null | undefined) => { if (vivo) setFaltaMiFirma(firmasFaltantes(firmas).some((s) => mios.includes(s))); };
    if (grupo) decide(grupo.firmas);
    else void listarGrupos(createClient()).then((gs) => decide(gs.find((g) => g.id === r.scrap_group_id)?.firmas)).catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, r.scrap_group_id, ctx.demo, hojaDeGrupo]);
  useEffect(() => {
    if (ctx.demo || adjuntos.length === 0) return;
    let vivo = true;
    void enlacesDeFotos(createClient(), adjuntos).then((u) => { if (vivo) setEnlaces(Object.fromEntries(adjuntos.map((a, n) => [a, u[n]]))); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.approval_sheet, r.adjustment_proof, ctx.demo]);
  const deshacer = async () => {
    const previa = ETAPAS[ETAPAS.indexOf(actual) - 1];
    if (!previa) return;
    setError(null);
    try { onCambio((await aplicarEtapa(ctx, [r], previa, null))[0]); } catch (e) { setError(mensajeDeError(e)); }
  };
  const Adjunto = ({ ruta, alt }: { ruta: string | null | undefined; alt: string }) => {
    if (!ruta) return null;
    const u = enlaces[ruta];
    if (ctx.demo || !u) return <span className="hint" data-adjunto={ruta}>📎 {t("attached", "adjunto")}</span>;
    const pdf = /\.pdf$/i.test(ruta);
    return pdf
      ? <a className="ops-adjunto-pdf" href={u} target="_blank" rel="noreferrer" data-adjunto={ruta}>📄 PDF</a>
      // eslint-disable-next-line @next/next/no-img-element
      : <a className="ops-adjunto-mini" href={u} target="_blank" rel="noreferrer" data-adjunto={ruta}><img src={u} alt={alt} /></a>;
  };
  return (
    <section className="ops-etapas" data-etapas={actual}>
      <h4>{t("Stage", "Etapa")} · <ChipDeEtapa r={r} conFecha={false} /> <AvisoPendienteDeFirma r={conFirmas} /></h4>
      <ol className="ops-linea-de-etapas">
        {ETAPAS.map((e) => {
          const f = fechaDeEtapa(r, e);
          const quien = nombre(actorDeEtapa(r, e));
          const hecha = ETAPAS.indexOf(e) <= ETAPAS.indexOf(actual) && (f != null || e === "documented");
          // «⏳ Pendiente de aprobación» (dueño, 11 nov): SIEMPRE entre «Fotografiada» y «Aprobada». Por llegar si aún no
          // está en un grupo; el paso actual (con el grupo a la mano, en tarjeta) si está en uno pendiente; hecho si ya se aprobó.
          const enGrupoPendiente = documentoDeGrupo(r) === "grupo";
          const pendienteHecho = ["approved", "dumped", "adjusted"].includes(actual);
          const pasoPendiente = e === "approved" ? (
            <li key="pending" data-etapa="pending" data-hecha={pendienteHecho || enGrupoPendiente ? "si" : "no"}
              className={pendienteHecho || enGrupoPendiente ? "hecha" : ""} data-paso-actual={enGrupoPendiente ? "si" : undefined}>
              <span className="ops-etapa-punto" aria-hidden />
              <span className="ops-etapa-texto">
                <strong>⏳ {t("Pending approval", "Pendiente de aprobación")}</strong>
                {enGrupoPendiente && <>
                  <span className="ops-etapa-cuando">{t("In an approval group", "En un grupo de aprobación")}</span>
                  <button type="button" className="ops-icono-fotos" onClick={() => setHojaDeGrupo(r.scrap_group_id!)} data-ver-grupo={r.scrap_group_id}
                    title={t("Open the group", "Abrir el grupo")}>🗂 {t("Group", "Grupo")}</button>
                </>}
                {!enGrupoPendiente && !pendienteHecho && <span className="ops-etapa-cuando hint">{t("pending", "pendiente")}</span>}
              </span>
            </li>
          ) : null;
          return (<Fragment key={e}>{pasoPendiente}
            <li key={e} data-etapa={e} data-hecha={hecha ? "si" : "no"} className={hecha ? "hecha" : ""}>
              <span className="ops-etapa-punto" aria-hidden />
              <span className="ops-etapa-texto">
                <strong>{nombreDeEtapa(e, lang)}</strong>
                {hecha && f && <span className="ops-etapa-cuando">{fmtDateTime(f)}{quien && ` · ${quien}`}</span>}
                {!hecha && <span className="ops-etapa-cuando hint">{t("pending", "pendiente")}</span>}
                {e === "approved" && <Adjunto ruta={r.approval_sheet} alt={t("Signed approval sheet", "Hoja de aprobación firmada")} />}
                {/* Dueño, 10 nov: si la merma es de un grupo, su documento es la hoja firmada del GRUPO (con todos sus
                    renglones). El ícono la abre en tarjeta, sin salir del reporte. */}
                {e === "approved" && documentoDeGrupo(r) === "hoja-firmada" && (
                  <button type="button" className="ops-icono-fotos" onClick={() => setHojaDeGrupo(r.scrap_group_id!)} data-ver-hoja-grupo={r.scrap_group_id}
                    title={t("See the signed group sheet", "Ver la hoja firmada del grupo")}>📄 {t("Signed sheet", "Hoja firmada")}</button>
                )}
                {e === "adjusted" && <Adjunto ruta={r.adjustment_proof} alt={t("System screenshot", "Captura del sistema")} />}
              </span>
            </li>
          </Fragment>);
        })}
      </ol>
      {hojaDeGrupo && (
        <div className="overlay" onClick={() => setHojaDeGrupo(null)}>
          <div className="modal ops-tarjeta-grupo" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" data-hoja-del-reporte={hojaDeGrupo}>
            <HojaDeGrupo grupoId={hojaDeGrupo} ctx={ctx} onSalir={() => setHojaDeGrupo(null)} />
          </div>
        </div>
      )}
      {gestiona && !accion && (
        <div className="ops-etapa-acciones">
          {siguiente === "dumped" && <button type="button" className="btn btn-primary" disabled={desechando} onClick={() => void desechar()} data-accion="marcar-desechada">🗑 {desechando ? t("Saving…", "Guardando…") : t("Mark as Dumped", "Marcar como Desechada")}</button>}
          {siguiente === "adjusted" && <button type="button" className="btn btn-primary" onClick={() => setAccion("adjusted")} data-accion="subir-captura">🧾 {t("Mark as Adjusted", "Marcar como Ajustada")}</button>}
          {deshace && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void deshacer()} data-accion="deshacer-etapa">↩ {t("Undo last stage", "Deshacer la última etapa")}</button>}
          {actual === "documented" && <p className="hint">{t("Add the photo first; then it can go to approval.", "Primero la foto; después puede ir a aprobación.")}</p>}
        </div>
      )}
      {/* Dueño, 11 nov: «abrir la orden y continuar los pasos». El siguiente paso, ahí mismo y para quien puede darlo
          (la merma se aprueba SOLO en un grupo: aquí se inicia el borrador del grupo o se abre el grupo para firmar). */}
      {!accion && paso === "iniciar-aprobacion" && (
        <div className="ops-etapa-acciones">
          <button type="button" className="btn btn-primary" onClick={iniciarAprobacionAqui} data-accion="iniciar-aprobacion-tarjeta">✅ {t("Start approval", "Iniciar aprobación")}</button>
        </div>
      )}
      {!accion && paso === "abrir-grupo" && (
        <div className="ops-etapa-acciones">
          <button type="button" className="btn btn-primary" onClick={() => setHojaDeGrupo(r.scrap_group_id!)} data-accion="abrir-grupo-para-firmar">
            🗂 {slotsQueMeTocan(ctx.yo).length > 0 ? t("Open group to sign", "Abrir grupo para firmar") : t("Open group", "Abrir grupo")}
          </button>
          {faltaMiFirma && <span className="ops-falta-mi-firma" data-falta-mi-firma>✍ {t("Your signature is missing", "Falta tu firma")}</span>}
        </div>
      )}
      {!accion && paso === "foto" && <p className="hint" data-paso-foto>📷 {t("Next step: add the photo of the pieces (the photo buttons are right above).", "Siguiente paso: agregar la foto de las piezas (los botones de foto están justo arriba).")}</p>}
      {!accion && paso === "lo-sigue-el-gerente" && <p className="hint" data-lo-sigue-el-gerente>{t("The manager takes it from here.", "Lo sigue el gerente.")}</p>}
      {borrador && (
        <div className="overlay" onClick={() => setBorrador(null)}>
          <div className="modal ops-tarjeta-grupo" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" data-borrador-desde-tarjeta={borrador}>
            <HojaBorrador borradorId={borrador} ctx={ctx} reportesDisponibles={[r]}
              onSalir={() => setBorrador(null)}
              onGuardado={(id) => { setBorrador(null); onCambio({ ...r, scrap_group_id: id }); setHojaDeGrupo(id); }} />
          </div>
        </div>
      )}
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      {accion === "adjusted" && <AdjuntarYMarcar reportes={[r]} ctx={ctx} etapa="adjusted" etiqueta={t("Choose the system screenshot", "Elegir la captura del sistema")}
        onListo={(n) => { setAccion(null); onCambio(n[0]); }} onCancelar={() => setAccion(null)} />}
    </section>
  );
}
