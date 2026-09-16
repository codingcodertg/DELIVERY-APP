"use client";

import { useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { mensajeDeContrasena, validaCambioDeContrasena, type CodigoContrasena } from "@/lib/profile-password";

/**
 * Lo que se ve en «Mi perfil» (D-NEXT).
 *
 * Solo lo que vale para TODAS las apps, medido y no supuesto:
 *   · la cuenta —nombre y con qué se entra—, que es una sola;
 *   · la contraseña, que es una sola;
 *   · el idioma, que es uno para todas las apps y para los avisos, y sigue a la persona entre
 *     equipos (`public.profiles.language`, `lib/idioma.ts`). Al principio no estaba, porque Time
 *     Tracker tenía el suyo (D-206); el dueño pidió unificarlo;
 *   · el tema, que vive en `rtg_prefs` y lo aplican todas, Time Tracker incluido.
 */
export function ProfileView({ nombre, correo, usuario }: { nombre: string | null; correo: string | null; usuario: string | null }) {
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  const sinDato = <span className="hint">—</span>;

  return (
    <>
      <div className="page-head">
        <h2>👤 {t("My profile", "Mi perfil")}</h2>
        <Link href="/home" className="btn btn-ghost btn-sm">{t("Back to hub", "Volver al hub")}</Link>
      </div>

      <div className="card">
        <h2>{t("Account", "Cuenta")}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t(
            "One account and one password for every app in the hub.",
            "Una sola cuenta y una sola contraseña para todas las apps del hub.",
          )}
        </p>
        <div className="dir-card-grid">
          <span className="hint">{t("Name", "Nombre")}</span>
          <span>{nombre || sinDato}</span>
          {usuario && (
            <>
              <span className="hint">{t("Username", "Usuario")}</span>
              <span>{usuario}</span>
            </>
          )}
          {correo && (
            <>
              <span className="hint">{t("Email", "Correo")}</span>
              <span>{correo}</span>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>🔒 {t("Change password", "Cambiar contraseña")}</h2>
        <CambiarContrasena />
      </div>

      <div className="card">
        <h2>{t("Language", "Idioma")}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t(
            "Every app and every notification, on every device you sign in to.",
            "Todas las apps y todos los avisos, en cualquier equipo en el que entres.",
          )}
        </p>
        <div className="toggle-group">
          <button className={"toggle-btn " + (lang === "en" ? "on" : "")} onClick={() => setLang("en")}>🇬🇧 English</button>
          <button className={"toggle-btn " + (lang === "es" ? "on" : "")} onClick={() => setLang("es")}>🇪🇸 Español</button>
        </div>
      </div>

      <div className="card">
        <h2>{t("Theme", "Tema")}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t("Applies to every app, on this device.", "Vale para todas las apps, en este equipo.")}
        </p>
        <div className="toggle-group">
          <button className={"toggle-btn " + (theme === "light" ? "on" : "")} onClick={() => setTheme("light")}>☀️ {t("Light", "Claro")}</button>
          <button className={"toggle-btn " + (theme === "dark" ? "on" : "")} onClick={() => setTheme("dark")}>🌙 {t("Dark", "Oscuro")}</button>
        </div>
      </div>
    </>
  );
}

/**
 * Pide la contraseña actual. La comprobación de verdad está en `POST /api/profile/password`: lo de
 * aquí es solo para no mandar algo que el servidor va a rechazar.
 */
function CambiarContrasena() {
  const { t } = usePrefs();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null);

  const enviar = async () => {
    setAviso(null);
    const invalido = validaCambioDeContrasena({ actual, nueva, confirmacion });
    if (invalido) {
      setAviso({ texto: mensajeDeContrasena(invalido, t), ok: false });
      return;
    }
    setOcupado(true);
    try {
      const r = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actual, nueva }),
      });
      const cuerpo = (await r.json().catch(() => null)) as { ok?: boolean; codigo?: CodigoContrasena } | null;
      if (r.ok && cuerpo?.ok) {
        setAviso({ texto: t("Password updated.", "Contraseña actualizada."), ok: true });
        setActual("");
        setNueva("");
        setConfirmacion("");
      } else {
        setAviso({ texto: mensajeDeContrasena(cuerpo?.codigo ?? "no_guardada", t), ok: false });
      }
    } catch {
      setAviso({ texto: mensajeDeContrasena("no_guardada", t), ok: false });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <div className="grid g2" style={{ maxWidth: 520 }}>
        <div className="field">
          <label>{t("Current password", "Contraseña actual")}</label>
          <input type="password" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        </div>
        <div />
        <div className="field">
          <label>{t("New password", "Nueva contraseña")}</label>
          <input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
        </div>
        <div className="field">
          <label>{t("Confirm new password", "Confirmar nueva contraseña")}</label>
          <input
            type="password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enviar()}
            placeholder="••••••••" autoComplete="new-password"
          />
        </div>
      </div>
      <button className="btn btn-primary" onClick={enviar} disabled={ocupado || !actual || !nueva || !confirmacion}>
        {ocupado ? "…" : t("Update password", "Actualizar contraseña")}
      </button>
      {aviso && <div className="hint" style={{ marginTop: 10, color: aviso.ok ? "var(--green)" : "var(--red)" }}>{aviso.texto}</div>}
    </>
  );
}
