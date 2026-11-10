"use client";

import { useContextoDeAyuda } from "@/lib/ayuda-ubicacion-hook";
import { contextoDelAsistente } from "@/lib/ayuda-contextos";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtMoney } from "@/lib/utils";
import { BotonesDeFoto } from "./BotonesDeFoto";
import { detalleParaConsola, leerFotoDelTelefono, mensajeDeFotoFallida } from "@/lib/almacen-ops/foto-del-telefono";
import { INFO_DE_TIPO, esDeRrhh, type TipoDeReporte } from "@/lib/almacen-ops/tipos";
import {
  camposDe, costoDelCampo, empleadosDelReporte, etiquetaDeOpcion, pasoCompleto, pasoInicial, pasosVisibles, primerHuecoSalvoFoto,
  productoLibre, respuestasIniciales, respuestasParaGuardar, seMuestra, type Paso, type ProductoElegido, type Respuestas,
} from "@/lib/almacen-ops/pasos";
import {
  CLAVE_HASHES, CLAVE_PENDIENTE, MAX_FOTOS, avisoDeRepetida, fotosDe, hashesDe, motivoDeBloqueo,
  puedeEnviar, puedeGuardarSinFoto, type Repetida,
} from "@/lib/almacen-ops/fotos";
import { fechaDelDanoValida, fmtDia, hoyEnTexas } from "@/lib/almacen-ops/fecha-del-dano";
import { cantidadesValidas, cuentaComoPerdida, enteroDelCampo, perdidaDeMerma, piezasPorCajaInicial, piezasTotales, repartoAjustado, repartoAlCambiar, repartoValido, type Cantidades, type Reparto } from "@/lib/almacen-ops/perdida";
import { DEMO_PRODUCTOS, buscarProductos, mermaParaEnviar, productoParaEnviar, registrar, reportesConLaFoto, subirFoto, type Envio, type Reporte } from "@/lib/almacen-ops/datos";
import { esCorteDePractica } from "@/lib/practica/es-corte";
import { Tarjeta } from "./ListaDeReportes";
import { elegidosAlCambiarDeTienda, nombreOTexto, personasParaElegir } from "@/lib/almacen-ops/personas";
import { borrarBorrador, guardarBorrador, hayCambios, leerBorrador } from "@/lib/almacen-ops/borradores";
import type { Contexto } from "./Operaciones";
import { CLAVE_NOMBRE_DE_EQUIPO, esEquipoDelInventario, idDeEquipoElegido, opcionesDeEquipo, type Equipo } from "@/lib/almacen-ops/mantenimiento";
import { DEMO_MANTENIMIENTO } from "@/lib/almacen-ops/mantenimiento-datos";

/**
 * El asistente de un reporte (D-883, 247): una pregunta por pantalla, con botones grandes para el teléfono; luego el
 * resumen, donde cada fila se toca para corregirla, y «Enviar». La tienda (la de la persona por defecto) va arriba.
 *
 * Ningún paso avanza solo (pedido 6f14b2b3): antes los de una sola opción saltaban al elegir y los demás no, y eso
 * confundía. Siempre se toca «Siguiente»; al elegir, el foco pasa a ese botón (Enter lo oprime) y Enter en un campo
 * de una línea también avanza.
 */
