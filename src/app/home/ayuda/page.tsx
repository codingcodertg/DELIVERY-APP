"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BotonCasa } from "@/components/BotonCasa";
import { usePrefs } from "@/lib/prefs";
import { clienteDelHub as createClient } from "@/lib/home/cliente-del-hub";
import { APP_VERSIONS } from "@/lib/app-versions";
import { roleLabel } from "@/lib/constants";
import { LIMITES_DE_ADJUNTOS, mensajeDeAdjunto, validaAdjuntos } from "@/lib/help-attachments";
import { asomoDelMensaje, leeSolicitudes, sePuedeEliminar, separaEliminadas, type SolicitudDeAyuda } from "@/lib/help-requests";
import { eliminaSolicitud, mensajeDeEliminar, type ClienteDeEliminar } from "@/lib/help-eliminar";
import { ConfirmarEliminarSolicitud } from "@/components/ConfirmarEliminarSolicitud";
import { enviaSolicitudDeAyuda } from "@/lib/help-send";
import { noLeidosPorSolicitud, RUTA_MIS_SOLICITUDES, type MensajeDeAyuda } from "@/lib/help-thread";
import { HiloDeAyuda } from "@/components/HiloDeAyuda";
import type { UserRole } from "@/lib/types";

/**
 * «Mis solicitudes»: lo que cada persona ha pedido por el botón de ayuda, con su conversación (D-311).
 *
 * Hasta ahora no había ningún sitio donde verlas: la RLS de la 120 dejaba leer las propias, pero
 * ninguna pantalla las listaba. Vive en el hub y no en cada app porque la cuenta es una (el hub
 * centraliza lo que es de la persona y no de un módulo), y por eso lee lo que necesita por consulta
 * directa, sin el `DataProvider` de Entregas.
 *
 * Solo las PROPIAS, también para un admin: aquí el admin es una persona que pidió ayuda. Las de todos
 * las ve en su vista de solicitudes.
 *
 * **Eliminar (262, D-904).** Roberto, desde esta pantalla: «Maybe add option to eliminate request» — había escrito
 * una, luego «Disregard this request», y no tenía cómo retirarla. Cada tarjeta lleva «Eliminar»; se confirma en un
 * modal de la app y la solicitud sale de la lista, en el estado que esté. No se borra: queda guardada (la base
 * anota quién y cuándo) y un admin puede restaurarla. Quién puede lo decide la 262, no esta pantalla.
 */

type Yo = { id: string; esAdmin: boolean; nombre: string | null; role: UserRole };

