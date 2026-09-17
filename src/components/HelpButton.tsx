"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { DEFAULT_HELP_EMAIL, roleLabel } from "@/lib/constants";
import { APP_VERSIONS } from "@/lib/app-versions";
import { telClean } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  CUBO_DE_ADJUNTOS, LIMITES_DE_ADJUNTOS, mensajeDeAdjunto, rutaDeAdjunto, validaAdjuntos,
} from "@/lib/help-attachments";
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
  // Documentos y fotos (D-NEXT): se eligen aquí, se suben al cubo privado al enviar, y al correo van
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

  /** Sube lo elegido y devuelve sus rutas, o null si alguna subida falla: mejor no mandar la
   *  solicitud que mandarla diciendo que lleva unos adjuntos que no están. */
  const subeFicheros = async (): Promise<{ path: string; nombre: string }[] | null> => {
    if (!ficheros.length) return [];
    const almacen = createClient().storage.from(CUBO_DE_ADJUNTOS);
    const subidos: { path: string; nombre: string }[] = [];
    for (const f of ficheros) {
      const path = rutaDeAdjunto(me.id, f.name, new Date());
      const { error } = await almacen.upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (error) {
        notify(t(`Couldn't upload “${f.name}”. Nothing was sent.`, `No se pudo subir «${f.name}». No se envió nada.`));
        return null;
      }
      subidos.push({ path, nombre: f.name });
    }
    return subidos;
  };

  const send = async () => {
    const message = msg.trim();
    if (!message) return;
    setBusy(true);
    try {
      const archivos = await subeFicheros();
      if (!archivos) { setBusy(false); return; }
      const res = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          to,
          page: pathname,
          senderName: me.full_name,
          role: roleLabel(me.role, lang),
          // HelpButton only ever mounts inside deliveries' own layout/LocalApp.
          appVersion: APP_VERSIONS.deliveries,
          lang,
          archivos,
        }),
      });
      const b = await res.json().catch(() => ({}));
      if (b.ok) {
        notify(t("Help request sent — we'll get back to you.", "Solicitud de ayuda enviada — le responderemos."));
        setOpen(false);
        setMsg("");
        setFicheros([]);
      } else if (b.dryRun) {
        // Email provider not live yet: don't pretend it was delivered.
        notify(t(
          "Email isn't set up yet, so your request wasn't delivered. Ask an admin to finish email setup.",
          "El correo aún no está configurado, así que su solicitud no se envió. Pida a un administrador que termine la configuración.",
        ));
        setOpen(false);
        setMsg("");
      } else {
        notify(t("Couldn't send — please try again.", "No se pudo enviar — intente de nuevo."));
      }
    } catch {
      notify(t("Network error — please try again.", "Error de red — intente de nuevo."));
    } finally {
      setBusy(false);
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