export function Asistente({ tipo, ctx }: { tipo: TipoDeReporte; ctx: Contexto }) {
  const { t, lang } = usePrefs();
  const info = INFO_DE_TIPO[tipo];
  const router = useRouter();
  const idDeBorrador = useSearchParams().get("borrador");
  // Un borrador (pedido 4a1123bb) se reabre con ?borrador=<id>; solo los del mismo tipo y de quien mira.
  const [inicial] = useState(() => {
    const b = idDeBorrador ? leerBorrador(ctx.yo.id, idDeBorrador) : null;
    return b && b.tipo === tipo ? b : null;
  });
  const [borradorId, setBorradorId] = useState<string>(() => inicial?.id ?? crypto.randomUUID());
  // La merma arranca con la fecha del daño en hoy (Texas), también al reabrir un borrador que no la traía (266).
  const [arranque] = useState<Respuestas>(() => respuestasIniciales(tipo, inicial?.r));
  const [r, setR] = useState<Respuestas>(arranque);
  // Un borrador de antes de reordenar la merma (D-919) trae un índice de la lista vieja: se abre igual, sin pasarse del resumen.
  const [i, setI] = useState(() => pasoInicial(tipo, arranque, inicial?.paso));
  const [volverAlResumen, setVolverAlResumen] = useState(false);
  const [tienda, setTiendaCruda] = useState(() => (inicial?.tienda && ctx.tiendas.includes(inicial.tienda) ? inicial.tienda
    : ctx.yo.store && ctx.tiendas.includes(ctx.yo.store) ? ctx.yo.store : ctx.tiendas[0] ?? ""));
  const [guardadoComo, setGuardadoComo] = useState<{ r: Respuestas; tienda: string }>(() => ({ r: arranque, tienda: inicial?.tienda ?? tienda }));
  const [avisoBorrador, setAvisoBorrador] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "enviado": reporte completo; "sin-foto" (268): merma guardada en la base a la espera de la foto (papel primero).
  const [hecho, setHecho] = useState<false | "enviado" | "sin-foto">(false);
  // 268: una foto repetida espera a que la confirmen o la quiten antes de seguir.
  const [confirmandoFoto, setConfirmandoFoto] = useState(false);
  const botonSiguiente = useRef<HTMLButtonElement>(null);

  // 273: el reporte de mantenimiento elige el equipo del inventario de la tienda cuando lo hay (si no, las opciones fijas).
  const equipos = useEquipoDeLaTienda(ctx, tipo === "maintenance");
  const pasos = conEquipoDelInventario(pasosVisibles(tipo, r), equipos, tienda);
  const enResumen = i >= pasos.length;
  const paso = pasos[i];
  const listo = paso ? pasoCompleto(paso, r) && !confirmandoFoto : false;
  // 268: por qué no se envía (la foto obligatoria va aparte: su paso se puede saltar «la tengo en papel»).
  const envio = puedeEnviar(tipo, r, tienda, primerHuecoSalvoFoto(tipo, r));
  const guardaSinFoto = puedeGuardarSinFoto(tipo, r, tienda, primerHuecoSalvoFoto(tipo, r));
  // Lo que una solicitud de ayuda dirá de esta pantalla (D-901): por qué paso iba (la pregunta, no la respuesta).
  useContextoDeAyuda("asistente-de-operaciones", contextoDelAsistente({
    paso: paso ? { en: paso.en, es: paso.es } : null, indice: i, total: pasos.length, enResumen, enviado: hecho === "enviado", tienda,
  }));
  const pon = (id: string, v: unknown) => setR((x) => ({ ...x, [id]: v }));
  // «Algo escrito» no cuenta la fecha del daño que se pone sola: cambiar solo la tienda de un reporte en blanco no es un cambio.
  const cambiado = hayCambios(r, guardadoComo.r) || (hayCambios(r, respuestasIniciales(tipo)) && tienda !== guardadoComo.tienda);

  /** Cambiar de tienda quita a la gente elegida que no es del almacén de la nueva (el selector solo muestra esa). */
  const setTienda = (nueva: string) => {
    setTiendaCruda(nueva);
    const deAhi = new Set(personasParaElegir(ctx.personas, nueva).map((p) => p.id));
    const conocidos = new Set(ctx.personas.map((p) => p.id));
    setR((x) => {
      const y = { ...x };
      for (const p of pasosVisibles(tipo, x).flatMap(camposDe)) {
        // Un nombre escrito a mano (D-915, «¿quién lo reportó?») no es de ninguna tienda: se queda.
        if (p.tipo === "personas" && Array.isArray(y[p.id])) y[p.id] = elegidosAlCambiarDeTienda(y[p.id] as string[], deAhi, conocidos);
        if (p.tipo === "persona" && typeof y[p.id] === "string" && !deAhi.has(y[p.id] as string)) delete y[p.id];
      }
      return y;
    });
  };

  const guardar = () => {
    const res = guardarBorrador(ctx.yo.id, { id: borradorId, tipo, r, paso: i, tienda, guardado: new Date().toISOString() });
    if (res === "error") { setAvisoBorrador(t("The draft could not be saved on this device.", "No se pudo guardar el borrador en este aparato.")); return; }
    setGuardadoComo({ r, tienda });
    setAvisoBorrador(res === "sin-fotos"
      ? t("Draft saved without the photos (not enough space). Add them again before sending.", "Borrador guardado sin las fotos (no hay espacio). Vuelve a agregarlas antes de enviar.")
      : t("Draft saved. Open it again from the Warehouse Ops home.", "Borrador guardado. Ábrelo otra vez desde el inicio de Operaciones."));
  };
  const cerrar = () => { if (cambiado) setCerrando(true); else router.push("/operaciones"); };

  const siguiente = () => {
    if (volverAlResumen) { setVolverAlResumen(false); setI(pasos.length); return; }
    setI((n) => n + 1);
  };
  const editar = (n: number) => { setVolverAlResumen(true); setI(n); };
  /** Al elegir una opción NO se avanza: el foco va a «Siguiente» (espera al render: el botón estaba apagado). */
  const alElegirUno = () => { setTimeout(() => botonSiguiente.current?.focus(), 0); };
  /** Enter en un campo de una línea = «Siguiente» (no en el buscador ni en el texto largo, donde Enter es otra cosa). */
  const enterAvanza = (e: React.KeyboardEvent) => {
    const el = e.target;
    if (e.key !== "Enter" || !listo || !(el instanceof HTMLInputElement) || el.type === "search" || el.type === "file") return;
    e.preventDefault();
    siguiente();
  };

  /**
   * Envía el reporte. `sinFoto` (268): la merma que apuntaron en papel se guarda en la base SIN foto y marcada
   * `photo_pending`; queda incompleta hasta que le agreguen la foto desde «Mis reportes» (o el gerente desde «Reportes»).
   * Las huellas (SHA-256) de las fotos viajan dentro de `answers` alineadas con las rutas; el trigger de la 268 las
   * pasa a su columna.
   */
  const enviar = async (sinFoto = false) => {
    if (sinFoto ? !guardaSinFoto : !envio.ok) return;
    setEnviando(true); setError(null);
    try {
      if (ctx.demo) { await new Promise((ok) => setTimeout(ok, 300)); borrarBorrador(ctx.yo.id, borradorId); setHecho(sinFoto ? "sin-foto" : "enviado"); return; }
      const sb = createClient();
      const fotos: string[] = [];
      const huellas = hashesDe(r);
      for (const f of fotosDe(r)) fotos.push(await subirFoto(sb, ctx.yo.id, f));
      const q = r.qty as Cantidades | undefined;
      const p = r.product as ProductoElegido | undefined;
      const answers = respuestasParaGuardar(tipo, r);
      if (fotos.length > 0) answers[CLAVE_HASHES] = fotos.map((_, n) => huellas[n] ?? "");
      // 273: el nombre del equipo del inventario viaja con el reporte, para que las listas lo enseñen sin consultar.
      if (tipo === "maintenance" && esEquipoDelInventario(r.equipment)) answers[CLAVE_NOMBRE_DE_EQUIPO] = equipos.find((x) => x.id === idDeEquipoElegido(r.equipment))?.name ?? "";
      if (sinFoto) answers[CLAVE_PENDIENTE] = true;
      const e: Envio = {
        kind: tipo, store: tienda, subjectIds: empleadosDelReporte(tipo, r), answers, photos: fotos,
        scrap: tipo === "scrap" && p && q ? { ...productoParaEnviar(p), ...mermaParaEnviar(r) } : null,
      };
      // `broken_by` y `crma` tienen columna propia; `reported_by` (D-915) se queda dentro de `answers`.
      if (e.scrap) { delete e.answers.broken_by; delete e.answers.crma; }
      await registrar(sb, e);
      borrarBorrador(ctx.yo.id, borradorId);
      setHecho(sinFoto ? "sin-foto" : "enviado");
    } catch (e) {
      // En práctica (modo enseñanza) no se guarda de verdad: se da por enviado igual que en demo. El aviso global ya salió.
      if (esCorteDePractica(e)) { borrarBorrador(ctx.yo.id, borradorId); setHecho(sinFoto ? "sin-foto" : "enviado"); return; }
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setEnviando(false);
    }
  };

  if (hecho) {
    return (
      <section className="ops-hecho" data-enviado={tipo}>
        <span className="ops-hecho-icono" aria-hidden>{hecho === "sin-foto" ? "📷" : "✅"}</span>
        <h2>{hecho === "sin-foto" ? t("Saved without photo", "Guardado sin foto") : t("Report sent", "Reporte enviado")}</h2>
        {hecho === "sin-foto" && <p data-aviso="sin-foto">{t("It is incomplete until you add the photo of the pieces. Open it from “My scrap reports” and tap “Add photo”.",
          "Queda incompleto hasta que agregues la foto de las piezas. Ábrelo desde «Mis reportes de merma» y toca «Agregar foto».")}</p>}
        {esDeRrhh(tipo) && <p>{t("It was added to the employee's HR file. Only managers and HR can see it.", "Se agregó al expediente del empleado. Solo lo ven los gerentes y RR. HH.")}</p>}
        <div className="ops-hecho-acciones">
          <Link href="/operaciones" className="ops-boton-ancho ops-boton-primario">{t("Done", "Listo")}</Link>
          <button type="button" className="ops-boton-ancho" onClick={() => { const nuevo = respuestasIniciales(tipo); setR(nuevo); setI(0); setGuardadoComo({ r: nuevo, tienda }); setBorradorId(crypto.randomUUID()); setHecho(false); }}>{t("File another", "Llenar otro")}</button>
        </div>
      </section>
    );
  }

  return (
    <section className="ops-asistente" data-tipo={tipo}>
      <header className="ops-asistente-cabeza">
        <div className="ops-asistente-barra">
          <span className="ops-asistente-tipo"><span aria-hidden>{info.emoji}</span> {lang === "es" ? info.es : info.en}</span>
          <span className="ops-asistente-acciones">
            <button type="button" className="ops-boton ops-boton-chico" onClick={cerrar} disabled={enviando} data-accion="cerrar">✕ {t("Close", "Cerrar")}</button>
          </span>
        </div>
        {ctx.tiendas.length > 1 && (
          <label className="ops-tienda ops-tienda-arriba">
            <span>{t("Store", "Tienda")}</span>
            <select value={tienda} onChange={(e) => setTienda(e.target.value)} data-campo="tienda-arriba">
              {ctx.tiendas.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        )}
        <ol className="ops-progreso" aria-label={t(`Step ${Math.min(i + 1, pasos.length + 1)} of ${pasos.length + 1}`, `Paso ${Math.min(i + 1, pasos.length + 1)} de ${pasos.length + 1}`)}>
          {[...pasos, null].map((_, n) => <li key={n} className={n < i ? "hecho" : n === i ? "ahora" : ""} />)}
        </ol>
      </header>

      {!enResumen && paso && (
        <div className="ops-pregunta" data-paso={paso.id} onKeyDown={enterAvanza}>
          <h2>{lang === "es" ? paso.es : paso.en}</h2>
          {"ayuda" in paso && paso.ayuda && <p className="hint" data-ayuda-del-paso>{lang === "es" ? paso.ayuda.es : paso.ayuda.en}</p>}
          <Respuesta paso={paso} r={r} pon={pon} ctx={ctx} tienda={tienda} onElegirUno={alElegirUno} onConfirmandoFoto={setConfirmandoFoto} />
          {/* 268: la foto de la merma es obligatoria, pero si la apuntaron en papel pueden seguir y guardarla «sin foto». */}
          {paso.tipo === "foto" && paso.obligatoria && fotosDe(r).length === 0 && (
            <div className="ops-foto-papel" data-foto-obligatoria>
              <p className="hint">{t("The report cannot be sent without a photo of the damaged pieces.", "El reporte no se envía sin una foto de las piezas dañadas.")}</p>
              <button type="button" className="ops-boton ops-boton-chico" onClick={siguiente} data-accion="foto-despues">
                {t("I wrote it on paper — I'll add the photo later", "Lo apunté en papel: agrego la foto después")}
              </button>
            </div>
          )}
        </div>
      )}

      {enResumen && (
        <div className="ops-resumen">
          <h2>{t("Check and send", "Revisa y envía")}</h2>
          {/* Roberto, pedido 319a0f18 (D-919): el recordatorio de la política de merma, arriba del resumen. */}
          {tipo === "scrap" && (
            <p className="ops-recordatorio" role="note" data-recordatorio="merma">
              {t("This form must be filled out every time damaged material is found. The material cannot be discarded until photos have been taken, the evidence saved, and Management's authorization obtained through the app.",
                "Este formato debe llenarse cada vez que se detecte material dañado. El material no podrá desecharse hasta que se hayan tomado fotografías, guardado la evidencia y obtenido la autorización de Gerencia a través de la aplicación.")}
            </p>
          )}
          {tipo === "scrap" && <Perdida r={r} grande />}
          <dl>
            {/* Un grupo (D-919) sale como una fila por campo; todas abren la misma pantalla. */}
            {pasos.flatMap((p, n) => camposDe(p).filter((c) => seMuestra(c, r)).map((c) => (
              <button type="button" key={c.id} className={`ops-fila${pasoCompleto(c, r) ? "" : " falta"}`} onClick={() => editar(n)} data-editar={c.id}>
                <dt>{lang === "es" ? c.es : c.en}</dt>
                <dd>{textoDeRespuesta(tipo, c, r, ctx, lang) || <span className="hint">{pasoCompleto(c, r) ? "—" : c.tipo === "foto" ? t("Missing photo", "Falta la foto") : t("Missing", "Falta")}</span>}</dd>
              </button>
            )))}
          </dl>
          {/* La tienda ya se elige arriba (pedido c10078f9); aquí solo queda cuando arriba no sale (una sola tienda). */}
          {ctx.tiendas.length <= 1 && (
            <label className="ops-tienda">
              <span>{t("Store", "Tienda")}</span>
              <select value={tienda} onChange={(e) => setTienda(e.target.value)} data-campo="tienda">
                {ctx.tiendas.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
          {!envio.ok && envio.motivo === "foto" && (
            <div className="ops-aviso ops-aviso-error" role="status" data-bloqueo="foto">
              <p>📷 {motivoDeBloqueo("foto", lang)}</p>
              {guardaSinFoto && <p className="hint">{t("Wrote it on paper? Save it without the photo: it stays incomplete until the photo is added.", "¿Lo apuntaste en papel? Guárdalo sin foto: queda incompleto hasta que le agregues la foto.")}</p>}
            </div>
          )}
          {error && <p className="ops-aviso ops-aviso-error" role="alert">{t("Not sent: ", "No se envió: ")}{error}</p>}
        </div>
      )}

      {cerrando && (
        <div className="overlay" onClick={() => setCerrando(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} data-dialogo="descartar">
            <h3>{t("Discard this report?", "¿Descartar este reporte?")}</h3>
            <p className="sub">{t("You have changes that are not saved. Save a draft to finish it later.", "Tienes cambios sin guardar. Guarda un borrador para terminarlo después.")}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setCerrando(false)} data-accion="seguir">{t("Keep editing", "Seguir llenando")}</button>
              <button type="button" className="btn" onClick={() => { guardar(); router.push("/operaciones"); }} data-accion="guardar-y-cerrar">{t("Save draft and close", "Guardar borrador y cerrar")}</button>
              <button type="button" className="btn btn-danger" onClick={() => router.push("/operaciones")} data-accion="descartar">{t("Discard", "Descartar")}</button>
            </div>
          </div>
        </div>
      )}

      <footer className="ops-botonera">
        {avisoBorrador && <p className="ops-aviso ops-botonera-entera" role="status" data-aviso="borrador">{avisoBorrador}</p>}
        {i === 0
          ? <button type="button" className="ops-boton" onClick={cerrar}>{t("Cancel", "Cancelar")}</button>
          : <button type="button" className="ops-boton" onClick={() => { setVolverAlResumen(false); setI((n) => n - 1); }} disabled={enviando}>{t("Back", "Atrás")}</button>}
        {enResumen
          ? <button type="button" className="ops-boton ops-boton-primario" onClick={() => void enviar()} disabled={enviando || !envio.ok} data-accion="enviar"
              title={envio.ok ? undefined : motivoDeBloqueo(envio.motivo, lang)} data-bloqueado={envio.ok ? undefined : envio.motivo}>
              {enviando ? t("Sending…", "Enviando…") : t("Send report", "Enviar reporte")}
            </button>
          : <button type="button" ref={botonSiguiente} className="ops-boton ops-boton-primario" onClick={siguiente} disabled={!listo} data-accion="siguiente">
              {volverAlResumen ? t("Back to summary", "Volver al resumen") : i === pasos.length - 1 ? t("Review", "Revisar") : t("Next", "Siguiente")}
            </button>}
        {/* «Guardar borrador» abajo, con Atrás / Siguiente (pedido 78b2e1fc); «Cerrar» sigue arriba. */}
        {enResumen && guardaSinFoto && (
          <button type="button" className="ops-boton ops-botonera-entera" onClick={() => void enviar(true)} disabled={enviando} data-accion="guardar-sin-foto">
            📷 {enviando ? t("Saving…", "Guardando…") : t("Save without photo (on paper)", "Guardar sin foto (en papel)")}
          </button>
        )}
        <button type="button" className="ops-boton ops-boton-chico ops-botonera-entera" onClick={guardar} disabled={enviando || !cambiado} data-accion="guardar-borrador">💾 {t("Save draft", "Guardar borrador")}</button>
      </footer>
    </section>
  );
}

/**
 * 273: el equipo activo de la tienda para el paso «¿Qué equipo?» del reporte de mantenimiento. Solo se lee en ese
 * tipo; si la 273 no está aplicada (o falla la lectura) la lista queda vacía y se usan las opciones fijas.
 */
function useEquipoDeLaTienda(ctx: Contexto, activo: boolean): Pick<Equipo, "id" | "name" | "store" | "active">[] {
  const [equipos, setEquipos] = useState<Pick<Equipo, "id" | "name" | "store" | "active">[]>([]);
  useEffect(() => {
    if (!activo) return;
    if (ctx.demo) { setEquipos(DEMO_MANTENIMIENTO.equipos); return; }
    let vivo = true;
    createClient().from("warehouse_equipment").select("id, name, store, active").eq("active", true).order("name")
      .then(({ data }) => { if (vivo && data) setEquipos(data as Pick<Equipo, "id" | "name" | "store" | "active">[]); });
    return () => { vivo = false; };
  }, [ctx.demo, activo]);
  return equipos;
}

/** El paso «¿Qué equipo?» con las opciones del inventario de la tienda; los demás pasos, tal cual. */
function conEquipoDelInventario(pasos: Paso[], equipos: readonly Pick<Equipo, "id" | "name" | "store" | "active">[], tienda: string): Paso[] {
  const opciones = opcionesDeEquipo(equipos, tienda);
  if (!opciones) return pasos;
  return pasos.map((p) => (p.tipo === "opcion" && p.id === "equipment" ? { ...p, opciones } : p));
}

function nombreDe(ctx: Contexto, id: string): string {
  return ctx.personas.find((p) => p.id === id)?.full_name ?? "—";
}

function textoDeRespuesta(tipo: TipoDeReporte, p: Paso, r: Respuestas, ctx: Contexto, lang: "en" | "es"): string {
  const v = r[p.id];
  switch (p.tipo) {
    case "grupo": return "";
    case "personas": return Array.isArray(v) ? (v as string[]).map((x) => nombreOTexto(ctx.personas, x)).join(", ") : "";
    case "persona": return typeof v === "string" ? nombreDe(ctx, v) : "";
    case "opcion": { const x = p.opciones.find((o) => o.v === v); return x ? x[lang] : etiquetaDeOpcion(tipo, p.id, v, lang); }
    case "sino": return etiquetaDeOpcion(tipo, p.id, v, lang);
    case "texto": return typeof v === "string" ? v : "";
    case "fecha": return typeof v === "string" && v ? fmtDia(v, lang) : "";
    case "foto": { const n = Array.isArray(v) ? v.length : 0; return n ? (lang === "es" ? `${n} foto${n > 1 ? "s" : ""}` : `${n} photo${n > 1 ? "s" : ""}`) : ""; }
    case "producto": {
      const x = v as ProductoElegido | undefined;
      if (!x) return "";
      return x.libre ? `${x.name} (${lang === "es" ? "no está en el catálogo" : "not in catalog"})` : `${x.sku} · ${x.name}`;
    }
    case "cantidad": {
      const q = v as Cantidades | undefined;
      if (!q) return "";
      const piezas = piezasTotales(q);
      const cuenta = lang === "es" ? `${q.boxes} cajas × ${q.piecesPerBox} = ${piezas} piezas` : `${q.boxes} boxes × ${q.piecesPerBox} = ${piezas} pieces`;
      const s = r.split as Reparto | undefined;
      if (!repartoValido(piezas, s)) return cuenta;
      return `${cuenta} · ${lang === "es" ? `${s.damaged} dañadas, ${s.sample} de muestra` : `${s.damaged} damaged, ${s.sample} sample`}`;
    }
  }
}

function Perdida({ r, grande = false }: { r: Respuestas; grande?: boolean }) {
  const { t } = usePrefs();
  const p = r.product as ProductoElegido | undefined;
  const q = r.qty as Cantidades | undefined;
  if (!p || !q) return null;
  const piezas = piezasTotales(q);
  // Solo las dañadas son pérdida (pedido 0c2fb392); las que sirven de muestra no cuentan.
  const s = repartoValido(piezas, r.split as Partial<Reparto> | undefined) ? (r.split as Reparto) : repartoAjustado(piezas, r.split as Partial<Reparto> | undefined, r.scrap_type);
  // Una devolución de cliente sin CRMA no cuenta como pérdida (Roberto, hilo 714584e6; migración 263).
  const cuenta = cuentaComoPerdida(r);
  const total = perdidaDeMerma(p.cost, s, r);
  const sinContar = s.sample > 0 ? t(` · ${s.sample} sample not counted`, ` · ${s.sample} de muestra no cuentan`) : "";
  return (
    <div className={`ops-perdida${grande ? " grande" : ""}`} data-perdida={total ?? ""} data-cuenta-como-perdida={cuenta ? "si" : "no"}>
      <span className="ops-perdida-cifra">{total == null ? t("No price", "Sin precio") : fmtMoney(total)}</span>
      <span className="ops-perdida-cuenta">
        {!cuenta
          ? t("No CRMA: not counted as loss. A manager can add the CRMA later and it will count.", "Sin CRMA: no cuenta como pérdida. Un gerente puede poner el CRMA después y entonces contará.")
          : p.cost == null
          ? p.libre
            ? t("No price entered; a manager can add it later.", "Sin precio; un gerente lo puede poner después.")
            : t("This product has no price in the catalog; the loss is saved without a $ amount.", "Este producto no tiene precio en el catálogo; la pérdida se guarda sin monto.")
          : t(`${s.damaged} damaged pieces × ${fmtMoney(p.cost)} per piece`, `${s.damaged} piezas dañadas × ${fmtMoney(p.cost)} por pieza`) + sinContar}
      </span>
    </div>
  );
}

function Respuesta({ paso, r, pon, ctx, tienda, onElegirUno, onConfirmandoFoto }: {
  paso: Paso; r: Respuestas; pon: (id: string, v: unknown) => void; ctx: Contexto; tienda: string; onElegirUno: () => void; onConfirmandoFoto: (x: boolean) => void;
}) {
  const { t, lang } = usePrefs();
  const v = r[paso.id];
  switch (paso.tipo) {
    case "grupo":
      // Varias preguntas en una pantalla (D-919, pedido fb02f65a): cada campo con su propio título y su propia respuesta.
      return (
        <div className="ops-grupo">
          {paso.campos.filter((c) => seMuestra(c, r)).map((c) => (
            <section key={c.id} className="ops-grupo-campo" data-campo-del-grupo={c.id}>
              <h3>{lang === "es" ? c.es : c.en}</h3>
              {"ayuda" in c && c.ayuda && <p className="hint" data-ayuda-del-paso>{lang === "es" ? c.ayuda.es : c.ayuda.en}</p>}
              <Respuesta paso={c} r={r} pon={pon} ctx={ctx} tienda={tienda} onElegirUno={onElegirUno} onConfirmandoFoto={onConfirmandoFoto} />
            </section>
          ))}
        </div>
      );
    case "opcion":
      return (
        <div className="ops-opciones">
          {paso.opciones.map((o) => (
            <button type="button" key={o.v} className={`ops-opcion${v === o.v ? " elegida" : ""}`} aria-pressed={v === o.v}
              onClick={() => { pon(paso.id, o.v); onElegirUno(); }} data-opcion={o.v}>{lang === "es" ? o.es : o.en}</button>
          ))}
        </div>
      );
    case "sino":
      return (
        <div className="ops-opciones ops-dos">
          {(["yes", "no"] as const).map((o) => (
            <button type="button" key={o} className={`ops-opcion${v === o ? " elegida" : ""}`} aria-pressed={v === o}
              onClick={() => { pon(paso.id, o); onElegirUno(); }} data-opcion={o}>{o === "yes" ? t("Yes", "Sí") : "No"}</button>
          ))}
        </div>
      );
    case "texto":
      return paso.corto
        ? <>
            <input className="ops-campo" value={typeof v === "string" ? v : ""} onChange={(e) => pon(paso.id, e.target.value)} autoFocus data-campo={paso.id} />
            {/* El CRMA decide si la devolución cuenta como pérdida: se ve aquí mismo al escribirlo o dejarlo vacío. */}
            {paso.id === "crma" && <Perdida r={r} />}
          </>
        : <textarea className="ops-campo" rows={5} value={typeof v === "string" ? v : ""} onChange={(e) => pon(paso.id, e.target.value)} autoFocus data-campo={paso.id}
            placeholder={t("Write what you saw", "Escribe lo que viste")} />;
    case "fecha": {
      const hoy = hoyEnTexas();
      const dia = typeof v === "string" ? v : "";
      return (
        <>
          <input type="date" className="ops-campo ops-campo-fecha" value={dia} max={hoy} required autoFocus
            onChange={(e) => pon(paso.id, e.target.value)} data-campo={paso.id} aria-label={lang === "es" ? paso.es : paso.en} />
          <div className="ops-fecha-atajos">
            <button type="button" className={`chip${dia === hoy ? " active" : ""}`} onClick={() => pon(paso.id, hoy)} data-fecha="hoy">{t("Today", "Hoy")}</button>
          </div>
          {dia !== "" && !fechaDelDanoValida(dia, hoy) && (
            <p className="ops-aviso ops-aviso-error" role="alert" data-aviso="fecha-futura">{t("The date cannot be in the future.", "La fecha no puede ser futura.")}</p>
          )}
          {dia === "" && <p className="hint">{t("Pick the day it was broken.", "Elige el día en que se rompió.")}</p>}
        </>
      );
    }
    case "personas":
    case "persona":
      return <ElegirPersonas multiple={paso.tipo === "personas"} libre={paso.tipo === "personas" && !!paso.libre} valor={v}
        onCambio={(x) => { pon(paso.id, x); if (paso.tipo === "persona") onElegirUno(); }} ctx={ctx} tienda={tienda} />;
    case "foto":
      return <Fotos fotos={fotosDe(r)} huellas={hashesDe(r)} ctx={ctx} obligatoria={!!paso.obligatoria}
        onCambio={(f, h) => { pon(paso.id, f); pon(CLAVE_HASHES, h); }} onConfirmando={onConfirmandoFoto} />;
    case "producto":
      return <ElegirProducto valor={v as ProductoElegido | undefined} ctx={ctx} onElegir={(p) => {
        pon("product", p);
        const q = r.qty as Cantidades | undefined;
        const nueva: Cantidades = { boxes: q?.boxes ?? 1, piecesPerBox: p.libre ? (q?.piecesPerBox ?? 1) : piezasPorCajaInicial(p.pieces_per_box), loosePieces: 0 };
        pon("qty", nueva);
        // El total pudo cambiar (otras piezas por caja): el reparto dañadas / muestra se vuelve a cuadrar.
        if (cantidadesValidas(nueva)) pon("split", repartoAjustado(piezasTotales(nueva), r.split as Reparto | undefined, r.scrap_type));
        if (!p.libre) onElegirUno();
      }} />;
    case "cantidad":
      return <Cantidad r={r} onCambio={(q) => pon("qty", q)} onReparto={(x) => pon("split", x)} />;
  }
}

/** `libre` (D-915): además de la lista, lo escrito en el buscador se puede agregar tal cual (alguien sin cuenta). */
function ElegirPersonas({ multiple, libre = false, valor, onCambio, ctx, tienda }: {
  multiple: boolean; libre?: boolean; valor: unknown; onCambio: (v: string | string[]) => void; ctx: Contexto; tienda: string;
}) {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const elegidos = multiple ? ((valor as string[] | undefined) ?? []) : typeof valor === "string" ? [valor] : [];
  // Solo la gente del almacén de la tienda del reporte, aunque quien llena sea admin (pedido fec8a78d).
  const lista = useMemo(() => personasParaElegir(ctx.personas, tienda, q).slice(0, 60), [ctx.personas, q, tienda]);
  const toca = (id: string) => {
    if (!multiple) return onCambio(id);
    onCambio(elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id]);
  };
  const texto = q.trim();
  const yaEscrito = texto !== "" && elegidos.some((x) => x.toLowerCase() === texto.toLowerCase());
  const agregaTexto = () => { if (texto && !yaEscrito) { toca(texto); setQ(""); } };
  return (
    <div className="ops-personas">
      <input className="ops-campo" type="search" value={q} onChange={(e) => setQ(e.target.value)} data-campo="buscar-persona"
        placeholder={libre ? t("Search by name, or write it", "Buscar por nombre, o escríbelo") : t("Search by name", "Buscar por nombre")}
        onKeyDown={libre ? (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); agregaTexto(); } } : undefined} />
      {multiple && elegidos.length > 0 && <p className="ops-elegidos">{elegidos.map((x) => nombreOTexto(ctx.personas, x)).join(", ")}</p>}
      <div className="ops-opciones">
        {libre && texto && !yaEscrito && (
          <button type="button" className="ops-opcion ops-persona" onClick={agregaTexto} data-accion="persona-libre">
            <span>{t(`Use "${texto}"`, `Usar «${texto}»`)}</span><span className="ops-persona-tienda">{t("No account", "Sin cuenta")}</span>
          </button>
        )}
        {lista.map((p) => (
          <button type="button" key={p.id} className={`ops-opcion ops-persona${elegidos.includes(p.id) ? " elegida" : ""}`} aria-pressed={elegidos.includes(p.id)} onClick={() => toca(p.id)} data-persona={p.id}>
            <span>{p.full_name}</span>{p.store && <span className="ops-persona-tienda">{p.store}</span>}
          </button>
        ))}
        {lista.length === 0 && <p className="hint">{q.trim()
          ? t("Nobody matches that name.", "Nadie coincide con ese nombre.")
          : t(`No warehouse employees in ${tienda || "this store"}.`, `No hay empleados de almacén en ${tienda || "esta tienda"}.`)}</p>}
      </div>
    </div>
  );
}

function ElegirProducto({ valor, ctx, onElegir }: { valor: ProductoElegido | undefined; ctx: Contexto; onElegir: (p: ProductoElegido) => void }) {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<ProductoElegido[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [costo, setCosto] = useState(() => (valor?.libre && valor.cost != null ? String(valor.cost) : ""));
  const [libre, setLibre] = useState(!!valor?.libre);
  const [nombreLibre, setNombreLibre] = useState(valor?.libre ? valor.name : "");
  const costoNum = costoDelCampo(costo);
  const usaLibre = (nombre: string, c: string) => {
    const n = costoDelCampo(c);
    if (nombre.trim().length >= 2 && !Number.isNaN(n)) onElegir(productoLibre(nombre, n));
  };
  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) { setLista([]); return; }
    let vivo = true;
    const id = setTimeout(async () => {
      try {
        const res = ctx.demo
          ? DEMO_PRODUCTOS.filter((p) => (p.sku + " " + p.name).toLowerCase().includes(texto.toLowerCase()))
          : await buscarProductos(createClient(), texto);
        if (vivo) { setLista(res); setError(null); }
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
      }
    }, 250);
    return () => { vivo = false; clearTimeout(id); };
  }, [q, ctx.demo]);
  return (
    <div className="ops-personas">
      <input className="ops-campo" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
        placeholder={t("Product name or SKU", "Nombre o SKU del producto")} data-campo="buscar-producto" />
      {valor && <p className="ops-elegidos" data-elegido={valor.libre ? "libre" : "catalogo"}>{valor.libre
        ? <>{valor.name} <span className="ops-fuera-de-catalogo">{t("Not in catalog", "No está en el catálogo")}</span></>
        : <>{valor.sku} · {valor.name}</>}</p>}
      {error && <p className="ops-aviso ops-aviso-error">{error}</p>}
      <div className="ops-opciones">
        {lista.map((p) => (
          <button type="button" key={p.id} className={`ops-opcion ops-producto${valor?.id === p.id ? " elegida" : ""}`} onClick={() => { setLibre(false); onElegir(p); }} data-producto={p.id}>
            <span className="ops-producto-nombre">{p.name}</span>
            <span className="ops-producto-meta">{p.sku} · {p.cost == null ? t("no price", "sin precio") : t(`${fmtMoney(p.cost)}/piece`, `${fmtMoney(p.cost)}/pieza`)}{p.pieces_per_box ? t(` · ${p.pieces_per_box} per box`, ` · ${p.pieces_per_box} por caja`) : ""}</span>
          </button>
        ))}
        {q.trim().length >= 2 && lista.length === 0 && !error && <p className="hint">{t("No product found. Try the SKU, or add it by hand below.", "No se encontró. Prueba con el SKU, o escríbelo abajo.")}</p>}
        {q.trim().length >= 2 && !libre && (
          <button type="button" className="ops-opcion ops-producto" onClick={() => { setLibre(true); setNombreLibre(q.trim()); usaLibre(q.trim(), costo); }} data-accion="producto-libre">
            <span className="ops-producto-nombre">{t(`Use "${q.trim()}"`, `Usar «${q.trim()}»`)}</span>
            <span className="ops-producto-meta">{t("Not in the catalog. A manager can fix it later.", "No está en el catálogo. Un gerente lo corrige después.")}</span>
          </button>
        )}
      </div>
      {libre && (
        <div className="ops-libre" data-libre>
          <p className="hint">{t("Not in catalog. Write the name and, if you know it, the sales price per piece. A manager can link it to the real product later.",
            "No está en el catálogo. Escribe el nombre y, si lo sabes, el precio de venta por pieza. Un gerente lo vincula al producto real después.")}</p>
          <label className="ops-cantidad"><span>{t("Product name", "Nombre del producto")}</span>
            <input className="ops-campo" value={nombreLibre} onChange={(e) => { setNombreLibre(e.target.value); usaLibre(e.target.value, costo); }} data-campo="producto-libre-nombre" />
          </label>
          <label className="ops-cantidad"><span>{t("Sales price per piece (optional)", "Precio de venta por pieza (opcional)")}</span>
            <input className="ops-campo" inputMode="decimal" value={costo} placeholder="$0.00" onChange={(e) => { setCosto(e.target.value); usaLibre(nombreLibre, e.target.value); }} data-campo="producto-libre-costo" />
          </label>
          {Number.isNaN(costoNum) && <p className="ops-aviso ops-aviso-error">{t("Write the price as a number, like 12.50.", "Escribe el precio como número, por ejemplo 12.50.")}</p>}
          <button type="button" className="ops-boton" onClick={() => setLibre(false)}>{t("Search the catalog instead", "Mejor buscar en el catálogo")}</button>
        </div>
      )}
    </div>
  );
}

