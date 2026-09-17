"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePrefs } from "@/lib/prefs";
import { PasswordInput } from "@/components/PasswordInput";
import { leeFragmentoRecuperacion } from "@/lib/password-recovery";

export default function ResetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();
  const { t } = usePrefs();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);
  // Mientras se lee el fragmento no se deja guardar: `updateUser` sin la sesión de recuperación
  // fallaría con un «falta la sesión» que no explica nada.
  const [listo, setListo] = useState(false);

  useEffect(() => {
    // El enlace del correo vuelve aquí con la sesión en el fragmento (D-263). Se lee UNA vez y se
    // BORRA de la URL antes de hacer nada más, para que los tokens no queden en el historial, en una
    // captura de pantalla o en un enlace copiado. El cliente del navegador, que es PKCE, no lo
    // consume ni lo borra por su cuenta: medido en auth-js 2.112.4, lo rechaza y sigue.
    const lectura = leeFragmentoRecuperacion(window.location.hash);
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }

    if (lectura.kind === "error") {
      setMsg(t("The link is no longer valid: ", "El enlace ya no es válido: ") + lectura.mensaje);
      setOk(false);
      setListo(true);
      return;
    }
    if (lectura.kind === "nada") { setListo(true); return; }

    let vivo = true;
    void supabase.auth
      .setSession({ access_token: lectura.access_token, refresh_token: lectura.refresh_token })
      .then(({ error }) => {
        if (!vivo) return;
        if (error) { setMsg(t("The link is no longer valid: ", "El enlace ya no es válido: ") + error.message); setOk(false); }
        setListo(true);
      });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setMsg("");
    if (password.length < 6) {
      setMsg(t("Password must be at least 6 characters.", "La contraseña necesita al menos 6 caracteres."));
      setOk(false);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      // Sin sesión de recuperación —el enlace caducó, o se abrió esta pantalla a mano— se dice qué
      // hacer, no solo que falló.
      setMsg(error.message + " — " + t("Request a new link from the login screen.", "Pide un enlace nuevo desde la pantalla de entrar."));
      setOk(false);
      return;
    }
    setMsg(t("Password updated. Redirecting…", "Contraseña cambiada. Redirigiendo…"));
    setOk(true);
    setTimeout(() => router.push("/"), 1200);
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>{t("Set a new password", "Pon una contraseña nueva")}</h1>
        <div style={{ margin: "16px 0" }}>
          <label>{t("New password", "Contraseña nueva")}</label>
          <PasswordInput
            value={password}
            onChange={setPassword}
            onKeyDown={(e) => e.key === "Enter" && listo && submit()}
            autoComplete="new-password"
          />
        </div>
        <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={submit} disabled={loading || !listo}>
          {loading || !listo ? "..." : t("Update password", "Cambiar contraseña")}
        </button>
        {msg && <div className="hint" style={{ marginTop: 12, color: ok ? "var(--green)" : "var(--red)" }}>{msg}</div>}
      </div>
    </div>
  );
}
