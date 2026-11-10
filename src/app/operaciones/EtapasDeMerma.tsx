"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/utils";
import { ETAPAS, actorDeEtapa, etapaDe, fechaDeEtapa, fechaDeLaEtapaActual, nombreDeEtapa, puedeCambiarEtapa, puedeDeshacerEtapa, siguienteEtapa, type Etapa } from "@/lib/almacen-ops/etapas";
import { aprobarMerma, cambiarEtapa, enlacesDeFotos, firmarMerma, firmasDeReporte, quitarFirma, subirAdjunto, subirFoto, tipoDeAdjuntoValido, type Reporte } from "@/lib/almacen-ops/datos";
import { SLOTS_DE_FIRMA, firmaDe, mensajePendienteDeFirma, nombreDeSlot, puedeAprobar, puedeFirmarSlot, requiereFirma, type FirmaDeMerma, type SlotDeFirma } from "@/lib/almacen-ops/firmas";
import { detalleParaConsola, leerFotoDelTelefono, mensajeDeFotoFallida } from "@/lib/almacen-ops/foto-del-telefono";
import { FirmaPad } from "./FirmaPad";
import type { Contexto } from "./Operaciones";

/**
 * D-921 (migración 270): la etapa de una merma en la lista (chip) y en la tarjeta (línea de tiempo + lo que el
 * gerente hace: adjuntar la hoja firmada → Aprobada; marcar Desechada; subir la captura → Ajustada; admin: deshacer).
 */

