"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { APP_VERSIONS } from "@/lib/app-versions";
import { DEFAULT_HELP_EMAIL, roleLabel } from "@/lib/constants";
import { LIMITES_DE_ADJUNTOS, mensajeDeAdjunto, validaAdjuntos } from "@/lib/help-attachments";
import { asomoDelMensaje, type SolicitudDeAyuda } from "@/lib/help-requests";
import { enviaSolicitudDeAyuda } from "@/lib/help-send";
import { noLeidosPorSolicitud, RUTA_MIS_SOLICITUDES, type MensajeDeAyuda } from "@/lib/help-thread";
import { HiloDeAyuda } from "@/components/HiloDeAyuda";
import type { UserRole } from "@/lib/types";

/**
 * «Mis solicitudes»: lo que cada persona ha pedido por el botón de ayuda, con su conversación (D-NEXT).
 *
 * Hasta ahora no había ningún sitio donde verlas: la RLS de la 120 dejaba leer las propias, pero
 * ninguna pantalla las listaba. Vive en el hub y no en cada app porque la cuenta es una (el hub
 * centraliza lo que es de la persona y no de un módulo), y por eso lee lo que necesita por consulta
 * directa, sin el `DataProvider` de Entregas.
 *
 * Solo las PROPIAS, también para un admin: aquí el admin es una persona que pidió ayuda. Las de todos
 * las ve en su vista de solicitudes.
 */

const COLUMNAS =
  "id, created_at, user_id, sender_name, sender_email, role_label, page, app_version, lang, message, files, email_to, email_ok, email_error, status, attended_by, attended_at";

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

  const cargar = useCallback(async (abrirLaPrimeraSinLeer = false) => {
    const { data: sesion } = await supabase.auth.getUser();
    if (!sesion.user) return;
    const uid = sesion.user.id;
    const { data: perfil } = await supabase.from("profiles").select("role, full_name").eq("id", uid).maybeSingle();
    const role = ((perfil?.role as UserRole | undefined) ?? "sales");
    setYo({ id: uid, esAdmin: role === "admin", nombre: (perfil?.full_name as string | null) ?? null, role });

    const { data, error: e } = await supabase
      .from("help_requests").select(COLUMNAS).eq("user_id", uid).order("created_at", { ascending: false }).limit(200);
    if (e) { setError(e.message); return; }
    setError(null);
    const mias = (data ?? []) as SolicitudDeAyuda[];
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
    setOcupada(true);
    setAviso(null);
    // A dónde va el correo lo dice Ajustes; se lee aquí, al enviar, y no al cargar la página.
    const { data: ajustes } = await supabase.from("settings").select("help_email").eq("id", 1).maybeSingle();
    const to = String((ajustes as { help_email?: string | null } | null)?.help_email ?? "").trim() || DEFAULT_HELP_EMAIL;
    const r = await enviaSolicitudDeAyuda({
      userId: yo.id, message: texto, ficheros, to, page: RUTA_MIS_SOLICITUDES, senderName: yo.nombre,
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

  const fecha = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US");
  const total = [...sinLeer.values()].reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="page-head">
        <h2>💬 {t("My help requests", "Mis solicitudes de ayuda")}</h2>
        {total > 0 && <span className="sema" style={{ background: "var(--amber)", color: "#fff" }}>{total} {t("unread", "sin leer")}</span>}
        <button className="btn btn-primary btn-sm" onClick={() => setNueva((v) => !v)}>+ {t("New request", "Nueva solicitud")}</button>
        <Link href="/home" className="btn btn-ghost btn-sm">{t("Back to hub", "Volver al hub")}</Link>
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
    </>
  );
}
