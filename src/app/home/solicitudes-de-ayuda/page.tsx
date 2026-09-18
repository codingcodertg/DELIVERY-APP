"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { CUBO_DE_ADJUNTOS } from "@/lib/help-attachments";
import {
  adjuntosDe, avisoDeAtendida, filtraSolicitudes, parcheDeEstado, personasDeSolicitudes, quienEscribe,
  resumenDelEnvio, separaPorEstado, type SolicitudDeAyuda,
} from "@/lib/help-requests";

/**
 * Las solicitudes de ayuda, en el hub y solo para el admin (D-285).
 *
 * Lo que se ve sale de `public.help_requests`, que guarda la ruta desde D-285. Quién ve qué lo decide
 * la 120, no esta pantalla: el admin lee todo y cada persona lee las suyas, así que esto no puede
 * enseñar de más aunque se equivoque.
 *
 * **Los adjuntos se firman al abrirlos**, uno a uno y por cinco minutos. Lo guardado es la clave del
 * cubo; un enlace guardado sería un enlace caducado (D-284).
 */

const COLUMNAS =
  "id, created_at, user_id, sender_name, sender_email, role_label, page, app_version, lang, message, files, email_to, email_ok, email_error, status, attended_by, attended_at";

/** Cinco minutos: lo que tarda en abrirse una foto, no más. */
const VALIDEZ_AL_ABRIR = 300;

export default function SolicitudesDeAyudaPage() {
  const { lang, t } = usePrefs();
  const [filas, setFilas] = useState<SolicitudDeAyuda[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  /** El archivo empieza cerrado: la lista de trabajo son las pendientes. */
  const [verAtendidas, setVerAtendidas] = useState(false);
  /** Qué pasó con el aviso al remitente en la última que se atendió. */
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data, error: e } = await createClient()
      .from("help_requests").select(COLUMNAS).order("created_at", { ascending: false }).limit(500);
    if (e) { setError(e.message); return; }
    setError(null);
    setFilas((data ?? []) as SolicitudDeAyuda[]);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(
    () => filtraSolicitudes(filas ?? [], { persona: persona || undefined, desde: desde || undefined, hasta: hasta || undefined }),
    [filas, persona, desde, hasta],
  );
  // Las atendidas salen de la lista principal y se van al archivo, que se abre a propósito. Antes
  // estaban mezcladas y la única forma de quitarlas de en medio era una casilla que había que marcar
  // cada vez.
  const { pendientes, atendidas } = useMemo(() => separaPorEstado(visibles), [visibles]);
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

  const abreAdjunto = async (path: string) => {
    const { data, error: e } = await createClient().storage.from(CUBO_DE_ADJUNTOS).createSignedUrl(path, VALIDEZ_AL_ABRIR);
    if (e || !data?.signedUrl) { setError(e?.message ?? t("Couldn't open the file.", "No se pudo abrir el archivo.")); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const fecha = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US");

  /** Una solicitud, igual en la lista de trabajo y en el archivo: la misma tarjeta, no dos parecidas. */
  const tarjeta = (s: SolicitudDeAyuda) => {
    const adjuntos = adjuntosDe(s);
    const abiertaEsta = abierta === s.id;
    return (
      <div className="card" key={s.id}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <b>{quienEscribe(s)}</b>
          {s.role_label && <span className="hint" style={{ margin: 0 }}>{s.role_label}</span>}
          <span className="hint" style={{ margin: 0 }}>{fecha(s.created_at)}</span>
          <span className="sema" style={{ background: s.status === "atendida" ? "var(--green)" : "var(--amber)", color: "#fff" }}>
            {s.status === "atendida" ? t("Handled", "Atendida") : t("Pending", "Pendiente")}
          </span>
          {adjuntos.length > 0 && <span className="hint" style={{ margin: 0 }}>📎 {adjuntos.length}</span>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={() => setAbierta(abiertaEsta ? null : s.id)}>
            {abiertaEsta ? t("Hide", "Ocultar") : t("Open", "Abrir")}
          </button>
          <button className="btn btn-primary btn-sm" disabled={ocupada === s.id} onClick={() => marca(s)}>
            {s.status === "atendida" ? t("Mark pending", "Marcar pendiente") : t("Mark handled", "Marcar atendida")}
          </button>
        </div>

        {abiertaEsta && (
          <>
            <p style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{s.message}</p>
            <div className="detail-row"><span className="dk">{t("Page", "Página")}</span><span className="dv">{s.page || "—"}</span></div>
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
            {adjuntos.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {adjuntos.map((a) => (
                  <button key={a.path} className="btn btn-ghost btn-sm" onClick={() => abreAdjunto(a.path)}>
                    📎 {a.nombre || a.path.split("/").pop()}
                  </button>
                ))}
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
          {pendientes.length === 0
            ? <div className="empty">{t("Nothing pending 🎉", "Nada pendiente 🎉")}</div>
            : pendientes.map(tarjeta)}

          {/* El archivo: fuera de la lista de trabajo y cerrado, pero con su número a la vista para que
              no parezca que las atendidas se perdieron. */}
          {atendidas.length > 0 && (
            <div className="card">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setVerAtendidas((v) => !v)}
                aria-expanded={verAtendidas}
              >
                {verAtendidas ? "▾" : "▸"} 📦 {t("Handled", "Atendidas")} ({atendidas.length})
              </button>
            </div>
          )}
          {verAtendidas && atendidas.map(tarjeta)}
        </>
      )}
    </>
  );
}
