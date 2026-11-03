"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";

export function BloqueadoEnDispositivo({ codigo }: { codigo: string }) {
  const { t } = usePrefs();
  const [nota, setNota] = useState("");
  const [estado, setEstado] = useState<"nada" | "enviando" | "enviada" | "fallo">("nada");
  const solicita = async () => {
    setEstado("enviando");
    try {
      const r = await fetch("/api/security/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nota }) });
      const j = await r.json().catch(() => ({}));
      setEstado(r.ok && j.ok ? "enviada" : "fallo");
    } catch { setEstado("fallo"); }
  };
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 460, textAlign: "center" }} data-pantalla="dispositivo-bloqueado">
        <div style={{ fontSize: 44 }}>🔒</div>
        <h1 style={{ margin: "8px 0 4px" }}>{t("This device is not authorized", "Este dispositivo no está autorizado")}</h1>
        <p className="hint" style={{ marginTop: 0 }}>
          {t(
            "Your account is fine. The RTG Hub only opens on registered store computers and approved phones. Ask your administrator to approve this device.",
            "Tu cuenta está bien. El RTG Hub solo abre en las computadoras registradas de la tienda y en los teléfonos aprobados. Pídele a tu administrador que apruebe este dispositivo.",
          )}
        </p>
        {codigo && (
          <p style={{ margin: "12px 0" }}>
            {t("Device code", "Código del dispositivo")}: <b style={{ fontFamily: "monospace", letterSpacing: 1 }}>{codigo}</b>
          </p>
        )}
        {estado === "enviada" ? (
          <p data-solicitud="enviada" style={{ color: "var(--green)", fontWeight: 600 }}>
            {t("Request sent. Your administrator will see it in Security.", "Solicitud enviada. Tu administrador la verá en Seguridad.")}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8, textAlign: "left" }}>
            <label className="field">
              <span>{t("Why do you need this device?", "¿Por qué necesitas este dispositivo?")}</span>
              <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder={t("e.g. new phone, the old one broke", "p. ej. teléfono nuevo, el otro se rompió")} />
            </label>
            <button type="button" className="btn btn-green" data-accion="solicitar-autorizacion" disabled={estado === "enviando"} onClick={() => void solicita()}>
              {t("Request authorization", "Solicitar autorización")}
            </button>
            {estado === "fallo" && <span className="hint" style={{ color: "var(--red)" }}>{t("Could not send. Try again.", "No se pudo enviar. Inténtalo otra vez.")}</span>}
          </div>
        )}
        <form action="/auth/signout" method="post" style={{ marginTop: 12 }}>
          <button type="submit" className="btn btn-ghost">{t("Sign out", "Cerrar sesión")}</button>
        </form>
      </div>
    </main>
  );
}
