"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { escritorioDesactualizado, INSTALADOR_ESCRITORIO, versionDeEscritorio } from "@/lib/desktop-version";
import { idDelDispositivo } from "@/lib/security/identidad";

/**
 * «RTG Hub tiene que actualizarse» (D-813, D-814). Solo lo ve la app de escritorio vieja (agente `RTGHub/x.y.z` menor
 * que `ESCRITORIO_MINIMO`); un navegador o un teléfono no lo ven nunca.
 *
 * Desde D-814 TAPA TODA LA PANTALLA y no se puede cerrar: con la app vieja no se trabaja (el dueño: «sin ese update
 * que el app no se pueda utilizar»). Un solo botón. La app vieja manda el enlace al navegador del sistema (no puede
 * ejecutar nada ella misma), el navegador baja el instalador y la persona pulsa la descarga; el instalador es de un
 * clic: se instala solo encima de la vieja y abre la nueva, que ya se actualiza sola sin preguntar.
 */
export function AvisoDeEscritorio() {
  const { t } = usePrefs();
  const [estado, setEstado] = useState<{ version: string; href: string } | null>(null);
  const [pulsado, setPulsado] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent;
    if (!escritorioDesactualizado(ua)) return;
    const id = idDelDispositivo(window);
    setEstado({ version: versionDeEscritorio(ua) ?? "?", href: `/api/desktop-update/${INSTALADOR_ESCRITORIO}${id ? `?d=${encodeURIComponent(id)}` : ""}` });
  }, []);

  if (!estado) return null;
  const paso = (n: number, texto: string) => (
    <li style={{ margin: "6px 0" }}><b>{n}.</b> {texto}</li>
  );
  return (
    <div role="dialog" aria-modal="true" data-bloqueo-escritorio
      style={{ position: "fixed", inset: 0, zIndex: 10000, background: "var(--bg, #fff)", color: "var(--fg, #111)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <div style={{ fontSize: 48 }}>⬆️</div>
        <h1 style={{ fontSize: 24, margin: "8px 0" }}>{t("RTG Hub needs to update", "RTG Hub tiene que actualizarse")}</h1>
        <p style={{ opacity: .8 }}>
          {t("This version no longer works. It takes one minute and you don't lose anything.", "Esta versión ya no funciona. Tarda un minuto y no pierdes nada.")}
        </p>
        <a className="btn btn-green" href={estado.href} target="_blank" rel="noopener" data-accion="actualizar-escritorio"
          onClick={() => setPulsado(true)}
          style={{ display: "inline-block", fontSize: 20, padding: "14px 32px", marginTop: 8 }}>
          {t("Update now", "Actualizar ahora")}
        </a>
        <ol style={{ textAlign: "left", listStyle: "none", padding: 0, marginTop: 20, opacity: pulsado ? 1 : .75 }}>
          {paso(1, t("Press the green button. A browser window opens and downloads «RTG Hub Setup».", "Pulsa el botón verde. Se abre una ventana del navegador y descarga «RTG Hub Setup»."))}
          {paso(2, t("Click the downloaded file (top right of the browser, or in Downloads). If it asks «Keep?», press Keep.", "Pulsa el archivo descargado (arriba a la derecha del navegador, o en Descargas). Si pregunta «¿Conservar?», pulsa Conservar."))}
          {paso(3, t("If Windows asks «Do you want to allow…?», press Yes.", "Si Windows pregunta «¿Quieres permitir…?», pulsa Sí."))}
          {paso(4, t("Wait. RTG Hub closes and opens by itself, updated. Done: from now on it updates alone.", "Espera. RTG Hub se cierra y se abre solo, ya actualizado. Listo: desde ahora se actualiza sola."))}
        </ol>
        <p className="hint" style={{ marginTop: 16 }}>
          {t(`Installed: ${estado.version}. If something goes wrong, press the green button again.`, `Instalada: ${estado.version}. Si algo sale mal, vuelve a pulsar el botón verde.`)}
        </p>
      </div>
    </div>
  );
}
