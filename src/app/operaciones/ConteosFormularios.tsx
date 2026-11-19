"use client";

import { mensajeDeError } from "@/lib/mensaje-de-error";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { BotonesDeFoto } from "./BotonesDeFoto";
import { detalleParaConsola, leerFotoDelTelefono, mensajeDeFotoFallida } from "@/lib/almacen-ops/foto-del-telefono";
import { enlacesDeFotos, subirAdjunto, subirFoto, tipoDeAdjuntoValido } from "@/lib/almacen-ops/datos";
import { capturaPorCajas, motivoDeCaptura, numeroDelCampo, validarCaptura, type Linea, type OrdenPendiente } from "@/lib/almacen-ops/conteos";
import { registrarLinea } from "@/lib/almacen-ops/conteos-datos";
import type { Contexto } from "./Operaciones";
import { CerrarX } from "./CerrarX";

/**
 * Las ventanas y formularios del conteo. REGLA (dueño, 2026-11-19: «Rosie… it would exit her out… she drags it. So let's
 * just do Close whenever»): ninguna ventana se cierra al arrastrar, al deslizar ni al tocar fuera. Solo la ✕ de arriba
 * y el botón «Cerrar» / «Cancelar» de abajo (siempre a la vista: la ventana tiene alto máximo y se desplaza por dentro).
 */

/** La ventana de un conteo: sin cierre por fondo ni por gesto. */
export function VentanaDeConteo({ dato, children }: { dato: string; children: ReactNode }) {
  return (
    <div className="overlay" data-ventana-conteo={dato}>
      <div className="modal ops-tarjeta-reporte ops-conteo-modal" role="dialog" aria-modal="true" data-dialogo={dato}>
        {children}
      </div>
    </div>
  );
}

/** Una nota corta en la propia tarjeta (nunca `prompt()`), con su botón. */
export function FormNota({ titulo, texto, boton, obligatoria, ocupado, onCancelar, onListo }: { titulo: string; texto: string; boton: string; obligatoria?: boolean; ocupado: boolean; onCancelar: () => void; onListo: (nota: string) => void }) {
  const { t } = usePrefs();
  const [n, setN] = useState("");
  return (
    <div className="ops-corregir ops-confirmar" role="alertdialog" data-nota={titulo}>
      <p>{titulo}</p>
      <textarea className="ops-campo" rows={2} value={n} onChange={(e) => setN(e.target.value)} placeholder={texto} data-campo="nota" autoFocus />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancelar} disabled={ocupado}>{t("Back", "Volver")}</button>
        <button type="button" className="btn btn-primary" onClick={() => onListo(n.trim())} disabled={ocupado || (!!obligatoria && n.trim().length < 2)} data-accion="nota-lista">{ocupado ? t("Saving…", "Guardando…") : boton}</button>
      </div>
    </div>
  );
}

/** Un adjunto (captura, hoja firmada): miniatura o PDF con su enlace; en demo, solo la marca. */
export function AdjuntoDeConteo({ ruta, alt, enlaces, demo }: { ruta: string | null; alt: string; enlaces: Record<string, string>; demo: boolean }) {
  const { t } = usePrefs();
  if (!ruta) return null;
  const u = enlaces[ruta];
  if (demo || !u) return <span className="hint" data-adjunto={ruta}>📎 {t("attached", "adjunto")}</span>;
  return /\.pdf$/i.test(ruta)
    ? <a className="ops-adjunto-pdf" href={u} target="_blank" rel="noreferrer" data-adjunto={ruta}>📄 PDF</a>
    // eslint-disable-next-line @next/next/no-img-element
    : <a className="ops-adjunto-mini" href={u} target="_blank" rel="noreferrer" data-adjunto={ruta}><img src={u} alt={alt} loading="lazy" decoding="async" /></a>;
}

