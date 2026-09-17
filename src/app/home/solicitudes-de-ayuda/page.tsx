"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { CUBO_DE_ADJUNTOS } from "@/lib/help-attachments";
import {
  adjuntosDe, filtraSolicitudes, parcheDeEstado, personasDeSolicitudes, quienEscribe, resumenDelEnvio,
  type SolicitudDeAyuda,
} from "@/lib/help-requests";

/**
 * Las solicitudes de ayuda, en el hub y solo para el admin (D-NEXT).
 *
 * Lo que se ve sale de `public.help_requests`, que guarda la ruta desde D-NEXT. Quién ve qué lo decide
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
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data, error: e } = await createClient()
      .from("help_requests").select(COLUMNAS).order("created_at", { ascending: false }).limit(500);
    if (e) { setError(e.message); return; }
    setError(null);
    setFilas((data ?? []) as SolicitudDeAyuda[]);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(
    () => filtraSolicitudes(filas ?? [], { persona: persona || undefined, desde: desde || undefined, hasta: hasta || undefined, soloPendientes }),
    [filas, persona, desde, hasta, soloPendientes],
  );
  const personas = useMemo(() => personasDeSolicitudes(filas ?? []), [filas]);
  const pendientes = (filas ?? []).filter((s) => s.status === "pendiente").length;

  const marca = async (s: SolicitudDeAyuda) => {
    const supabase = createClient();
    const { data: sesion } = await supabase.auth.getUser();
    if (!sesion.user) return;
    setOcupada(s.id);
    const parche = parcheDeEstado(s.status === "atendida" ? "pendiente" : "atendida", sesion.user.id, new Date());
    // Con `select`: un UPDATE que la política no deja pasar vuelve limpio y con cero filas, y eso no
    // es haber guardado.
    const { data, error: e } = await supabase.from("help_requests").update(parche).eq("id", s.id).select("id");
    setOcupada(null);
    if (e || !data || data.length !== 1) { setError(e?.message ?? t("Couldn't change it.", "No se pudo cambiar.")); return; }
    setFilas((prev) => (prev ?? []).map((x) => (x.id === s.id ? { ...x, ...parche } : x)));
  };

  const abreAdjunto = async (path: string) => {
    const { data, error: e } = await createClient().storage.from(CUBO_DE_ADJUNTOS).createSignedUrl(path, VALIDEZ_AL_ABRIR);
    if (e || !data?.signedUrl) { setError(e?.message ?? t("Couldn't open the file.", "No se pudo abrir el archivo.")); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const fecha = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US");

  return (
    <>
      <div className="page-head">
        <h2>🆘 {t("Help requests", "Solicitudes de ayuda")}</h2>
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
        <label className="check" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
          <span>{t("Only pending", "Solo pendientes")} ({pendientes})</span>
        </label>
      </div>

      {error && <div className="card" style={{ borderColor: "var(--red)" }}><b style={{ color: "var(--red)" }}>{error}</b></div>}

      {filas === null ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : visibles.length === 0 ? (
        <div className="empty">{t("No help requests with these filters.", "No hay solicitudes con estos filtros.")}</div>
      ) : (
        visibles.map((s) => {
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
        })
      )}
    </>
  );
}
