"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { CUBO_DE_ADJUNTOS, LIMITES_DE_ADJUNTOS, mensajeDeAdjunto, validaAdjuntos } from "@/lib/help-attachments";
import { subeAdjuntosDeAyuda } from "@/lib/help-send";
import type { SolicitudDeAyuda } from "@/lib/help-requests";
import {
  cuerpoDelMensaje, hiloCompleto, ladoDelAutor, LIMITE_DEL_MENSAJE, participaEnElHilo, puedeAdjuntar,
  reabreAlContestar, type MensajeDeAyuda,
} from "@/lib/help-thread";

/**
 * El hilo de una solicitud de ayuda: lo que se ha dicho y la caja para contestar (D-311).
 *
 * El mismo componente en «Mis solicitudes» y en la vista del admin; quién es quién llega por props,
 * así no depende del `DataProvider` de Entregas, que el hub no monta.
 *
 * **Tiempo real: un canal por hilo ABIERTO**, filtrado por su `request_id`, que se cierra al cerrar el
 * hilo. Nada global. Y una red de seguridad por si el canal no llega: se recarga al abrir, al enviar y
 * al volver a la pestaña.
 */

const COLUMNAS = "id, request_id, author_id, author_name, body, files, created_at";
/** Cinco minutos: lo que tarda en abrirse una foto, no más (como la vista del admin). */
const VALIDEZ_AL_ABRIR = 300;

