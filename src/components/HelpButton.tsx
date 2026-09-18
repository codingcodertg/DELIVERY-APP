"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { DEFAULT_HELP_EMAIL, roleLabel } from "@/lib/constants";
import { APP_VERSIONS } from "@/lib/app-versions";
import { telClean } from "@/lib/utils";
import Link from "next/link";
import { LIMITES_DE_ADJUNTOS, mensajeDeAdjunto, validaAdjuntos } from "@/lib/help-attachments";
import { enviaSolicitudDeAyuda } from "@/lib/help-send";
import { RUTA_MIS_SOLICITUDES } from "@/lib/help-thread";
import type { Profile } from "@/lib/types";

/** Floating "Help" button, mounted app-wide. Any user can tap it to email a
 * question to the support address an admin sets in Settings (help_email,
 * default DEFAULT_HELP_EMAIL). We attach who/where/version context so the
 * recipient can act without a back-and-forth. Delivery goes through /api/help
 * (Resend); until email is configured it reports a dry-run and we say so. */
export function HelpButton({ me }: { me: Profile }) {
  const { settings, notify } = useData();
  const { lang, t } = usePrefs();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // Documentos y fotos (D-284): se eligen aquí, se suben al cubo privado al enviar, y al correo van
  // sus enlaces firmados. Lo que se acepta lo dice `help-attachments`, el mismo sitio que mira la ruta.
  const [ficheros, setFicheros] = useState<File[]>([]);

  const to = settings.help_email?.trim() || DEFAULT_HELP_EMAIL;

  const close = () => { if (!busy) { setOpen(false); setMsg(""); setFicheros([]); } };

  const eligeFicheros = (lista: FileList | null) => {
    const elegidos = [...(lista ?? [])];
    if (!elegidos.length) return;
    const juntos = [...ficheros, ...elegidos];
    const fallo = validaAdjuntos(juntos);
    if (fallo) { notify(mensajeDeAdjunto(fallo, t)); return; }
    setFicheros(juntos);
  };

  const send = async () => {
    const message = msg.trim();
    if (!message) return;
    setBusy(true);
    // Subir y mandar viven en `help-send`, que también usa «Mis solicitudes» del hub (D-NEXT).
    const r = await enviaSolicitudDeAyuda({
      userId: me.id, message, ficheros, to, page: pathname, senderName: me.full_name,
      role: roleLabel(me.role, lang),
      // HelpButton only ever mounts inside deliveries' own layout/LocalApp.
      appVersion: APP_VERSIONS.deliveries,
      lang,
    });
    setBusy(false);
    if (r.tipo === "enviada") {
      notify(t("Help request sent — we'll get back to you.", "Solicitud de ayuda enviada — le responderemos."));
      setOpen(false); setMsg(""); setFicheros([]);
    } else if (r.tipo === "sin-correo") {
      // Email provider not live yet: don't pretend it was delivered.
      notify(t(
        "Email isn't set up yet, so your request wasn't delivered. Ask an admin to finish email setup.",
        "El correo aún no está configurado, así que su solicitud no se envió. Pida a un administrador que termine la configuración.",
      ));
      setOpen(false); setMsg("");
    } else if (r.tipo === "subida") {
      notify(t(`Couldn't upload “${r.fichero}”. Nothing was sent.`, `No se pudo subir «${r.fichero}». No se envió nada.`));
    } else if (r.tipo === "red") {
      notify(t("Network error — please try again.", "Error de red — intente de nuevo."));
    } else {
      notify(t("Couldn't send — please try again.", "No se pudo enviar — intente de nuevo."));
    }
  };

  return (
    <>
      <button
        className="help-fab no-print"
        onClick={() => setOpen(true)}
        title={t("Need help?", "¿Necesita ayuda?")}
        aria-label={t("Need help?", "¿Necesita ayuda?")}
      >
        <span aria-hidden>?</span>
        <span className="help-fab-label">{t("Help", "Ayuda")}</span>
      </button>

      {open && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h3 style={{ margin: "0 0 4px" }}>{t("Need help?", "¿Necesita ayuda?")}</h3>
            <p className="hint" style={{ marginTop: 0 }}>
              {t(
                "Describe what's happening and we'll email support. We'll include your name, role, and the page you're on.",
                "Describa lo que sucede y enviaremos un correo a soporte. Incluiremos su nombre, rol y la página en la que está.",
              )}
            </p>
            {settings.help_phone?.trim() && (
              <a
                href={`tel:${telClean(settings.help_phone)}`}
                className="btn btn-green"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12 }}
              >
                📞 {t("Call us", "Llámanos")} · {settings.help_phone}
              </a>
            )}
            <textarea
              rows={5}
              autoFocus
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder={t("What do you need help with?", "¿En qué necesita ayuda?")}
              style={{ width: "100%", resize: "vertical" }}
            />
            <div className="field" style={{ marginTop: 10 }}>
              <label style={{ textTransform: "none", letterSpacing: 0 }}>
                {t("Photos or documents (optional)", "Fotos o documentos (opcional)")}
              </label>
              <input
                type="file"
                multiple
                accept={LIMITES_DE_ADJUNTOS.tipos.join(",")}
                disabled={busy}
                onChange={(e) => { eligeFicheros(e.target.files); e.target.value = ""; }}
              />
              <div className="hint">
                {t(
                  `Up to ${LIMITES_DE_ADJUNTOS.maxFicheros} files, ${Math.round(LIMITES_DE_ADJUNTOS.maxBytes / (1024 * 1024))} MB each. They travel as private links that expire.`,
                  `Hasta ${LIMITES_DE_ADJUNTOS.maxFicheros} archivos de ${Math.round(LIMITES_DE_ADJUNTOS.maxBytes / (1024 * 1024))} MB. Viajan como enlaces privados que caducan.`,
                )}
              </div>
              {ficheros.length > 0 && (
                <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 4 }}>
                  {ficheros.map((f, i) => (
                    <li key={`${f.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📎 {f.name}</span>
                      <span className="hint" style={{ margin: 0 }}>{Math.max(1, Math.round(f.size / 1024))} KB</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => setFicheros((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={t(`Remove ${f.name}`, `Quitar ${f.name}`)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* Las respuestas llegan a «Mis solicitudes», en el hub: la conversación vive allí (D-NEXT). */}
            <Link href={RUTA_MIS_SOLICITUDES} className="hint" style={{ display: "inline-block", marginTop: 10 }}>
              💬 {t("My requests and replies", "Mis solicitudes y respuestas")}
            </Link>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={close} disabled={busy}>{t("Cancel", "Cancelar")}</button>
              <button className="btn btn-primary" onClick={send} disabled={busy || !msg.trim()}>
                {busy ? t("Sending…", "Enviando…") : t("Send", "Enviar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