/** Los enlaces firmados de los adjuntos de una lista (una vez por cambio de la lista). */
export function useEnlaces(adjuntos: readonly string[], demo: boolean): Record<string, string> {
  const [enlaces, setEnlaces] = useState<Record<string, string>>({});
  const clave = adjuntos.join("|");
  useEffect(() => {
    if (demo || adjuntos.length === 0) return;
    let vivo = true;
    void enlacesDeFotos(createClient(), [...adjuntos]).then((u) => { if (vivo) setEnlaces(Object.fromEntries(adjuntos.map((a, n) => [a, u[n]]))); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, demo]);
  return enlaces;
}

/** Adjuntar la hoja firmada (una, opcional) o las capturas del ERP (varias): imagen por el lector del teléfono, PDF tal cual. */
export function FormAdjuntar({ ctx, titulo, texto, boton, opcional, multiple, que, ocupado, onCancelar, onListo }: {
  ctx: Contexto; titulo: string; texto: string; boton: string; opcional: boolean; multiple: boolean; que: "hoja" | "ajuste"; ocupado: boolean; onCancelar: () => void; onListo: (rutas: string[]) => void;
}) {
  const { t, lang } = usePrefs();
  const entrada = useRef<HTMLInputElement>(null);
  const [ficheros, setFicheros] = useState<File[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elige = (fs: FileList | null) => {
    setError(null);
    const lista = Array.from(fs ?? []).filter((f) => tipoDeAdjuntoValido(f.type) || f.type.startsWith("image/"));
    if (lista.length === 0) { if (fs && fs.length > 0) setError(t("Only a photo or a PDF.", "Solo una foto o un PDF.")); return; }
    setFicheros((x) => (multiple ? [...x, ...lista] : lista.slice(0, 1)));
  };
  const subir = async () => {
    setSubiendo(true); setError(null);
    try {
      const rutas: string[] = [];
      for (const f of ficheros) {
        if (ctx.demo) { rutas.push(`demo/${que}-${rutas.length + 1}.jpg`); continue; }
        const sb = createClient();
        if (f.type === "application/pdf") { rutas.push(await subirAdjunto(sb, ctx.yo.id, f, f.type, que)); continue; }
        const leida = await leerFotoDelTelefono(f);
        if (!leida.ok) { console.error(detalleParaConsola(leida, f, navigator.userAgent, "galeria")); throw new Error(mensajeDeFotoFallida(leida.motivo, lang)); }
        rutas.push(await subirFoto(sb, ctx.yo.id, leida.jpg));
      }
      onListo(rutas);
    } catch (e) { setError(mensajeDeError(e)); } finally { setSubiendo(false); }
  };
  return (
    <div className="ops-corregir ops-adjuntar" data-adjuntar={que}>
      <p><strong>{titulo}</strong></p>
      <p className="hint">{texto}</p>
      {ficheros.length > 0 && <ul className="ops-fotos-lista">{ficheros.map((f, n) => <li key={n} className="ops-insignia">📎 {f.name} <button type="button" className="btn btn-sm" onClick={() => setFicheros((x) => x.filter((_, i) => i !== n))} data-accion="quitar-adjunto">✕</button></li>)}</ul>}
      <button type="button" className="ops-opcion ops-camara" onClick={() => entrada.current?.click()} disabled={subiendo || ocupado} data-accion={`elegir-${que}`}>
        📎 {ficheros.length > 0 && !multiple ? t("Choose another file", "Elegir otro fichero") : multiple && ficheros.length > 0 ? t("Add another", "Agregar otra") : t("Choose photo or PDF", "Elegir foto o PDF")}
      </button>
      <input ref={entrada} type="file" accept="image/*,application/pdf" multiple={multiple} hidden onChange={(e) => { elige(e.target.files); e.target.value = ""; }} data-entrada={que} />
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancelar} disabled={subiendo || ocupado}>{t("Back", "Volver")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void subir()} disabled={subiendo || ocupado || (!opcional && ficheros.length === 0)} data-accion={`listo-${que}`}>{subiendo || ocupado ? t("Saving…", "Guardando…") : boton}</button>
      </div>
    </div>
  );
}

/** Los campos de una cantidad: cajas + sueltas (si el producto tiene piezas por caja) o el total. Teclado numérico. */
export function CamposDeCantidad({ pz, cajas, sueltas, total, onCajas, onSueltas, onTotal, dato }: {
  pz: number | null; cajas: string; sueltas: string; total: string; onCajas: (s: string) => void; onSueltas: (s: string) => void; onTotal: (s: string) => void; dato: string;
}) {
  const { t, lang } = usePrefs();
  const porCajas = pz != null && pz > 0;
  const val = validarCaptura({ pieces_per_box: pz }, cajas, sueltas, total);
  return porCajas ? (
    <>
      <div className="ops-dos ops-opciones">
        <label className="ops-cantidad"><span>{t("Full boxes", "Cajas completas")}</span><input className="ops-campo ops-campo-grande" inputMode="numeric" value={cajas} onChange={(e) => onCajas(e.target.value)} data-campo={`${dato}-cajas`} /></label>
        <label className="ops-cantidad"><span>{t("Loose pieces", "Piezas sueltas")}</span><input className="ops-campo ops-campo-grande" inputMode="numeric" value={sueltas} onChange={(e) => onSueltas(e.target.value)} data-campo={`${dato}-sueltas`} /></label>
      </div>
      <p className="ops-total-linea" data-total={val.ok ? val.total : ""}>{pz} {t("pcs per box", "pzas por caja")} → <b>{val.ok ? val.total : "—"}</b> {t("pieces", "piezas")}</p>
      {!val.ok && (cajas || sueltas) && <p className="hint" data-motivo={val.motivo}>{motivoDeCaptura(val.motivo, lang)}</p>}
    </>
  ) : (
    <>
      <label className="ops-cantidad"><span>{t("Total (pieces)", "Total (piezas)")}</span><input className="ops-campo ops-campo-grande" inputMode="numeric" value={total} onChange={(e) => onTotal(e.target.value)} data-campo={`${dato}-total`} /></label>
      {!val.ok && total && <p className="hint" data-motivo={val.motivo}>{motivoDeCaptura(val.motivo, lang)}</p>}
    </>
  );
}

/** Capturar una línea desde el teléfono: lo contado (cajas + sueltas, o el total); nota y foto opcionales. */
export function FormLinea({ l, ctx, onCerrar, onGuardada }: { l: Linea; ctx: Contexto; onCerrar: () => void; onGuardada: (n: Linea) => void }) {
  const { t, lang } = usePrefs();
  const porCajas = capturaPorCajas(l);
  const [cajas, setCajas] = useState(l.counted_boxes == null ? "" : String(l.counted_boxes));
  const [sueltas, setSueltas] = useState(l.counted_pieces == null ? "" : String(l.counted_pieces));
  const [total, setTotal] = useState(l.counted_total == null ? "" : String(l.counted_total));
  const [nota, setNota] = useState(l.note ?? "");
  const [foto, setFoto] = useState<string | null>(l.photo);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const val = validarCaptura(l, cajas, sueltas, total);
  const tomar = async (f: File, origen: "camara" | "galeria") => {
    setLeyendo(true); setError(null);
    try {
      if (ctx.demo) { setFoto(`demo/${crypto.randomUUID()}.jpg`); return; }
      const leida = await leerFotoDelTelefono(f);
      if (!leida.ok) { console.error(detalleParaConsola(leida, f, navigator.userAgent, origen)); setError(mensajeDeFotoFallida(leida.motivo, lang)); return; }
      setFoto(await subirFoto(createClient(), ctx.yo.id, leida.jpg));
    } catch (x) { setError(mensajeDeError(x)); } finally { setLeyendo(false); }
  };
  const guardar = async () => {
    if (!val.ok) return;
    setGuardando(true); setError(null);
    try {
      if (!ctx.demo) await registrarLinea(createClient(), { lineaId: l.id, cajas: val.cajas, sueltas: val.sueltas, total: porCajas ? null : val.total, nota, foto });
      onGuardada({ ...l, counted_boxes: val.cajas, counted_pieces: val.sueltas, counted_total: val.total, counted_by: ctx.yo.id, counted_by_name: ctx.yo.full_name, counted_at: new Date().toISOString(), note: nota.trim() || null, photo: foto, recount_requested: false });
    } catch (x) { setError(mensajeDeError(x)); } finally { setGuardando(false); }
  };
  return (
    <VentanaDeConteo dato="linea">
      <CerrarX onCerrar={onCerrar} />
      <h3><span className="hoja-folio">{l.sku}</span></h3>
      <p className="sub">{l.name}{l.size_in ? ` · ${l.size_in}` : ""}</p>
      {l.recount_requested && <p className="ops-aviso ops-aviso-pendiente" data-recontar>↩ {t("Manager asked for a recount", "El gerente pidió recontar")}{l.recount_note && `: ${l.recount_note}`}</p>}
      <div className="ops-formulario">
        <CamposDeCantidad pz={l.pieces_per_box} cajas={cajas} sueltas={sueltas} total={total} onCajas={setCajas} onSueltas={setSueltas} onTotal={setTotal} dato="contado" />
        <label className="ops-cantidad"><span>{t("Note (optional)", "Nota (opcional)")}</span><input className="ops-campo" value={nota} onChange={(e) => setNota(e.target.value)} placeholder={t("e.g. 3 broken, on the top rack", "p. ej. 3 rotas, en el rack de arriba")} data-campo="nota-linea" /></label>
        <FotoDeConteo foto={foto} setFoto={setFoto} tomar={tomar} leyendo={leyendo} />
      </div>
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCerrar} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!val.ok || guardando || leyendo} data-accion="guardar-linea">{guardando ? t("Saving…", "Guardando…") : t("Save count", "Guardar conteo")}</button>
      </div>
    </VentanaDeConteo>
  );
}