export default function MisSolicitudesPage() {
  const { lang, t } = usePrefs();
  const supabase = useMemo(() => createClient(), []);
  const [yo, setYo] = useState<Yo | null>(null);
  const [filas, setFilas] = useState<SolicitudDeAyuda[] | null>(null);
  const [sinLeer, setSinLeer] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [ficheros, setFicheros] = useState<File[]>([]);
  const [ocupada, setOcupada] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  /** La que se está a punto de eliminar (el modal de confirmación), y cómo va. */
  const [porEliminar, setPorEliminar] = useState<SolicitudDeAyuda | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [errorAlEliminar, setErrorAlEliminar] = useState<string | null>(null);

  const cargar = useCallback(async (abrirLaPrimeraSinLeer = false) => {
    const { data: sesion } = await supabase.auth.getUser();
    if (!sesion.user) return;
    const uid = sesion.user.id;
    const { data: perfil } = await supabase.from("profiles").select("role, full_name").eq("id", uid).maybeSingle();
    const role = ((perfil?.role as UserRole | undefined) ?? "sales");
    setYo({ id: uid, esAdmin: role === "admin", nombre: (perfil?.full_name as string | null) ?? null, role });

    // Con las columnas de la 262 (eliminada) y de la 258 si la base ya las tiene; si no, como antes.
    const { data, error: e } = await leeSolicitudes((columnas) => supabase
      .from("help_requests").select(columnas).eq("user_id", uid).order("created_at", { ascending: false }).limit(200));
    if (e) { setError(e.message); return; }
    setError(null);
    // Las eliminadas no se listan ni cuentan. Se filtran aquí y no en la consulta: la RLS deja leer las propias
    // (también las eliminadas), y así la misma consulta vale con y sin la 262.
    const mias = separaEliminadas((data ?? []) as unknown as SolicitudDeAyuda[]).vivas;
    setFilas(mias);

    // Los contadores. Si esto falla la lista se enseña igual: un contador no tumba la pantalla.
    const ids = mias.map((s) => s.id);
    if (!ids.length) { setSinLeer(new Map()); return; }
    const [{ data: ms }, { data: ls }] = await Promise.all([
      supabase.from("help_messages").select("request_id, author_id, created_at").in("request_id", ids),
      supabase.from("help_reads").select("request_id, read_at").eq("user_id", uid).in("request_id", ids),
    ]);
    const mapa = noLeidosPorSolicitud((ms ?? []) as Pick<MensajeDeAyuda, "request_id" | "author_id" | "created_at">[], (ls ?? []) as { request_id: string; read_at: string }[], uid);
    setSinLeer(mapa);
    // Quien llega desde la campana viene a leer una respuesta: se le abre la primera que la tenga.
    if (abrirLaPrimeraSinLeer) {
      const primera = mias.find((s) => mapa.has(s.id));
      if (primera) setAbierta(primera.id);
    }
  }, [supabase]);

  useEffect(() => { void cargar(true); }, [cargar]);

  const eligeFicheros = (lista: FileList | null) => {
    const juntos = [...ficheros, ...(lista ?? [])];
    const fallo = validaAdjuntos(juntos);
    if (fallo) { setAviso(mensajeDeAdjunto(fallo, t)); return; }
    setFicheros(juntos);
  };

  const enviaNueva = async () => {
    const texto = mensaje.trim();
    if (!texto || !yo || ocupada) return;
    // El demo (D-940) no envía ni sube nada.
    if (process.env.NEXT_PUBLIC_LOCAL_MODE === "true") { setAviso(t("Not available in the demo.", "No disponible en el demo.")); return; }
    setOcupada(true);
    setAviso(null);
    // A dónde va el correo lo decide el servidor con Ajustes (D-530, `destinoDeAyuda`): aquí se leía
    // `settings` con la sesión, y quien no tiene Entregas no puede leerla, así que su solicitud se iba a la
    // dirección por defecto.
    const r = await enviaSolicitudDeAyuda({
      userId: yo.id, message: texto, ficheros, page: RUTA_MIS_SOLICITUDES, senderName: yo.nombre,
      role: roleLabel(yo.role, lang),
      // El hub se versiona con Entregas (D-087).
      appVersion: APP_VERSIONS.deliveries,
      lang,
    });
    setOcupada(false);
    if (r.tipo === "enviada" || r.tipo === "sin-correo") {
      // Sin correo configurado la solicitud queda guardada igual (D-285), y aquí se ve: es lo que importa.
      setMensaje(""); setFicheros([]); setNueva(false);
      setAviso(t("Request sent. Replies will show up here.", "Solicitud enviada. Las respuestas aparecerán aquí."));
      await cargar();
    } else if (r.tipo === "subida") {
      setAviso(t(`Couldn't upload “${r.fichero}”. Nothing was sent.`, `No se pudo subir «${r.fichero}». No se envió nada.`));
    } else {
      setAviso(t("Couldn't send — please try again.", "No se pudo enviar — intente de nuevo."));
    }
  };

  const cierraElModal = useCallback(() => { setPorEliminar(null); setErrorAlEliminar(null); }, []);

  const elimina = async () => {
    const s = porEliminar;
    if (!s || eliminando) return;
    setEliminando(true);
    setErrorAlEliminar(null);
    const r = await eliminaSolicitud(supabase as unknown as ClienteDeEliminar, s.id);
    setEliminando(false);
    const fallo = mensajeDeEliminar(r, t);
    // Si falla, el modal se queda abierto y lo dice: la solicitud sigue en la lista.
    if (fallo) { setErrorAlEliminar(fallo); return; }
    setFilas((prev) => (prev ?? []).filter((x) => x.id !== s.id));
    setSinLeer((m) => { const c = new Map(m); c.delete(s.id); return c; });
    if (abierta === s.id) setAbierta(null);
    setPorEliminar(null);
    setAviso(t("Request deleted.", "Solicitud eliminada."));
  };

  const fecha = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US");
  const total = [...sinLeer.values()].reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="page-head">
        <h2>💬 {t("My help requests", "Mis solicitudes de ayuda")}</h2>
        {total > 0 && <span className="sema" style={{ background: "var(--amber)", color: "#fff" }}>{total} {t("unread", "sin leer")}</span>}
        <button className="btn btn-primary btn-sm" onClick={() => setNueva((v) => !v)}>+ {t("New request", "Nueva solicitud")}</button>
        <BotonCasa />
      </div>

      {nueva && (
        <div className="card">
          <textarea rows={4} autoFocus value={mensaje} disabled={ocupada} onChange={(e) => setMensaje(e.target.value)}
            placeholder={t("What do you need help with?", "¿En qué necesita ayuda?")} style={{ width: "100%", resize: "vertical" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <label className="btn btn-ghost btn-sm" style={{ margin: 0 }}>
              📎 {t("Photos or documents", "Fotos o documentos")}{ficheros.length > 0 ? ` (${ficheros.length})` : ""}
              <input type="file" multiple hidden accept={LIMITES_DE_ADJUNTOS.tipos.join(",")} disabled={ocupada}
                onChange={(e) => { eligeFicheros(e.target.files); e.target.value = ""; }} />
            </label>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" disabled={ocupada} onClick={() => { setNueva(false); setMensaje(""); setFicheros([]); }}>{t("Cancel", "Cancelar")}</button>
            <button className="btn btn-primary btn-sm" disabled={ocupada || !mensaje.trim()} onClick={() => void enviaNueva()}>
              {ocupada ? t("Sending…", "Enviando…") : t("Send", "Enviar")}
            </button>
          </div>
        </div>
      )}

      {error && <div className="card" style={{ borderColor: "var(--red)" }}><b style={{ color: "var(--red)" }}>{error}</b></div>}
      {aviso && <div className="card"><b>{aviso}</b></div>}

      {filas === null ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : filas.length === 0 ? (
        <div className="empty">{t("You haven't asked for help yet.", "Todavía no has pedido ayuda.")}</div>
      ) : filas.map((s) => {
        const abiertaEsta = abierta === s.id;
        const n = sinLeer.get(s.id) ?? 0;
        return (
          <div className="card" key={s.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <b style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{asomoDelMensaje(s.message)}</b>
              <span className="hint" style={{ margin: 0 }}>{fecha(s.created_at)}</span>
              <span className="sema" style={{ background: s.status === "atendida" ? "var(--green)" : "var(--amber)", color: "#fff" }}>
                {s.status === "atendida" ? t("Handled", "Atendida") : t("Open", "Abierta")}
              </span>
              {n > 0 && !abiertaEsta && <span className="sema" style={{ background: "var(--red)", color: "#fff" }}>{n} {t("new", n === 1 ? "nueva" : "nuevas")}</span>}
              <span style={{ flex: 1 }} />
              <button className="btn btn-ghost btn-sm" onClick={() => { setAbierta(abiertaEsta ? null : s.id); if (!abiertaEsta) setSinLeer((m) => { const c = new Map(m); c.delete(s.id); return c; }); }}>
                {abiertaEsta ? t("Hide", "Ocultar") : t("Open", "Abrir")}
              </button>
              {/* Eliminar (262, D-904), en cualquier estado. Sin la 262 aplicada no hay a qué llamar: no se enseña. */}
              {sePuedeEliminar(s) && (
                <button className="btn btn-ghost btn-sm" data-eliminar-solicitud title={t("Delete this request", "Eliminar esta solicitud")}
                  onClick={() => { setErrorAlEliminar(null); setPorEliminar(s); }}>
                  🗑 {t("Delete", "Eliminar")}
                </button>
              )}
            </div>
            {abiertaEsta && yo && (
              <HiloDeAyuda
                solicitud={s}
                yo={yo}
                onEnviado={({ reabierta }) => {
                  if (reabierta) setFilas((prev) => (prev ?? []).map((x) => (x.id === s.id ? { ...x, status: "pendiente", attended_by: null, attended_at: null } : x)));
                }}
              />
            )}
          </div>
        );
      })}

      {porEliminar && (
        <ConfirmarEliminarSolicitud solicitud={porEliminar} ocupado={eliminando} error={errorAlEliminar}
          onCancelar={cierraElModal} onConfirmar={() => void elimina()} />
      )}
    </>
  );
}
