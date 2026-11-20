"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { CLAVE_DE_VELOCIDAD, rotuloDeVelocidad, siguienteVelocidad, velocidadGuardada } from "@/lib/recruiting/velocidad-de-audio";

/**
 * El reproductor de una grabación de RingCentral: el audio y el botón de velocidad (1×, 1.5×, 2×), que se recuerda en
 * el navegador. Lo usan la ficha del candidato (recruiting) y la ficha del lead. La URL la pide quien lo usa (firmada
 * por el servidor); aquí solo se escucha.
 */
export function ReproductorDeGrabacion({ url }: { url: string }) {
  const { t } = usePrefs();
  const [velocidad, setVelocidad] = useState(1);
  useEffect(() => { try { setVelocidad(velocidadGuardada(localStorage.getItem(CLAVE_DE_VELOCIDAD))); } catch { /* sin almacenamiento: 1× */ } }, []);
  const cambiaVelocidad = () => setVelocidad((v) => { const n = siguienteVelocidad(v); try { localStorage.setItem(CLAVE_DE_VELOCIDAD, String(n)); } catch { /* da igual */ } return n; });

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", maxWidth: 420 }}>
      <audio controls preload="none" src={url} style={{ flex: "1 1 auto", minWidth: 0 }}
        ref={(el) => { if (el) el.playbackRate = velocidad; }} onPlay={(e) => { e.currentTarget.playbackRate = velocidad; }} />
      <button type="button" data-velocidad-de-audio={velocidad} onClick={cambiaVelocidad} className={velocidad === 1 ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm"}
        title={t("Playback speed: tap to change", "Velocidad: toque para cambiarla")} aria-label={t(`Playback speed ${rotuloDeVelocidad(velocidad)}`, `Velocidad ${rotuloDeVelocidad(velocidad)}`)}
        style={{ flex: "0 0 auto", minWidth: 44, borderRadius: 999, fontWeight: 700 }}>
        {rotuloDeVelocidad(velocidad)}
      </button>
    </span>
  );
}