/** La foto opcional de una línea (cámara o galería, con su lector del teléfono). */
export function FotoDeConteo({ foto, setFoto, tomar, leyendo }: { foto: string | null; setFoto: (f: string | null) => void; tomar: (f: File, origen: "camara" | "galeria") => void | Promise<void>; leyendo: boolean }) {
  const { t } = usePrefs();
  return (
    <div className="ops-fotos">
      <span className="ops-cantidad">{t("Photo (optional)", "Foto (opcional)")}</span>
      {foto && <p className="ops-insignia">📷 {foto.split("/").pop()} <button type="button" className="btn btn-sm" onClick={() => setFoto(null)} data-accion="quitar-foto">✕</button></p>}
      {!foto && <BotonesDeFoto onFoto={tomar} leyendo={leyendo} etiquetaCamara={t("Take a photo", "Tomar foto")} primario={false} />}
    </div>
  );
}

/** Una orden pendiente: producto (de las líneas contadas; fijo al editar), factura, cantidad vendida y no entregada, nota. */
export function FormPendiente({ lineas, inicial, lineaFija, onCerrar, onListo }: {
  lineas: readonly Linea[]; inicial: OrdenPendiente | null; lineaFija: Linea | null; onCerrar: () => void;
  onListo: (x: { lineId: string; factura: string; cajas: number | null; sueltas: number | null; total: number | null; nota: string }) => Promise<void>;
}) {
  const { t } = usePrefs();
  const [lineId, setLineId] = useState<string>(lineaFija?.id ?? inicial?.line_id ?? "");
  const [factura, setFactura] = useState(inicial?.invoice_no ?? "");
  const ppbInicial = lineaFija?.pieces_per_box ?? lineas.find((l) => l.id === inicial?.line_id)?.pieces_per_box ?? null;
  const conCajas = inicial != null && ppbInicial != null && ppbInicial > 0;
  const [cajas, setCajas] = useState(conCajas ? String(Math.floor(inicial.qty / ppbInicial)) : "");
  const [sueltas, setSueltas] = useState(conCajas ? String(inicial.qty % ppbInicial) : "");
  const [total, setTotal] = useState(inicial && !conCajas ? String(inicial.qty) : "");
  const [nota, setNota] = useState(inicial?.note ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linea = lineaFija ?? lineas.find((l) => l.id === lineId) ?? null;
  const pz = linea?.pieces_per_box ?? null;
  const val = linea ? validarCaptura({ pieces_per_box: pz }, cajas, sueltas, total) : { ok: false as const, motivo: "vacio" as const };
  const listo = !!linea && factura.trim().length > 0 && factura.trim().length <= 40 && val.ok && val.total > 0;
  const guardar = async () => {
    if (!linea || !val.ok) return;
    setGuardando(true); setError(null);
    try {
      await onListo({ lineId: linea.id, factura: factura.trim(), cajas: pz != null && pz > 0 ? val.cajas : null, sueltas: pz != null && pz > 0 ? val.sueltas : null, total: pz != null && pz > 0 ? null : val.total, nota: nota.trim() });
    } catch (x) { setError(mensajeDeError(x)); } finally { setGuardando(false); }
  };
  return (
    <VentanaDeConteo dato="pendiente">
      <CerrarX onCerrar={onCerrar} />
      <h3>{inicial ? t("Edit pending order", "Editar orden pendiente") : t("Add pending order", "Agregar orden pendiente")}</h3>
      <p className="sub">{t("How much of this product is sold on an invoice and not yet delivered. Same unit as the count.", "Cuánto de este producto está vendido en una factura y aún no se entrega. La misma unidad que el conteo.")}</p>
      <div className="ops-formulario">
        {lineaFija ? (
          <p className="ops-seleccion"><span className="hoja-folio">{lineaFija.sku}</span> {lineaFija.name}</p>
        ) : (
          <label className="ops-cantidad"><span>{t("Product", "Producto")}</span>
            <select className="ops-campo ops-campo-grande" value={lineId} onChange={(e) => setLineId(e.target.value)} data-campo="pendiente-producto">
              <option value="">{t("Choose…", "Elige…")}</option>
              {lineas.map((l) => <option key={l.id} value={l.id}>{l.sku} · {l.name}{l.size_in ? ` · ${l.size_in}` : ""}</option>)}
            </select>
          </label>
        )}
        <label className="ops-cantidad"><span>{t("Invoice number", "Número de factura")}</span>
          <input className="ops-campo ops-campo-grande" inputMode="numeric" value={factura} onChange={(e) => setFactura(e.target.value)} maxLength={40} data-campo="factura" />
        </label>
        {linea && (pz != null && pz > 0 ? (
          <CamposDeCantidad pz={pz} cajas={cajas} sueltas={sueltas} total={total} onCajas={setCajas} onSueltas={setSueltas} onTotal={setTotal} dato="vendido" />
        ) : (
          <label className="ops-cantidad"><span>{t("Sold, not delivered (pieces)", "Vendido, no entregado (piezas)")}</span>
            <input className="ops-campo ops-campo-grande" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} data-campo="vendido-total" />
          </label>
        ))}
        <label className="ops-cantidad"><span>{t("Note (optional)", "Nota (opcional)")}</span>
          <input className="ops-campo" value={nota} onChange={(e) => setNota(e.target.value)} data-campo="pendiente-nota" />
        </label>
      </div>
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCerrar} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!listo || guardando} data-accion="guardar-pendiente">{guardando ? t("Saving…", "Guardando…") : t("Save order", "Guardar orden")}</button>
      </div>
    </VentanaDeConteo>
  );
}

