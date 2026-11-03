"use client";

import { usePrefs } from "@/lib/prefs";
import { INSTALADOR_ESCRITORIO } from "@/lib/desktop-version";

export function BloqueadoEnWeb() {
  const { t } = usePrefs();
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 480, textAlign: "center" }} data-pantalla="web-bloqueada">
        <div style={{ fontSize: 44 }}>🖥️</div>
        <h1 style={{ margin: "8px 0 4px" }}>{t("The web app is no longer available", "La web app ya no está disponible")}</h1>
        <p style={{ marginTop: 0 }}>
          {t("Use the RTG Hub desktop app on your store computer. It is mandatory now.", "Usa la app de escritorio RTG Hub en la computadora de tu tienda. Es obligatorio desde ahora.")}
        </p>
        <p className="hint">
          {t("Your account and password are fine; only the browser is closed. If this computer does not have the app yet, install it here:",
            "Tu cuenta y tu contraseña están bien; lo que se cerró es el navegador. Si esta computadora aún no tiene la app, instálala aquí:")}
        </p>
        <a className="btn btn-green" href={`/api/desktop-update/${INSTALADOR_ESCRITORIO}`} data-accion="descargar-escritorio" style={{ display: "inline-block", fontSize: 18, padding: "12px 28px" }}>
          ⬇️ {t("Download RTG Hub app", "Descargar la app RTG Hub")}
        </a>
        <ol style={{ textAlign: "left", listStyle: "none", padding: 0, marginTop: 14 }}>
          <li><b>1.</b> {t("Open the downloaded file (top right of the browser, or in Downloads). If it asks «Keep?», press Keep.", "Abre el archivo descargado (arriba a la derecha del navegador, o en Descargas). Si pregunta «¿Conservar?», pulsa Conservar.")}</li>
          <li style={{ marginTop: 6 }}><b>2.</b> {t("If Windows asks «Do you want to allow…?», press Yes.", "Si Windows pregunta «¿Quieres permitir…?», pulsa Sí.")}</li>
          <li style={{ marginTop: 6 }}><b>3.</b> {t("RTG Hub opens by itself. Sign in there as usual.", "RTG Hub se abre sola. Entra ahí como siempre.")}</li>
        </ol>
        <p className="hint">{t("From a phone, only Time Tracker opens.", "Desde el teléfono solo abre el Time Tracker.")}</p>
        <form action="/auth/signout" method="post" style={{ marginTop: 12 }}>
          <button type="submit" className="btn btn-ghost">{t("Sign out", "Cerrar sesión")}</button>
        </form>
      </div>
    </main>
  );
}
