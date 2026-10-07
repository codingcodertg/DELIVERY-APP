"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { PasswordInput } from "@/components/PasswordInput";
import {
  MIN_CONTRASENA_NUEVA,
  mensajeCambioObligatorio,
  validaNuevaObligatoria,
  type CodigoCambioObligatorio,
} from "@/lib/cambio-obligatorio";
import { mensajeDeContrasena, type CodigoContrasena, type MotivoDebil } from "@/lib/profile-password";

/**
 * El formulario de `/change-password` (D-NEXT). Pensado para el teléfono del chofer: una columna,
 * botones a todo el ancho, y nada más que hacer en la pantalla que esto o salir.
 */
export function CambioObligatorioForm({ nombre, destino, demo = false }: { nombre: string | null; destino: string; demo?: boolean }) {
  const { t, lang, toggleLang } = usePrefs();
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  // El aviso se guarda como función del idioma, no como texto: si la persona cambia de idioma
  // con el aviso a la vista, el aviso cambia también.
  type Traductor = (en: string, es: string) => string;
  const [aviso, setAviso] = useState<((tr: Traductor) => string) | null>(null);
  const setMsg = (f: ((tr: Traductor) => string) | null) => setAviso(() => f);
  const [ok, setOk] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setMsg(null);
    setOk(false);
    const invalido = validaNuevaObligatoria({ nueva, confirmacion: repetida });
    if (invalido) { setMsg((tr) => mensajeCambioObligatorio(invalido, tr)); return; }
    if (demo) { setMsg((tr) => tr("Not available in demo mode.", "No disponible en el modo demo.")); return; }
    setGuardando(true);
    try {
      const r = await fetch("/api/profile/password/forced", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nueva }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; codigo?: string; motivos?: MotivoDebil[] };
      if (r.ok && d.ok) {
        setOk(true);
        setMsg((tr) => tr("Password changed. Opening the app…", "Contraseña cambiada. Abriendo la app…"));
        // Recarga entera y no `router.push`: la sesión cambió de marca, y el middleware tiene que
        // verlo en una petición nueva.
        window.location.href = destino;
        return;
      }
      if (d.codigo === "no_hace_falta") { window.location.href = destino; return; }
      const propios: string[] = ["temporal", "corta", "no_coinciden", "suplantando"];
      setMsg((tr) =>
        d.codigo && propios.includes(d.codigo)
          ? mensajeCambioObligatorio(d.codigo as CodigoCambioObligatorio, tr)
          : mensajeDeContrasena((d.codigo as CodigoContrasena) ?? "no_guardada", tr, d.motivos ?? []),
      );
    } catch {
      setMsg((tr) => mensajeDeContrasena("no_guardada", tr));
    }
    setGuardando(false);
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={toggleLang}>
            {lang === "es" ? "English" : "Español"}
          </button>
        </div>
        <h1>{t("Change your password", "Cambia tu contraseña")}</h1>
        <p className="hint" style={{ marginTop: 6 }}>
          {nombre ? t(`Hi, ${nombre}. `, `Hola, ${nombre}. `) : ""}
          {t(
            "You signed in with a temporary password. Choose your own to keep using the app.",
            "Entraste con una contraseña temporal. Elige una tuya para seguir usando la app.",
          )}
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); void guardar(); }}
          style={{ marginTop: 16 }}
        >
          <div style={{ marginBottom: 14 }}>
            <label>{t("New password", "Contraseña nueva")}</label>
            <PasswordInput value={nueva} onChange={setNueva} autoComplete="new-password" autoFocus />
            <div className="hint" style={{ marginTop: 4 }}>
              {t(`At least ${MIN_CONTRASENA_NUEVA} characters.`, `Al menos ${MIN_CONTRASENA_NUEVA} caracteres.`)}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label>{t("Repeat it", "Repítela")}</label>
            <PasswordInput value={repetida} onChange={setRepetida} autoComplete="new-password" />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", justifyContent: "center", minHeight: 44 }}
            disabled={guardando || ok}
          >
            {guardando ? "…" : t("Save and continue", "Guardar y seguir")}
          </button>
        </form>
        {aviso && (
          <div role="status" className="hint" style={{ marginTop: 12, color: ok ? "var(--green)" : "var(--red)" }}>{aviso(t)}</div>
        )}
        <form action="/auth/signout" method="post" style={{ marginTop: 18 }}>
          <button type="submit" className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "center" }}>
            {t("Sign out", "Cerrar sesión")}
          </button>
        </form>
      </div>
    </div>
  );
}
