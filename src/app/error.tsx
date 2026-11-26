"use client";

import { useEffect } from "react";
import { usePrefs } from "@/lib/prefs";
import { informarFalla } from "@/lib/fallas/cliente";

/**
 * La pantalla de un segmento que falló (2026-11-25): en vez de una página en blanco, un aviso amable con Reintentar.
 * La falla queda registrada en «Fallas de la app» (origen cliente). Dentro del layout raíz, así que tiene el idioma.
 */
export default function ErrorDeSegmento({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = usePrefs();

  useEffect(() => {
    informarFalla(error, { origen: "cliente", componente: "error.tsx" });
  }, [error]);

  return (
    <div role="alert" style={{ maxWidth: 520, margin: "72px auto", padding: "0 16px", textAlign: "center" }}>
      <div style={{ fontSize: 34 }} aria-hidden="true">⚠️</div>
      <h2 style={{ margin: "10px 0", fontSize: 20, fontWeight: 800 }}>
        {t("Something went wrong", "Algo salió mal")}
      </h2>
      <p style={{ margin: "0 0 18px", opacity: 0.8 }}>
        {t("It was reported to the team. You can try again.", "Quedó reportado para el equipo. Puedes intentarlo otra vez.")}
      </p>
      <button type="button" className="btn" onClick={() => reset()}>
        {t("Retry", "Reintentar")}
      </button>
    </div>
  );
}
