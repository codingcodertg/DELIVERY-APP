"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import {
  adjuntosDe, asomoEnLaLista, avisoDeAtendida, filtraSolicitudes, parcheDeEstado, personasDeSolicitudes, quienEscribe,
  resumenDelEnvio, separaPorEstado, listaSegunEstado, leeSolicitudes, estaEliminada, parcheDeEliminacion, sePuedeEliminar, separaEliminadas,
  type FiltroDeEstado, type SolicitudDeAyuda,
} from "@/lib/help-requests";
import { eliminaSolicitud, mensajeDeEliminar, restauraSolicitud, type ClienteDeEliminar } from "@/lib/help-eliminar";
import { ConfirmarEliminarSolicitud } from "@/components/ConfirmarEliminarSolicitud";
import { textoDelDispositivo, ubicacionDeSolicitud } from "@/lib/ayuda-ubicacion";
import { noLeidosPorSolicitud, type MensajeDeAyuda } from "@/lib/help-thread";
import { HiloDeAyuda } from "@/components/HiloDeAyuda";
import { rutaParaCopiar } from "@/lib/ayuda-para-claude";

/**
 * Las solicitudes de ayuda, en el hub y solo para el admin (D-285).
 *
 * Lo que se ve sale de `public.help_requests`, que guarda la ruta desde D-285. Quién ve qué lo decide
 * la 120, no esta pantalla: el admin lee todo y cada persona lee las suyas, así que esto no puede
 * enseñar de más aunque se equivoque.
 *
 * **Los adjuntos se firman al abrirlos**, uno a uno y por cinco minutos. Lo guardado es la clave del
 * cubo; un enlace guardado sería un enlace caducado (D-284).
 *
 * **Eliminar y restaurar (262, D-NEXT).** El admin elimina cualquiera (con confirmación, en un modal de la app); la
 * eliminada sale de Pendientes, Atendidas y Todas —y de sus contadores— y queda en Estado → «Eliminadas», con quién
 * la eliminó y cuándo, y un botón para restaurarla tal cual estaba. También salen ahí las que eliminó quien las
 * escribió. Es un borrado blando: la fila, el hilo y los adjuntos siguen guardados.
 */

