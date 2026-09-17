"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { guardaMiNombre, hayCambioDeNombre } from "@/lib/profile-name";
import { mensajeDeContrasena, validaCambioDeContrasena, type CodigoContrasena, type MotivoDebil } from "@/lib/profile-password";
import { PasswordInput } from "@/components/PasswordInput";

/**
 * Lo que se ve en «Mi perfil» (D-265).
 *
 * Solo lo que vale para TODAS las apps, medido y no supuesto:
 *   · la cuenta —nombre y con qué se entra—, que es una sola. El nombre se edita aquí desde que la
 *     pantalla de Cuenta de Entregas se fue (D-274); el correo y el usuario no, porque de ellos
 *     cuelga el inicio de sesión y los cambia un admin en Usuarios;
 *   · la contraseña, que es una sola;
 *   · el idioma, que es uno para todas las apps y para los avisos, y sigue a la persona entre
 *     equipos (`public.profiles.language`, `lib/idioma.ts`). Al principio no estaba, porque Time
 *     Tracker tenía el suyo (D-206); el dueño pidió unificarlo;
 *   · el tema, que vive en `rtg_prefs` y lo aplican todas, Time Tracker incluido.
 */
export function ProfileView({ id, nombre, correo, usuario }: { id: string | null; nombre: string | null; correo: string | null; usuario: string | null }) {
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
          {id ? <CambiarNombre id={id} nombre={nombre} /> : <span>{nombre || sinDato}</span>}
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
 * El nombre con el que te ven los demás, en todas las apps. `guardaMiNombre` exige la fila de vuelta:
 * sin ella no se dice «guardado».
 */
function CambiarNombre({ id, nombre }: { id: string; nombre: string | null }) {
  const { t } = usePrefs();
  const router = useRouter();
  const [valor, setValor] = useState(nombre ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null);

  const guardar = async () => {
    if (!hayCambioDeNombre(nombre, valor)) return;
    setAviso(null);
    setOcupado(true);
    try {
      const r = await guardaMiNombre(createClient(), id, valor);
      if (r.ok) {
        setValor(r.nombre);
        setAviso({ texto: t("Name updated.", "Nombre actualizado."), ok: true });
        // La página es de servidor: se vuelve a pedir para que el nombre de arriba sea el guardado.
        router.refresh();
      } else {
        setAviso({ texto: t("The name was not saved. Try again.", "El nombre no se guardó. Inténtalo de nuevo."), ok: false });
      }
    } catch {
      setAviso({ texto: t("The name was not saved. Try again.", "El nombre no se guardó. Inténtalo de nuevo."), ok: false });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, maxWidth: 420 }}>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && guardar()}
          aria-label={t("Name", "Nombre")}
          autoComplete="name"
        />
        <button className="btn btn-primary" onClick={guardar} disabled={ocupado || !hayCambioDeNombre(nombre, valor)}>
          {ocupado ? "…" : t("Save", "Guardar")}
        </button>
      </div>
      {aviso && <div className="hint" style={{ marginTop: 6, color: aviso.ok ? "var(--green)" : "var(--red)" }}>{aviso.texto}</div>}
    </div>
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
      const cuerpo = (await r.json().catch(() => null)) as { ok?: boolean; codigo?: CodigoContrasena; motivos?: MotivoDebil[] } | null;
      if (r.ok && cuerpo?.ok) {
        setAviso({ texto: t("Password updated.", "Contraseña actualizada."), ok: true });
        setActual("");
        setNueva("");
        setConfirmacion("");
      } else {
        // Con los motivos que dé Supabase, para que el aviso diga qué cambiar (D-271).
        setAviso({ texto: mensajeDeContrasena(cuerpo?.codigo ?? "no_guardada", t, cuerpo?.motivos ?? []), ok: false });
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
          <PasswordInput value={actual} onChange={setActual} autoComplete="current-password" />
        </div>
        <div />
        <div className="field">
          <label>{t("New password", "Nueva contraseña")}</label>
          <PasswordInput value={nueva} onChange={setNueva} autoComplete="new-password" />
        </div>
        <div className="field">
          <label>{t("Confirm new password", "Confirmar nueva contraseña")}</label>
          <PasswordInput
            value={confirmacion} onChange={setConfirmacion}
            onKeyDown={(e) => e.key === "Enter" && enviar()}
            autoComplete="new-password"
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
