"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { escritorioDesactualizado, INSTALADOR_ESCRITORIO, versionDeEscritorio } from "@/lib/desktop-version";
import { idDelDispositivo } from "@/lib/security/identidad";

/**
 * «Tu app de escritorio tiene versión nueva» (D-813). Solo lo ve la app de escritorio vieja (agente `RTGHub/x.y.z`
 * menor que `ESCRITORIO_MINIMO`); un navegador o un teléfono no lo ven nunca.
 *
 * El botón abre el instalador en el navegador del sistema (la app vieja manda fuera todo lo que no es navegar dentro
 * del sitio), que lo baja a Descargas. El instalador es de un clic (sin asistente): al abrirlo se instala solo encima
 * de la vieja y abre la nueva, que ya se actualiza sola. La URL lleva el id del dispositivo (`?d=`) porque ese
 * navegador no tiene la sesión del hub.
 */
export function AvisoDeEscritorio() {
  const { t } = usePrefs();
  const pathname = usePathname();
  const [estado, setEstado] = useState<{ version: string; href: string } | null>(null);
  const sinSesion = !pathname || pathname.startsWith("/login") || pathname.startsWith("/track/") || pathname.startsWith("/unsubscribe/") || pathname.startsWith("/reset-password") || pathname.startsWith("/auth");

  useEffect(() => {
    if (sinSesion || typeof navigator === "undefined") return;
    const ua = navigator.userAgent;
    if (!escritorioDesactualizado(ua)) return;
    const id = idDelDispositivo(window);
    setEstado({ version: versionDeEscritorio(ua) ?? "?", href: `/api/desktop-update/${INSTALADOR_ESCRITORIO}${id ? `?d=${encodeURIComponent(id)}` : ""}` });
  }, [sinSesion]);

  if (!estado) return null;
  return (
    <div className="aviso-ensenanza no-print" role="status" data-aviso-escritorio style={{ background: "var(--blue-bg, #e8f0fe)", color: "var(--blue, #1a4b8a)" }}>
      <b>{t("RTG Hub has a new version.", "RTG Hub tiene versión nueva.")}</b>{" "}
      {t(`Click Update: the installer downloads, open it and it installs by itself and reopens RTG Hub. From then on it updates alone. (Installed: ${estado.version})`,
        `Pulsa Actualizar: se baja el instalador, ábrelo y se instala solo y vuelve a abrir RTG Hub. Desde entonces se actualiza sola. (Instalada: ${estado.version})`)}{" "}
      <a className="btn btn-sm" href={estado.href} target="_blank" rel="noopener" data-accion="actualizar-escritorio" style={{ marginLeft: 8 }}>
        {t("Update", "Actualizar")}
      </a>
    </div>
  );
}