export default function SolicitudesDeAyudaPage() {
  const { lang, t } = usePrefs();
  const [filas, setFilas] = useState<SolicitudDeAyuda[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  /** El filtro de estado (D-615): la lista de trabajo son las pendientes; «Atendidas» y «Todas» a un toque. */
  const [estado, setEstado] = useState<FiltroDeEstado>("pendientes");
  /** Qué pasó con el aviso al remitente en la última que se atendió. */
  const [aviso, setAviso] = useState<string | null>(null);
  /** Quién mira, para el hilo (D-311). Esta pantalla ya es solo del admin: lo decide su `layout`. */
  const [yoId, setYoId] = useState<string | null>(null);
  const [sinLeer, setSinLeer] = useState<Map<string, number>>(new Map());
  /** La que se está a punto de eliminar (el modal de confirmación), y cómo va. */
  const [porEliminar, setPorEliminar] = useState<SolicitudDeAyuda | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [errorAlEliminar, setErrorAlEliminar] = useState<string | null>(null);
  const [yoNombre, setYoNombre] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    // Con las columnas de la 262 (eliminada) y de la 258 (dónde estaba, aparato) si la base ya las tiene; si no, como
    // antes. `leeSolicitudes` cae a `leeConUbicacion(` y esta, a las columnas de siempre.
    const { data, error: e } = await leeSolicitudes((columnas) => createClient()
      .from("help_requests").select(columnas).order("created_at", { ascending: false }).limit(500));
    if (e) { setError(e.message); return; }
    setError(null);
    setFilas((data ?? []) as unknown as SolicitudDeAyuda[]);
    // Los no leídos de cada hilo (D-311). Si fallan, la lista se enseña igual.
    const supabase = createClient();
    const { data: sesion } = await supabase.auth.getUser();
    const uid = sesion.user?.id;
    if (!uid) return;
    setYoId(uid);
    // El nombre de quien mira, para pintar «eliminada por …» sin recargar. Si falla, la fila lo dice sin nombre.
    void supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle()
      .then(({ data: p }) => setYoNombre((p?.full_name as string | null | undefined) ?? null), () => undefined);
    const [{ data: ms }, { data: ls }] = await Promise.all([
      supabase.from("help_messages").select("request_id, author_id, created_at").order("created_at", { ascending: false }).limit(2000),
      supabase.from("help_reads").select("request_id, read_at").eq("user_id", uid),
    ]);
    setSinLeer(noLeidosPorSolicitud((ms ?? []) as Pick<MensajeDeAyuda, "request_id" | "author_id" | "created_at">[], (ls ?? []) as { request_id: string; read_at: string }[], uid));
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(
    () => filtraSolicitudes(filas ?? [], { persona: persona || undefined, desde: desde || undefined, hasta: hasta || undefined }),
    [filas, persona, desde, hasta],
  );
  // Las atendidas salen de la lista principal y se van al archivo, que se abre a propósito. Antes
  // estaban mezcladas y la única forma de quitarlas de en medio era una casilla que había que marcar
  // cada vez.
  // Las eliminadas (262) se apartan ANTES de separar por estado: una pendiente eliminada ya no es trabajo pendiente,
  // y no cuenta ni en la pastilla de arriba ni en los números del filtro.
  const { vivas, eliminadas } = useMemo(() => separaEliminadas(visibles), [visibles]);
  const { pendientes, atendidas } = useMemo(() => separaPorEstado(vivas), [vivas]);
  const listadas = useMemo(() => listaSegunEstado(estado, { pendientes, atendidas, eliminadas }), [estado, pendientes, atendidas, eliminadas]);
  /** ¿La base ya tiene la 262? Sin ella no hay ni botón de eliminar ni filtro de eliminadas. */
  const hayEliminacion = useMemo(() => (filas ?? []).some(sePuedeEliminar), [filas]);
  const personas = useMemo(() => personasDeSolicitudes(filas ?? []), [filas]);

  /**
   * Avisar a quien la escribió, DESPUÉS de haber guardado el estado.
   *
   * El orden importa: atenderla es el registro y el aviso va encima. Si el aviso falla, la solicitud
   * sigue atendida y la pantalla lo dice — como hace la 120 con el correo, que se anota pero no
   * deshace la fila.
   *
   * **La fila se inserta sin pedirla de vuelta.** `notif read own` (001) deja leer solo las propias, y
   * un `insert(...).select(...)` obliga a Postgres a leer la fila recién escrita —que es de otra
   * persona— para devolverla. Por eso aquí no se encadena `.select()`, igual que hacen los avisos de
   * etapa (`emitStageNotifs`). Sin id de vuelta no se puede llamar a `/api/push`, así que este aviso
   * es de campana; mandarlo también al teléfono pide una ruta de servidor que inserte y empuje con la
   * llave de servicio, y eso no es esta rama.
   */
  const avisaAlRemitente = async (supabase: ReturnType<typeof createClient>, s: SolicitudDeAyuda, adminId: string) => {
    const semilla = avisoDeAtendida(s, adminId);
    if (!semilla) {
      setAviso(s.user_id
        ? t("Handled — you wrote it yourself, so there's nobody to notify.", "Atendida — la escribiste tú, así que no hay a quién avisar.")
        : t("Handled — that account no longer exists, so there was nobody to notify.", "Atendida — sin cuenta a la que avisar: esa cuenta ya no existe."));
      return;
    }
    const { error: e } = await supabase.from("notifications").insert([semilla]);
    setAviso(e
      ? t("Handled, but the sender couldn't be notified.", "Atendida, pero no se pudo avisar a quien la escribió.")
      : t("Handled — the sender was notified.", "Atendida — se avisó a quien la escribió."));
  };

  const marca = async (s: SolicitudDeAyuda) => {
    const supabase = createClient();
    const { data: sesion } = await supabase.auth.getUser();
    if (!sesion.user) return;
    setOcupada(s.id);
    setAviso(null);
    const atiende = s.status !== "atendida";
    const parche = parcheDeEstado(atiende ? "atendida" : "pendiente", sesion.user.id, new Date());
    // Con `select`: un UPDATE que la política no deja pasar vuelve limpio y con cero filas, y eso no
    // es haber guardado.
    const { data, error: e } = await supabase.from("help_requests").update(parche).eq("id", s.id).select("id");
    if (e || !data || data.length !== 1) {
      setOcupada(null);
      setError(e?.message ?? t("Couldn't change it.", "No se pudo cambiar."));
      return;
    }
    setFilas((prev) => (prev ?? []).map((x) => (x.id === s.id ? { ...x, ...parche } : x)));
    // Solo al atenderla: devolverla a pendiente no es una noticia para quien la escribió.
    if (atiende) await avisaAlRemitente(supabase, s, sesion.user.id);
    setOcupada(null);
  };

  const cierraElModal = useCallback(() => { setPorEliminar(null); setErrorAlEliminar(null); }, []);

  /** Eliminar, ya confirmado en el modal. La base anota quién y cuándo; aquí se pinta sin recargar la lista. */
  const elimina = async () => {
    const s = porEliminar;
    if (!s || eliminando) return;
    setEliminando(true);
    setErrorAlEliminar(null);
    const r = await eliminaSolicitud(createClient() as unknown as ClienteDeEliminar, s.id);
    setEliminando(false);
    const fallo = mensajeDeEliminar(r, t);
    if (fallo) { setErrorAlEliminar(fallo); return; }
    setFilas((prev) => (prev ?? []).map((x) => (x.id === s.id ? { ...x, ...parcheDeEliminacion(true, { id: yoId ?? "", nombre: yoNombre }, new Date().toISOString()) } : x)));
    if (abierta === s.id) setAbierta(null);
    setPorEliminar(null);
    setAviso(t("Deleted. It's under Status → Deleted if you need it back.", "Eliminada. Está en Estado → Eliminadas por si hace falta restaurarla."));
  };

  /** Restaurar no pide confirmación: no pierde nada y se deshace volviendo a eliminar. */
  const restaura = async (s: SolicitudDeAyuda) => {
    setOcupada(s.id);
    setAviso(null);
    const r = await restauraSolicitud(createClient() as unknown as ClienteDeEliminar, s.id);
    setOcupada(null);
    const fallo = mensajeDeEliminar(r, t, "restaurar");
    if (fallo) { setError(fallo); return; }
    setError(null);
    setFilas((prev) => (prev ?? []).map((x) => (x.id === s.id ? { ...x, ...parcheDeEliminacion(false, { id: "", nombre: null }, "") } : x)));
    setAviso(s.status === "atendida"
      ? t("Restored — it's back under Handled.", "Restaurada — vuelve a estar en Atendidas.")
      : t("Restored — it's back under Pending.", "Restaurada — vuelve a estar en Pendientes."));
  };

  const fecha = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US");

  /** Una solicitud, igual en la lista de trabajo y en el archivo: la misma tarjeta, no dos parecidas. */
  const tarjeta = (s: SolicitudDeAyuda) => {
    const adjuntos = adjuntosDe(s);
    const abiertaEsta = abierta === s.id;
    const asomo = asomoEnLaLista(s.message);
    // Dónde estaba (D-901): lo que guardó la app al mandarla; en una solicitud de antes, lo que se deduce de su ruta.
    const donde = ubicacionDeSolicitud(s, lang === "es" ? "es" : "en");
    const aparato = textoDelDispositivo(s.device, lang === "es" ? "es" : "en");
    const eliminada = estaEliminada(s);
    return (
      <div className="card" key={s.id} data-solicitud-eliminada={eliminada ? "si" : undefined}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <b>{quienEscribe(s)}</b>
          {s.role_label && <span className="hint" style={{ margin: 0 }}>{s.role_label}</span>}
          <span className="hint" style={{ margin: 0 }}>{fecha(s.created_at)}</span>
          <span className="sema" style={{ background: s.status === "atendida" ? "var(--green)" : "var(--amber)", color: "#fff" }}>
            {s.status === "atendida" ? t("Handled", "Atendida") : t("Pending", "Pendiente")}
          </span>
          {eliminada && <span className="sema" style={{ background: "var(--gray)", color: "#fff" }}>🗑 {t("Deleted", "Eliminada")}</span>}
          {adjuntos.length > 0 && <span className="hint" style={{ margin: 0 }}>📎 {adjuntos.length}</span>}
          {(sinLeer.get(s.id) ?? 0) > 0 && !abiertaEsta && !eliminada && (
            <span className="sema" style={{ background: "var(--red)", color: "#fff" }}>💬 {sinLeer.get(s.id)}</span>
          )}
          <span style={{ flex: 1 }} />
          {/* «Copiar para Claude» (D-844): la misma pantalla a la que lleva el botón del correo. */}
          <Link href={rutaParaCopiar(s.id)} className="btn btn-ghost btn-sm" data-copiar-para-claude>📋 {t("Copy for Claude", "Copiar para Claude")}</Link>
          <button className="btn btn-ghost btn-sm" onClick={() => { setAbierta(abiertaEsta ? null : s.id); if (!abiertaEsta) setSinLeer((m) => { const c = new Map(m); c.delete(s.id); return c; }); }}>
            {abiertaEsta ? t("Hide", "Ocultar") : t("Open", "Abrir")}
          </button>
          {/* Una eliminada no se atiende ni se reabre (la 262 tampoco deja): lo único que se le hace es restaurarla. */}
          {eliminada ? (
            <button className="btn btn-primary btn-sm" disabled={ocupada === s.id} onClick={() => void restaura(s)} data-restaurar-solicitud>
              ↩ {t("Restore", "Restaurar")}
            </button>
          ) : (
            <>
              <button className="btn btn-primary btn-sm" disabled={ocupada === s.id} onClick={() => marca(s)}>
                {s.status === "atendida" ? t("Mark pending", "Marcar pendiente") : t("Mark handled", "Marcar atendida")}
              </button>
              {sePuedeEliminar(s) && (
                <button className="btn btn-ghost btn-sm" disabled={ocupada === s.id} data-eliminar-solicitud title={t("Delete this request", "Eliminar esta solicitud")}
                  onClick={() => { setErrorAlEliminar(null); setPorEliminar(s); }}>
                  🗑 {t("Delete", "Eliminar")}
                </button>
              )}
            </>
          )}
        </div>
        {eliminada && s.deleted_at && (
          <div className="hint" style={{ margin: "6px 0 0" }} data-eliminada-por>
            {t("Deleted by", "Eliminada por")} <b>{s.deleted_by_name || (s.deleted_by && s.deleted_by === s.user_id ? quienEscribe(s) : "—")}</b>
            {s.deleted_by && s.deleted_by === s.user_id ? ` (${t("the sender", "quien la escribió")})` : ""} · {fecha(s.deleted_at)}
          </div>
        )}
        {/* Dónde estaba, SIEMPRE a la vista (D-901; el dueño: «to know what they are looking at when they don't send a
            screenshot»): en la lista y con la solicitud abierta. */}
        {donde && (
          <div className="ubicacion-solicitud" data-ubicacion-solicitud data-ubicacion-guardada={donde.guardada ? "si" : "no"}
            title={donde.guardada ? undefined : t("Worked out from the page address (older request)", "Deducido de la dirección de la página (solicitud anterior)")}>
            <span aria-hidden>📍</span> {donde.texto}
          </div>
        )}
        {/* De qué va, sin abrirla (D-624, 2026-10-21; Roberto: «showed a bit of the sentence […] without having to open
            1 by 1»). Una línea, cortada con «…»; abierta, el mensaje entero está en la conversación de abajo. Pulsarla
            abre la solicitud, como «Abrir». */}
        {!abiertaEsta && (
          <button type="button" className="asomo-solicitud" data-asomo-solicitud
            onClick={() => { setAbierta(s.id); setSinLeer((m) => { const c = new Map(m); c.delete(s.id); return c; }); }}
            title={t("Open", "Abrir")}>
            {asomo ?? <span className="hint" style={{ margin: 0 }}>📷 {t("Screenshot only, no text", "Solo captura, sin texto")}</span>}
          </button>
        )}

        {abiertaEsta && (
          <>
            {/* La conversación (D-311): la solicitud original es su primer mensaje, con sus adjuntos,
                y debajo la caja para contestar. Que conteste el admin no la reabre ni la atiende:
                atenderla sigue siendo el botón de arriba. Si la persona contesta a una atendida, la
                base la devuelve a pendiente y aquí aparece otra vez en la lista de trabajo al recargar. */}
            {yoId && <HiloDeAyuda solicitud={s} yo={{ id: yoId, esAdmin: true }} soloLectura={eliminada} />}
            <div className="detail-row"><span className="dk">{t("Where", "Dónde")}</span><span className="dv"><b>{donde?.texto ?? "—"}</b></span></div>
            <div className="detail-row"><span className="dk">{t("Page", "Página")}</span><span className="dv">{s.page || "—"}</span></div>
            {aparato && (
              <div className="detail-row" data-dispositivo-solicitud><span className="dk">{t("Device", "Dispositivo")}</span><span className="dv hint" style={{ margin: 0 }}>{aparato}</span></div>
            )}
            <div className="detail-row"><span className="dk">{t("Version", "Versión")}</span><span className="dv">{s.app_version || "—"}</span></div>
            <div className="detail-row"><span className="dk">{t("Email", "Correo")}</span><span className="dv">{resumenDelEnvio(s, t)}</span></div>
            {s.attended_at && (
              <div className="detail-row"><span className="dk">{t("Handled at", "Atendida el")}</span><span className="dv">{fecha(s.attended_at)}</span></div>
            )}
            {/* Quien la escribió ya no tiene cuenta: no hubo a quién avisar, y eso se dice aquí en vez
                de dejar creer que se avisó. */}
            {s.status === "atendida" && !s.user_id && (
              <div className="detail-row">
                <span className="dk">{t("Notice", "Aviso")}</span>
                <span className="dv">{t("That account no longer exists — nobody was notified.", "Esa cuenta ya no existe — no se avisó a nadie.")}</span>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="page-head">
        <h2>🆘 {t("Help requests", "Solicitudes de ayuda")}</h2>
        {/* El número que antes iba en la casilla «solo pendientes»: cuántas esperan, de lo que se ve. */}
        {pendientes.length > 0 && (
          <span className="sema" style={{ background: "var(--amber)", color: "#fff" }}>
            {pendientes.length} {t("pending", "pendientes")}
          </span>
        )}
        <Link href="/home" className="btn btn-ghost btn-sm">{t("Back to hub", "Volver al hub")}</Link>
      </div>

      <div className="card">
        <div className="grid g3">
          <div className="field">
            <label>{t("Person", "Persona")}</label>
            <select value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value="">{t("Everyone", "Todas")}</option>
              {personas.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{t("From", "Desde")}</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="field">
            <label>{t("To", "Hasta")}</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <div className="field">
            <label>{t("Status", "Estado")}</label>
            <select value={estado} onChange={(e) => setEstado(e.target.value as FiltroDeEstado)} data-filtro-estado>
              <option value="pendientes">{t("Pending", "Pendientes")} ({pendientes.length})</option>
              <option value="atendidas">{t("Handled", "Atendidas")} ({atendidas.length})</option>
              <option value="todas">{t("All", "Todas")} ({vivas.length})</option>
              {/* «Show deleted» (262, D-NEXT): las eliminadas solo salen si se piden. */}
              {hayEliminacion && <option value="eliminadas">🗑 {t("Show deleted", "Ver eliminadas")} ({eliminadas.length})</option>}
            </select>
          </div>
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: "var(--red)" }}><b style={{ color: "var(--red)" }}>{error}</b></div>}
      {aviso && <div className="card"><b>{aviso}</b></div>}

      {filas === null ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : visibles.length === 0 ? (
        <div className="empty">{t("No help requests with these filters.", "No hay solicitudes con estos filtros.")}</div>
      ) : (
        <>
          {listadas.length === 0
            ? <div className="empty">{estado === "pendientes" ? t("Nothing pending 🎉", "Nada pendiente 🎉") : t("Nothing here", "Nada aquí")}</div>
            : listadas.map(tarjeta)}

        </>
      )}

      {porEliminar && (
        <ConfirmarEliminarSolicitud solicitud={porEliminar} comoAdmin ocupado={eliminando} error={errorAlEliminar}
          onCancelar={cierraElModal} onConfirmar={() => void elimina()} />
      )}
    </>
  );
}