export function HiloDeAyuda({ solicitud, yo, onEnviado }: {
  solicitud: SolicitudDeAyuda;
  yo: { id: string; esAdmin: boolean };
  /** Tras enviar. `reabierta` = la base acaba de devolverla a pendiente: quien pinta la lista lo refleja. */
  onEnviado?: (info: { reabierta: boolean }) => void;
}) {
  const { lang, t } = usePrefs();
  const supabase = useMemo(() => createClient(), []);
  const [mensajes, setMensajes] = useState<MensajeDeAyuda[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [escrito, setEscrito] = useState("");
  const [ficheros, setFicheros] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const fondo = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("help_messages").select(COLUMNAS).eq("request_id", solicitud.id).order("created_at", { ascending: true });
    if (e) { setError(e.message); return; }
    setError(null);
    setMensajes((data ?? []) as MensajeDeAyuda[]);
    // Leído hasta ahora. La hora la pone la base (126), no este reloj. Si falla no se dice nada: es un
    // contador, y volverá a intentarse la próxima vez que se abra.
    await supabase.from("help_reads").upsert({ request_id: solicitud.id, user_id: yo.id }, { onConflict: "request_id,user_id" });
  }, [supabase, solicitud.id, yo.id]);

  useEffect(() => {
    void cargar();
    const canal = supabase
      .channel(`help-thread:${solicitud.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "help_messages", filter: `request_id=eq.${solicitud.id}` }, () => { void cargar(); })
      .subscribe();
    const alVolver = () => { if (document.visibilityState === "visible") void cargar(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      void supabase.removeChannel(canal);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [supabase, solicitud.id, cargar]);

  const hilo = useMemo(() => hiloCompleto(solicitud, mensajes ?? []), [solicitud, mensajes]);
  useEffect(() => { fondo.current?.scrollIntoView({ block: "nearest" }); }, [hilo.length]);

  const abreAdjunto = async (path: string) => {
    const { data, error: e } = await supabase.storage.from(CUBO_DE_ADJUNTOS).createSignedUrl(path, VALIDEZ_AL_ABRIR);
    if (e || !data?.signedUrl) { setError(e?.message ?? t("Couldn't open the file.", "No se pudo abrir el archivo.")); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const eligeFicheros = (lista: FileList | null) => {
    const juntos = [...ficheros, ...(lista ?? [])];
    const fallo = validaAdjuntos(juntos);
    if (fallo) { setError(mensajeDeAdjunto(fallo, t)); return; }
    setError(null);
    setFicheros(juntos);
  };

  const enviar = async () => {
    const cuerpo = cuerpoDelMensaje(escrito);
    if (!cuerpo.ok || enviando) return;
    setEnviando(true);
    setError(null);
    const adjunta = puedeAdjuntar(yo.id, solicitud);
    const subida = adjunta ? await subeAdjuntosDeAyuda(yo.id, ficheros) : { subidos: [] };
    if ("fallo" in subida) {
      setError(t(`Couldn't upload “${subida.fallo}”. Nothing was sent.`, `No se pudo subir «${subida.fallo}». No se envió nada.`));
      setEnviando(false);
      return;
    }
    // El id nace aquí y no se pide de vuelta. Cuando escribe el admin, la base usa ESTE id para el
    // aviso de la campana (126), y con él se pide el push: nadie tiene que devolvernos una fila de
    // `notifications` que es de otra persona y que no podríamos leer (D-308). Sin `randomUUID`
    // (navegador viejo) el id lo pone la base y no se empuja; la campana llega igual.
    const id = globalThis.crypto?.randomUUID?.();
    const fila = { request_id: solicitud.id, author_id: yo.id, body: cuerpo.body, files: subida.subidos };
    const { error: e } = await supabase.from("help_messages").insert([id ? { id, ...fila } : fila]);
    if (e) { setError(e.message); setEnviando(false); return; }
    if (id && ladoDelAutor(yo.id, solicitud) === "admin" && solicitud.user_id) {
      void fetch("/api/push", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_id: id }),
      }).catch(() => undefined);
    }
    setEscrito("");
    setFicheros([]);
    setEnviando(false);
    onEnviado?.({ reabierta: reabreAlContestar(yo.id, solicitud) });
    await cargar();
  };

  const fecha = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US");
  const puede = participaEnElHilo(yo, solicitud);
  const resto = LIMITE_DEL_MENSAJE - escrito.trim().length;

  return (
    <div className="hilo-ayuda">
      <div className="hilo-mensajes">
        {hilo.map((m) => {
          const mio = m.author_id === yo.id;
          return (
            <div key={m.id} className={"hilo-msg " + (mio ? "mio" : "suyo")}>
              <div className="hilo-meta">
                <b>{mio ? t("You", "Tú") : (m.author_name || (ladoDelAutor(m.author_id, solicitud) === "admin" ? t("Support", "Soporte") : "—"))}</b>
                <span>{fecha(m.created_at)}</span>
              </div>
              <div className="hilo-cuerpo">{m.body}</div>
              {(m.files ?? []).length > 0 && (
                <div className="hilo-adjuntos">
                  {(m.files ?? []).map((a) => (
                    <button key={a.path} className="btn btn-ghost btn-sm" onClick={() => abreAdjunto(a.path)}>
                      📎 {a.nombre || a.path.split("/").pop()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {mensajes === null && !error && <div className="hint">{t("Loading…", "Cargando…")}</div>}
        <div ref={fondo} />
      </div>

      {error && <div className="hint" style={{ color: "var(--red)" }}>{error}</div>}

      {puede && (
        <div className="hilo-caja">
          <textarea
            rows={2}
            value={escrito}
            disabled={enviando}
            onChange={(e) => setEscrito(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void enviar(); } }}
            placeholder={solicitud.status === "atendida" && reabreAlContestar(yo.id, solicitud)
              ? t("Reply — this will reopen the request", "Responder — esto reabre la solicitud")
              : t("Write a reply…", "Escribe una respuesta…")}
          />
          <div className="hilo-acciones">
            {puedeAdjuntar(yo.id, solicitud) && (
              <label className="btn btn-ghost btn-sm" style={{ margin: 0 }}>
                📎 {ficheros.length > 0 ? ficheros.length : ""}
                <input type="file" multiple hidden accept={LIMITES_DE_ADJUNTOS.tipos.join(",")} disabled={enviando}
                  onChange={(e) => { eligeFicheros(e.target.files); e.target.value = ""; }} />
              </label>
            )}
            {ficheros.length > 0 && (
              <button className="btn btn-ghost btn-sm" disabled={enviando} onClick={() => setFicheros([])}>✕ {t("Remove files", "Quitar archivos")}</button>
            )}
            <span style={{ flex: 1 }} />
            {resto < 200 && <span className="hint" style={{ margin: 0, color: resto < 0 ? "var(--red)" : undefined }}>{resto}</span>}
            <button className="btn btn-primary btn-sm" disabled={enviando || !cuerpoDelMensaje(escrito).ok} onClick={() => void enviar()}>
              {enviando ? t("Sending…", "Enviando…") : t("Send", "Enviar")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
