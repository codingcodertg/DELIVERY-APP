"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SwitchUserPanel } from "@/components/SwitchUserPanel";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";

/**
 * «Cambiar de usuario» (D-NEXT): el panel de D-247, montado como página del hub en vez de colgar del
 * botón de la barra de Entregas. La puerta —admin, y no suplantando— está en `layout.tsx`.
 *
 * Si la función está encendida lo dice el servidor, no el cliente: la bandera vive en el entorno y
 * aquí no se puede leer. Se pregunta a `/api/impersonate/state?ask=switch`, como hacía la barra, para
 * no pintar una lista que luego choque con el 404 de `/api/impersonate`.
 */
export default function SwitchUserPage() {
  const { users, settings } = useData();
  const { t } = usePrefs();
  const [habilitado, setHabilitado] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/impersonate/state?ask=switch")
      .then((r) => r.json())
      .then((d: { habilitado?: boolean }) => { if (vivo) setHabilitado(!!d.habilitado); })
      .catch(() => { if (vivo) setHabilitado(false); });
    return () => { vivo = false; };
  }, []);

  return (
    <div className="card" style={{ maxWidth: 680, margin: "24px auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>⇄ {t("Switch user", "Cambiar de usuario")}</h2>
        <Link href="/home" className="btn btn-ghost btn-sm">◂ {t("Back to hub", "Volver al hub")}</Link>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {t(
          "Sign in as someone on the team to see exactly what they see. Everything you do is recorded as done by them, and it is logged.",
          "Entra como alguien del equipo para ver exactamente lo que ve. Todo lo que hagas queda registrado como hecho por esa persona, y queda en el registro de seguridad.",
        )}
      </p>
      {habilitado === null && <div className="hint">{t("Checking…", "Comprobando…")}</div>}
      {habilitado === false && (
        <div className="hint" style={{ color: "var(--amber)", fontWeight: 600 }}>
          {t("Signing in as another user is turned off on this server.", "Entrar como otro usuario está apagado en este servidor.")}
        </div>
      )}
      {habilitado === true && (
        <SwitchUserPanel users={users} tiendas={settings.stores ?? []} enPagina onClose={() => { window.location.href = "/home"; }} />
      )}
    </div>
  );
}
