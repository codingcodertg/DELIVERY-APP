"use client";

import { mensajeDeError } from "@/lib/mensaje-de-error";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { BotonesDeFoto } from "./BotonesDeFoto";
import { detalleParaConsola, leerFotoDelTelefono, mensajeDeFotoFallida } from "@/lib/almacen-ops/foto-del-telefono";
import { enlacesDeFotos, subirAdjunto, subirFoto, tipoDeAdjuntoValido } from "@/lib/almacen-ops/datos";
import {
  INFO_DE_UNIDAD, MAX_LOTES, MAX_NOTA_LOTE, MAX_TEXTO_LOTE, UNIDADES_DE_CONTEO, motivoDeCaptura, motivoDeLotes, numeroDelCampo, textoDeCantidad, totalDeLotes, totalDelSistema, validarCaptura,
  type Linea, type Lote, type OrdenPendiente, type UnidadDeConteo,
} from "@/lib/almacen-ops/conteos";
import { registrarLotes } from "@/lib/almacen-ops/conteos-datos";
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
        <label className="ops-cantidad"><span>{t("Full boxes", "Cajas completas")}</span><input className="ops-campo ops-campo" inputMode="numeric" value={cajas} onChange={(e) => onCajas(e.target.value)} data-campo={`${dato}-cajas`} /></label>
        <label className="ops-cantidad"><span>{t("Loose pieces", "Piezas sueltas")}</span><input className="ops-campo ops-campo" inputMode="numeric" value={sueltas} onChange={(e) => onSueltas(e.target.value)} data-campo={`${dato}-sueltas`} /></label>
      </div>
      <p className="ops-total-linea" data-total={val.ok ? val.total : ""}>{pz} {t("pcs per box", "pzas por caja")} → <b>{val.ok ? val.total : "—"}</b> {t("pieces", "piezas")}</p>
      {!val.ok && (cajas || sueltas) && <p className="hint" data-motivo={val.motivo}>{motivoDeCaptura(val.motivo, lang)}</p>}
    </>
  ) : (
    <>
      <label className="ops-cantidad"><span>{t("Total (pieces)", "Total (piezas)")}</span><input className="ops-campo ops-campo" inputMode="numeric" value={total} onChange={(e) => onTotal(e.target.value)} data-campo={`${dato}-total`} /></label>
      {!val.ok && total && <p className="hint" data-motivo={val.motivo}>{motivoDeCaptura(val.motivo, lang)}</p>}
    </>
  );
}

/** Una fila de lote en la captura: cantidad (texto del campo), lote, nota y foto. */
interface FilaDeLote { key: number; qty: string; lot: string; note: string; photo: string | null }

/**
 * Capturar un producto desde el teléfono (19 nov, Roberto): UNO a la vez. La unidad (caja, bolsa, pieza) es una sola;
 * cada lote es una fila: cantidad total, lote, nota y foto («Take photo» / «Gallery» en una línea). El «+» agrega otro
 * lote (lote 123 = 100 cajas; lote 3A4 = 20 cajas). «Next» guarda y pasa al siguiente producto; la única salida es «Cancel».
 */