/** El chip de etapa con la fecha de la etapa actual. Solo lectura; sale también en «Mis reportes». */
export function ChipDeEtapa({ r, conFecha = true }: { r: Reporte; conFecha?: boolean }) {
  const { lang } = usePrefs();
  if (r.kind !== "scrap") return null;
  const e = etapaDe(r);
  const f = fechaDeLaEtapaActual(r);
  return (
    <span className="ops-etapa" data-etapa={e} title={nombreDeEtapa(e, lang)}>
      <span className="ops-etapa-nombre">{nombreDeEtapa(e, lang)}</span>
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
 * El panel de las dos firmas (gerente + supervisor) de una merma fotografiada. Cada espacio: la firma (dibujo + nombre
 * + fecha) o un botón para firmar (si quien mira gestiona y puede firmar ese espacio). Cuando están las dos, aparece
 * «Aprobar». La base vuelve a exigir las dos firmas distintas.
 */
function PanelDeFirmas({ r, ctx, firmas, onFirmas, onAprobado }: {
  r: Reporte; ctx: Contexto; firmas: FirmaDeMerma[];
  onFirmas: (f: FirmaDeMerma[]) => void; onAprobado: (n: Reporte) => void;
}) {
  const { t, lang } = usePrefs();
  const [firmando, setFirmando] = useState<SlotDeFirma | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gestiona = puedeCambiarEtapa(ctx.yo, r);
  const conFirmas = { ...r, firmas };

  const firma = async (slot: SlotDeFirma, png: string) => {
    setGuardando(true); setError(null);
    try {
      if (!ctx.demo) await firmarMerma(createClient(), r.id, slot, png);
      const otras = firmas.filter((f) => f.slot !== slot);
      onFirmas([...otras, { slot, signer_id: ctx.yo.id, signer_name: ctx.yo.full_name, signed_at: new Date().toISOString(), signature_png: png }]);
      setFirmando(null);
    } catch (e) { setError(mensajeDeError(e)); } finally { setGuardando(false); }
  };
  const quita = async (slot: SlotDeFirma) => {
    setGuardando(true); setError(null);
    try {
      if (!ctx.demo) await quitarFirma(createClient(), r.id, slot);
      onFirmas(firmas.filter((f) => f.slot !== slot));
    } catch (e) { setError(mensajeDeError(e)); } finally { setGuardando(false); }
  };
  const aprueba = async () => {
    setGuardando(true); setError(null);
    try {
      if (!ctx.demo) await aprobarMerma(createClient(), r.id);
      onAprobado(conEtapa(r, "approved", null, new Date().toISOString(), ctx.yo.id));
    } catch (e) { setError(mensajeDeError(e)); } finally { setGuardando(false); }
  };

  const nombre = (id: string | null) => (id ? ctx.personas.find((p) => p.id === id)?.full_name ?? "—" : "—");

  return (
    <section className="ops-corregir" data-firmas-panel>
      <p className="hint">{t("Two signatures are required to approve: the manager and the warehouse supervisor (two different people). It can't be approved until both have signed.",
        "Para aprobar hacen falta las dos firmas: el gerente y el supervisor de almacén (dos personas distintas). No se puede aprobar hasta que las dos estén.")}</p>
      {firmando && (
        <FirmaPad etiqueta={t(`Sign as ${nombreDeSlot(firmando, lang)}`, `Firmar como ${nombreDeSlot(firmando, lang)}`)}
          guardando={guardando} onCancelar={() => setFirmando(null)} onFirmar={(png) => void firma(firmando, png)} />
      )}
      {!firmando && (
        <div className="ops-firmas">
          {SLOTS_DE_FIRMA.map((slot) => {
            const f = firmaDe(firmas, slot);
            return (
              <div key={slot} className={"ops-firma" + (f ? "" : " ops-firma-vacia")} data-firma-slot={slot}>
                <span className="ops-firma-slot">{nombreDeSlot(slot, lang)}</span>
                {f ? (
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {f.signature_png ? <img src={f.signature_png} alt={nombreDeSlot(slot, lang)} /> : <span className="hint">✍ {t("signed", "firmada")}</span>}
                    <figcaption>{f.signer_name ?? nombre(f.signer_id)}{f.signed_at ? ` · ${fmtDateTime(f.signed_at)}` : ""}</figcaption>
                    {gestiona && (f.signer_id === ctx.yo.id) && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={guardando} onClick={() => void quita(slot)} data-accion={`quitar-firma-${slot}`}>↩ {t("Remove my signature", "Quitar mi firma")}</button>
                    )}
                  </figure>
                ) : gestiona && puedeFirmarSlot(firmas, slot, ctx.yo.id) ? (
                  <button type="button" className="btn btn-primary btn-sm" disabled={guardando} onClick={() => { setError(null); setFirmando(slot); }} data-accion={`firmar-${slot}`}>✍ {t("Sign", "Firmar")}</button>
                ) : (
                  <span className="hint">{t("awaiting signature", "falta firma")}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      {!firmando && gestiona && (
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" disabled={guardando || !puedeAprobar(conFirmas)} onClick={() => void aprueba()} data-accion="aprobar-merma">
            {guardando ? t("Saving…", "Guardando…") : t("Approve", "Aprobar")}
          </button>
        </div>
      )}
    </section>
  );
}

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
    if (actual === "approved") Object.assign(n, { approved_at: null, approved_by: null, approval_sheet: null });
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

/** Confirmación en la propia tarjeta (nunca `confirm()`): «¿Ya se tiró a la basura?». */
function ConfirmarDesechada({ r, ctx, onListo, onCancelar }: { r: Reporte; ctx: Contexto; onListo: (n: Reporte) => void; onCancelar: () => void }) {
  const { t } = usePrefs();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const marca = async () => {
    setGuardando(true); setError(null);
    try { onListo((await aplicarEtapa(ctx, [r], "dumped", null))[0]); } catch (e) { setError(mensajeDeError(e)); } finally { setGuardando(false); }
  };
  return (
    <div className="ops-corregir ops-confirmar" role="alertdialog" data-confirmar="dumped">
      <p>{t("Mark as Dumped: the approved material was thrown in the trash. The date and your name are recorded.", "Marcar como Desechada: el material aprobado ya se tiró a la basura. Quedan la fecha y tu nombre.")}</p>
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancelar} disabled={guardando}>{t("Not yet", "Todavía no")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void marca()} disabled={guardando} data-accion="confirmar-dumped">{guardando ? t("Saving…", "Guardando…") : t("Yes, it was dumped", "Sí, ya se tiró")}</button>
      </div>
    </div>
  );
}

/** La línea de tiempo de la tarjeta: cada etapa con su fecha, quién, y la miniatura de la hoja / la captura. */
export function LineaDeEtapas({ r, ctx, onCambio }: { r: Reporte; ctx: Contexto; onCambio: (n: Reporte) => void }) {
  const { t, lang } = usePrefs();
  const [accion, setAccion] = useState<"dumped" | "adjusted" | null>(null);
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
          return (
            <li key={e} data-etapa={e} data-hecha={hecha ? "si" : "no"} className={hecha ? "hecha" : ""}>
              <span className="ops-etapa-punto" aria-hidden />
              <span className="ops-etapa-texto">
                <strong>{nombreDeEtapa(e, lang)}</strong>
                {hecha && f && <span className="ops-etapa-cuando">{fmtDateTime(f)}{quien && ` · ${quien}`}</span>}
                {!hecha && <span className="ops-etapa-cuando hint">{t("pending", "pendiente")}</span>}
                {e === "approved" && <Adjunto ruta={r.approval_sheet} alt={t("Signed approval sheet", "Hoja de aprobación firmada")} />}
                {e === "adjusted" && <Adjunto ruta={r.adjustment_proof} alt={t("System screenshot", "Captura del sistema")} />}
              </span>
            </li>
          );
        })}
      </ol>
      {gestiona && !accion && (
        <div className="ops-etapa-acciones">
          {siguiente === "dumped" && <button type="button" className="btn btn-primary" onClick={() => setAccion("dumped")} data-accion="marcar-desechada">🗑 {t("Mark as Dumped", "Marcar como Desechada")}</button>}
          {siguiente === "adjusted" && <button type="button" className="btn btn-primary" onClick={() => setAccion("adjusted")} data-accion="subir-captura">🧾 {t("Mark as Adjusted", "Marcar como Ajustada")}</button>}
          {deshace && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void deshacer()} data-accion="deshacer-etapa">↩ {t("Undo last stage", "Deshacer la última etapa")}</button>}
          {actual === "documented" && <p className="hint">{t("Add the photo first; then it can go to approval.", "Primero la foto; después puede ir a aprobación.")}</p>}
        </div>
      )}
      {/* La aprobación es por firma (280): fotografiada → firman gerente y supervisor → Aprobar. */}
      {actual === "photographed" && !accion && (requiereFirma(conFirmas) || gestiona || firmas.length > 0) && (
        <PanelDeFirmas r={r} ctx={ctx} firmas={firmas} onFirmas={setFirmas} onAprobado={(n) => onCambio(n)} />
      )}
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      {accion === "dumped" && <ConfirmarDesechada r={r} ctx={ctx} onListo={(n) => { setAccion(null); onCambio(n); }} onCancelar={() => setAccion(null)} />}
      {accion === "adjusted" && <AdjuntarYMarcar reportes={[r]} ctx={ctx} etapa="adjusted" etiqueta={t("Choose the system screenshot", "Elegir la captura del sistema")}
        onListo={(n) => { setAccion(null); onCambio(n[0]); }} onCancelar={() => setAccion(null)} />}
    </section>
  );
}