/**
 * «¿Cuántas piezas?» (pedido faa07047): primero el total (cajas × piezas por caja) y luego, de esas, cuántas están
 * dañadas y cuántas sirven de muestra. Al cambiar un número el otro se llena con lo que falta; deben sumar el total.
 */
function Cantidad({ r, onCambio, onReparto }: { r: Respuestas; onCambio: (q: Cantidades) => void; onReparto: (x: Reparto) => void }) {
  const { t } = usePrefs();
  const q: Cantidades = { ...((r.qty as Cantidades | undefined) ?? { boxes: 1, piecesPerBox: 1 }), loosePieces: 0 };
  const total = cantidadesValidas(q) ? piezasTotales(q) : null;
  const guardado = r.split as Partial<Reparto> | undefined;
  const cuadra = total != null && repartoValido(total, guardado);
  // Al cambiar el total (o al abrir un borrador viejo, que solo traía «dañado» o «muestra») el reparto se cuadra solo.
  useEffect(() => {
    if (total != null && !repartoValido(total, guardado)) onReparto(repartoAjustado(total, guardado, r.scrap_type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);
  const s: Reparto = { damaged: guardado?.damaged ?? total ?? 0, sample: guardado?.sample ?? 0 };
  const num = (n: number) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  const pasoAPaso = (valor: number, min: number, max: number, pon: (n: number) => void, campo: string) => (
    <div className="ops-paso-a-paso">
      <button type="button" className="ops-boton" aria-label={t("Less", "Menos")} onClick={() => pon(Math.min(max, Math.max(min, num(valor) - 1)))}>−</button>
      <input className="ops-campo" inputMode="numeric" value={typeof valor === "number" && Number.isFinite(valor) ? String(valor) : ""} onChange={(e) => pon(enteroDelCampo(e.target.value))} onFocus={(e) => e.target.select()} data-campo={campo} />
      <button type="button" className="ops-boton" aria-label={t("More", "Más")} onClick={() => pon(Math.min(max, Math.max(min, num(valor) + 1)))}>+</button>
    </div>
  );
  const fila = (k: "boxes" | "piecesPerBox", en: string, es: string, min: number) => (
    <div className="ops-cantidad" data-cantidad={k}>
      <span>{t(en, es)}</span>
      {pasoAPaso(q[k], min, Number.MAX_SAFE_INTEGER, (n) => onCambio({ ...q, [k]: n }), k)}
    </div>
  );
  const parte = (k: keyof Reparto, en: string, es: string) => (
    <div className="ops-cantidad" data-cantidad={k}>
      <span>{t(en, es)}</span>
      {pasoAPaso(s[k], 0, total ?? 0, (n) => { if (total != null) onReparto(repartoAlCambiar(total, k, n)); }, k)}
    </div>
  );
  return (
    <div className="ops-cantidades">
      {fila("boxes", "Boxes", "Cajas", 0)}
      {fila("piecesPerBox", "Pieces per box", "Piezas por caja", 1)}
      <p className="ops-total-piezas" data-total-piezas={total ?? ""}>
        {total == null ? t("Enter at least one piece.", "Pon al menos una pieza.") : t(`Total: ${total} pieces`, `Total: ${total} piezas`)}
      </p>
      {total != null && (
        <fieldset className="ops-reparto" data-reparto={cuadra ? "ok" : "falta"}>
          <legend>{t(`Of those ${total} pieces, how many are…`, `De esas ${total} piezas, ¿cuántas…`)}</legend>
          {parte("damaged", "Damaged", "Están dañadas")}
          {parte("sample", "Can be used as sample", "Sirven de muestra")}
          {!cuadra && guardado && (
            <p className="ops-aviso ops-aviso-error" role="alert">
              {t(`Damaged + sample must add up to ${total}.`, `Dañadas + muestra deben sumar ${total}.`)}
            </p>
          )}
        </fieldset>
      )}
      <Perdida r={{ ...r, qty: q }} />
    </div>
  );
}

/**
 * Las fotos del reporte. 268: cada una lleva su SHA-256 (de los bytes que se suben, el JPEG comprimido); al agregarla
 * se pregunta a la base si otro reporte ya la usó y, si sí, se avisa con el reporte (que se abre aquí mismo, como
 * tarjeta) y se pide confirmar o quitarla. Solo aviso: no bloquea (el dueño decide después si bloquear).
 */
function Fotos({ fotos, huellas, ctx, obligatoria, onCambio, onConfirmando }: {
  fotos: string[]; huellas: string[]; ctx: Contexto; obligatoria: boolean; onCambio: (f: string[], h: string[]) => void; onConfirmando: (x: boolean) => void;
}) {
  const { t, lang } = usePrefs();
  // D-917: si la pantalla se desmonta a media lectura (o a media pregunta a la base), no se toca su estado.
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const [error, setError] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  // Por posición: los reportes que ya usaron esa foto, hasta que la confirmen («Keep it») o la quiten.
  const [repetidas, setRepetidas] = useState<Record<number, Repetida[]>>({});
  const [abierto, setAbierto] = useState<Reporte | null>(null);
  const [errorAbrir, setErrorAbrir] = useState<string | null>(null);
  const pendientes = Object.keys(repetidas).length > 0;
  useEffect(() => { onConfirmando(pendientes); }, [pendientes, onConfirmando]);
  useEffect(() => () => onConfirmando(false), [onConfirmando]);
  const dia = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? fmtDia(iso, lang) : fmtDateTime(iso));
  // D-917: `leerFotoDelTelefono` lee los bytes en el acto, decodifica con respaldo y nunca falla en silencio: el motivo
  // se enseña y va a la consola con el aparato (user agent), para saber qué falló la próxima vez.
  const agrega = async (f: File, origen: "camara" | "galeria") => {
    if (fotos.length >= MAX_FOTOS) return;
    setLeyendo(true);
    try {
      const leida = await leerFotoDelTelefono(f);
      if (!vivo.current) return;
      if (!leida.ok) {
        console.error(detalleParaConsola(leida, f, navigator.userAgent, origen));
        setError(mensajeDeFotoFallida(leida.motivo, lang, !obligatoria));
        return;
      }
      const { jpg, huella } = leida;
      const n = fotos.length;
      onCambio([...fotos, jpg], [...huellas, huella]);
      setError(null);
      // ¿Ya se usó en este mismo reporte o en otro? (en el demo no hay base que preguntar)
      const enEste = huellas.includes(huella);
      const otros = ctx.demo ? [] : await reportesConLaFoto(createClient(), huella).catch(() => [] as Repetida[]);
      if (!vivo.current) return;
      if (enEste || otros.length > 0) setRepetidas((x) => ({ ...x, [n]: otros }));
    } catch (e) {
      console.error(`[merma/foto] inesperado · origen=${origen} · ua=${navigator.userAgent}`, e);
      if (vivo.current) setError(mensajeDeFotoFallida("no-decodifica", lang, !obligatoria));
    } finally { if (vivo.current) setLeyendo(false); }
  };
  const quita = (n: number) => {
    onCambio(fotos.filter((_, m) => m !== n), huellas.filter((_, m) => m !== n));
    setRepetidas((x) => {
      const y: Record<number, Repetida[]> = {};
      for (const [k, v] of Object.entries(x)) { const m = Number(k); if (m < n) y[m] = v; else if (m > n) y[m - 1] = v; }
      return y;
    });
  };
  const confirma = (n: number) => setRepetidas((x) => { const y = { ...x }; delete y[n]; return y; });
  const abre = async (id: string) => {
    setErrorAbrir(null);
    try {
      const { data, error: e } = await createClient().from("warehouse_reports").select("*").eq("id", id).maybeSingle();
      if (e) throw e;
      if (!data) { setErrorAbrir(t("That report is not available.", "Ese reporte no está disponible.")); return; }
      setAbierto({ ...data, unit_cost: data.unit_cost == null ? null : Number(data.unit_cost), total_loss: data.total_loss == null ? null : Number(data.total_loss) } as Reporte);
    } catch (e) { setErrorAbrir(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="ops-fotos" data-fotos={fotos.length}>
      {obligatoria && fotos.length === 0 && (
        <p className="ops-foto-primero" data-foto-primero>{t("Photograph the damaged pieces before entering anything else. At least one photo is required.", "Fotografía las piezas dañadas antes de capturar lo demás. Se necesita al menos una foto.")}</p>
      )}
      <div className="ops-fotos-lista">
        {fotos.map((f, n) => (
          <figure key={n} data-repetida={repetidas[n] ? "si" : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f} alt={t(`Photo ${n + 1}`, `Foto ${n + 1}`)} />
            <button type="button" className="ops-boton" onClick={() => quita(n)}>{t("Remove", "Quitar")}</button>
          </figure>
        ))}
      </div>
      {Object.entries(repetidas).map(([k, lista]) => {
        const n = Number(k);
        const otro = lista[0];
        return (
          <div key={k} className="ops-aviso ops-aviso-error ops-aviso-repetida" role="alert" data-aviso="foto-repetida" data-foto={n}>
            <p>⚠️ {otro ? avisoDeRepetida(otro, lang, dia) : t(`Photo ${n + 1} is already in this report.`, `La foto ${n + 1} ya está en este reporte.`)}</p>
            <p className="hint">{t("Is it the same damage? Keep it. If not, remove it and take a photo of these pieces.", "¿Es el mismo daño? Déjala. Si no, quítala y toma la foto de estas piezas.")}</p>
            <div className="ops-aviso-acciones">
              {otro && !ctx.demo && <button type="button" className="ops-boton ops-boton-chico" onClick={() => void abre(otro.reporteId)} data-accion="ver-repetida">{t("View that report", "Ver ese reporte")}</button>}
              <button type="button" className="ops-boton ops-boton-chico" onClick={() => quita(n)} data-accion="quitar-repetida">{t("Remove photo", "Quitar foto")}</button>
              <button type="button" className="ops-boton ops-boton-chico ops-boton-primario" onClick={() => confirma(n)} data-accion="confirmar-repetida">{t("Keep it anyway", "Dejarla de todos modos")}</button>
            </div>
            {errorAbrir && <p className="hint">{errorAbrir}</p>}
          </div>
        );
      })}
      {fotos.length < MAX_FOTOS && (
        <BotonesDeFoto onFoto={(f, origen) => void agrega(f, origen)} leyendo={leyendo}
          etiquetaCamara={fotos.length === 0 && obligatoria ? t("Take the photo of the pieces", "Tomar la foto de las piezas") : t("Take another photo", "Tomar otra foto")} />
      )}
      {error && <p className="ops-aviso ops-aviso-error" role="alert" data-aviso="foto-fallida">{error}</p>}
      {abierto && <Tarjeta r={abierto} ctx={ctx} onCerrar={() => setAbierto(null)} onCambio={setAbierto} />}
    </div>
  );
}