export function FormLinea({ l, ctx, siguiente, onCerrar, onGuardada }: {
  l: Linea; ctx: Contexto; siguiente: Linea | null; onCerrar: () => void; onGuardada: (n: Linea, siguiente: Linea | null) => void;
}) {
  const { t, lang } = usePrefs();
  const [unidad, setUnidad] = useState<UnidadDeConteo | null>(l.unit_of_measure ?? null);
  const [filas, setFilas] = useState<FilaDeLote[]>(() => (l.lots && l.lots.length > 0
    ? l.lots.map((x, n) => ({ key: n, qty: String(x.qty), lot: x.lot ?? "", note: x.note ?? "", photo: x.photo }))
    : [{ key: 0, qty: "", lot: "", note: "", photo: null }]));
  const [leyendo, setLeyendo] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numero = (s: string): number => { const x = numeroDelCampo(s); return x == null || Number.isNaN(x) ? NaN : x; };
  const lotes: Lote[] = filas
    .filter((f) => f.qty.trim() !== "")
    .map((f) => ({ qty: numero(f.qty), lot: f.lot.trim() || null, note: f.note.trim() || null, photo: f.photo || null }));
  const motivo = motivoDeLotes(lotes, unidad);
  const total = unidad ? totalDeLotes(lotes.filter((x) => Number.isFinite(x.qty))) : null;
  const comparable = unidad ? totalDelSistema(lotes.filter((x) => Number.isFinite(x.qty)), unidad, l.pieces_per_box, l.product_id != null).comparable : true;
  const nombreUnidad = (u: UnidadDeConteo) => (lang === "es" ? INFO_DE_UNIDAD[u].es : INFO_DE_UNIDAD[u].en);

  const cambiar = (key: number, campo: "qty" | "lot" | "note", v: string) => setFilas((x) => x.map((f) => (f.key === key ? { ...f, [campo]: v } : f)));
  const agregar = () => {
    const key = Math.max(-1, ...filas.map((f) => f.key)) + 1;
    setFilas((x) => [...x, { key, qty: "", lot: "", note: "", photo: null }]);
  };
  const quitar = (key: number) => setFilas((x) => x.filter((f) => f.key !== key));
  const ponerFoto = (key: number, ruta: string) => setFilas((x) => x.map((r) => (r.key === key ? { ...r, photo: ruta } : r)));

  const tomar = async (key: number, f: File, origen: "camara" | "galeria") => {
    setLeyendo(key); setError(null);
    try {
      if (ctx.demo) { ponerFoto(key, `demo/${crypto.randomUUID()}.jpg`); return; }
      const leida = await leerFotoDelTelefono(f);
      if (!leida.ok) { console.error(detalleParaConsola(leida, f, navigator.userAgent, origen)); setError(mensajeDeFotoFallida(leida.motivo, lang)); return; }
      ponerFoto(key, await subirFoto(createClient(), ctx.yo.id, leida.jpg));
    } catch (x) { setError(mensajeDeError(x)); } finally { setLeyendo(null); }
  };

  const guardar = async (irA: "siguiente" | "terminar") => {
    if (motivo || !unidad) return;
    setGuardando(true); setError(null);
    try {
      if (!ctx.demo) await registrarLotes(createClient(), { lineaId: l.id, unidad, lotes });
      const sistema = totalDelSistema(lotes, unidad, l.pieces_per_box, l.product_id != null);
      const n: Linea = {
        ...l, unit_of_measure: unidad, lots: lotes, counted_boxes: null, counted_pieces: null, counted_total: sistema.total,
        counted_by: ctx.yo.id, counted_by_name: ctx.yo.full_name, counted_at: new Date().toISOString(), note: null,
        photo: lotes.find((x) => x.photo)?.photo ?? null, recount_requested: false,
      };
      onGuardada(n, irA === "siguiente" ? siguiente : null);
    } catch (x) { setError(mensajeDeError(x)); } finally { setGuardando(false); }
  };

  return (
    <VentanaDeConteo dato="linea">
      <h3><span className="hoja-folio">{l.sku}</span> {l.name}</h3>
      <p className="sub">{l.size_in ? `${l.size_in} · ` : ""}{l.pieces_per_box ? `${l.pieces_per_box} ${t("pcs per box", "pzas por caja")}` : t("no pieces per box in the ERP", "sin piezas por caja en el ERP")}</p>
      {l.recount_requested && <p className="ops-aviso ops-aviso-pendiente" data-recontar>↩ {t("Manager asked for a recount", "El gerente pidió recontar")}{l.recount_note && `: ${l.recount_note}`}</p>}
      <div className="ops-formulario">
        <div className="ops-cantidad"><span>{t("Unit of measure", "Unidad de medida")}</span>
          <div className="ops-opciones ops-unidades" role="group" aria-label={t("Unit of measure", "Unidad de medida")}>
            {UNIDADES_DE_CONTEO.map((u) => (
              <button key={u} type="button" className={`ops-opcion${unidad === u ? " elegida" : ""}`} aria-pressed={unidad === u} onClick={() => setUnidad(u)} data-unidad={u}>{nombreUnidad(u)}</button>
            ))}
          </div>
        </div>

        {filas.map((f, n) => (
          <fieldset key={f.key} className="ops-lote" data-lote={n + 1}>
            <legend>{t("Lot", "Lote")} {n + 1}</legend>
            <label className="ops-cantidad"><span>{t("Total units", "Total de unidades")}</span>
              <input className="ops-campo ops-campo" inputMode="decimal" value={f.qty} onChange={(e) => cambiar(f.key, "qty", e.target.value)} data-campo={`lote-cantidad-${n + 1}`} />
            </label>
            <label className="ops-cantidad"><span>{t("Lot number (optional)", "Número de lote (opcional)")}</span>
              <input className="ops-campo" value={f.lot} maxLength={MAX_TEXTO_LOTE} onChange={(e) => cambiar(f.key, "lot", e.target.value)} placeholder={t("e.g. 123 or 3A4", "p. ej. 123 o 3A4")} data-campo={`lote-numero-${n + 1}`} />
            </label>
            <label className="ops-cantidad"><span>{t("Note (optional)", "Nota (opcional)")}</span>
              <input className="ops-campo" value={f.note} maxLength={MAX_NOTA_LOTE} onChange={(e) => cambiar(f.key, "note", e.target.value)} placeholder={t("e.g. 3 broken, wet", "p. ej. 3 rotas, mojadas")} data-campo={`lote-nota-${n + 1}`} />
            </label>
            <div className="ops-fotos">
              {f.photo ? (
                <p className="ops-insignia">📷 {f.photo.split("/").pop()} <button type="button" className="btn btn-sm" onClick={() => ponerFoto(f.key, "")} data-accion="quitar-foto">✕</button></p>
              ) : (
                <BotonesDeFoto onFoto={(file, origen) => void tomar(f.key, file, origen)} leyendo={leyendo === f.key} etiquetaCamara={t("Take photo", "Take photo")}
                  etiquetaGaleria={t("Gallery", "Gallery")} enLinea primario={false} />
              )}
            </div>
            {filas.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => quitar(f.key)} data-accion="quitar-lote">✕ {t("Remove this lot", "Quitar este lote")}</button>}
          </fieldset>
        ))}
        <button type="button" className="ops-opcion" onClick={agregar} disabled={filas.length >= MAX_LOTES} data-accion="agregar-lote">+ {t("Add another lot", "Agregar otro lote")}</button>
        {total != null && !comparable && <p className="hint" data-no-comparable>{t("This count is not compared with the system (bags or a free product): no difference will be computed.", "Este conteo no se compara con el sistema (bolsas o producto libre): no se calcula diferencia.")}</p>}
        {total != null && <p className="ops-total-linea" data-total={total}>{t("Total", "Total")}: <b>{textoDeCantidad(total, unidad, l.pieces_per_box, lang)}</b></p>}
        {motivo && lotes.length > 0 && <p className="hint" data-motivo={motivo}>{t("Each lot needs a number of units (0 or more), and at least one above 0.", "Cada lote necesita una cantidad (0 o más), y al menos uno mayor que 0.")}</p>}
      </div>
      {error && <p className="ops-aviso ops-aviso-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCerrar} disabled={guardando}>{t("Cancel", "Cancelar")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void guardar(siguiente ? "siguiente" : "terminar")} disabled={!!motivo || guardando || leyendo != null} data-accion={siguiente ? "siguiente" : "guardar-linea"}>
          {guardando ? t("Saving…", "Guardando…") : t("Next", "Siguiente")}
        </button>
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
      <div className="ops-formulario">
        {lineaFija ? (
          <p className="ops-seleccion"><span className="hoja-folio">{lineaFija.sku}</span> {lineaFija.name}</p>
        ) : (
          <label className="ops-cantidad"><span>{t("Product", "Producto")}</span>
            <select className="ops-campo ops-campo" value={lineId} onChange={(e) => setLineId(e.target.value)} data-campo="pendiente-producto">
              <option value="">{t("Choose…", "Elige…")}</option>
              {lineas.map((l) => <option key={l.id} value={l.id}>{l.sku} · {l.name}{l.size_in ? ` · ${l.size_in}` : ""}</option>)}
            </select>
          </label>
        )}
        <label className="ops-cantidad"><span>{t("Invoice number", "Número de factura")}</span>
          <input className="ops-campo ops-campo" inputMode="numeric" value={factura} onChange={(e) => setFactura(e.target.value)} maxLength={40} data-campo="factura" />
        </label>
        {linea && (pz != null && pz > 0 ? (
          <CamposDeCantidad pz={pz} cajas={cajas} sueltas={sueltas} total={total} onCajas={setCajas} onSueltas={setSueltas} onTotal={setTotal} dato="vendido" />
        ) : (
          <label className="ops-cantidad"><span>{t("Sold, not delivered (pieces)", "Vendido, no entregado (piezas)")}</span>
            <input className="ops-campo ops-campo" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} data-campo="vendido-total" />
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
          <input className="ops-campo ops-campo" inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lang === "es" ? "p. ej. 105" : "e.g. 105"} data-campo="sistema" autoFocus />
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