/** El sistema de una línea (gerente, firma): la cantidad que dice el ERP, tecleada o corregida. Con el contado y lo pendiente a la vista. */
export function FormSistema({ l, pendiente, onCerrar, onListo }: { l: Linea; pendiente: number; onCerrar: () => void; onListo: (qty: number) => Promise<void> }) {
  const { t, lang } = usePrefs();
  const [q, setQ] = useState(l.system_qty == null ? "" : String(l.system_qty));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = numeroDelCampo(q);
  const ok = n != null && !Number.isNaN(n);
  const contado = l.counted_total ?? 0;
  const real = contado - pendiente;
  return (
    <VentanaDeConteo dato="sistema">
      <CerrarX onCerrar={onCerrar} />
      <h3><span className="hoja-folio">{l.sku}</span></h3>
      <p className="sub">{l.name}{l.size_in ? ` · ${l.size_in}` : ""}</p>
      <div className="ops-formulario">
        <p className="ops-total-linea" data-contado={contado}>{t("Counted", "Contado")} <b>{contado}</b> − {t("pending", "pendiente")} <b>{pendiente}</b> = {t("actual", "real")} <b>{real}</b></p>
        <label className="ops-cantidad"><span>{t("What the system says", "Lo que dice el sistema")}</span>
          <input className="ops-campo ops-campo-grande" inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lang === "es" ? "p. ej. 105" : "e.g. 105"} data-campo="sistema" autoFocus />
        </label>
        {ok && <p className="hint" data-diferencia={real - (n as number)}>{t("Difference", "Diferencia")}: <b>{real - (n as number) > 0 ? "+" : ""}{redondeaTexto(real - (n as number))}</b></p>}
        <p className="hint">{t("Recorded with your name and the time.", "Queda con tu nombre y la hora.")}</p>
      </div>
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCerrar} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
        <button type="button" className="btn btn-primary" disabled={!ok || guardando} onClick={async () => {
          setGuardando(true); setError(null);
          try { await onListo(n as number); } catch (x) { setError(mensajeDeError(x)); } finally { setGuardando(false); }
        }} data-accion="guardar-sistema">{guardando ? t("Saving…", "Guardando…") : t("Save system quantity", "Guardar cantidad del sistema")}</button>
      </div>
    </VentanaDeConteo>
  );
}

function redondeaTexto(n: number): string {
  return String(Math.round(n * 100) / 100);
}
