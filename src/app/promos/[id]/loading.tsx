"use client";

import { usePrefs } from "@/lib/prefs";

/**
 * Mientras llega una ronda: la forma de la pantalla —título, barra de avance, chips y filas— en gris, en vez de la ronda
 * anterior congelada. Se ve sobre todo al cambiar de ronda con el selector, que vuelve a leer catálogo y decisiones.
 * Solo pinta: no lee nada ni decide nada.
 */
export default function CargandoRonda() {
  const { t } = usePrefs();
  return (
    <div className="promos-carga" role="status" aria-label={t("Loading the round", "Cargando la ronda")}>
      <span className="promos-hueso" style={{ width: "min(420px, 70%)", height: 32 }} />
      <span className="promos-hueso" style={{ width: "min(520px, 90%)", height: 8, borderRadius: 999 }} />
      <span className="promos-hueso" style={{ width: "min(340px, 100%)", height: 36, marginTop: 10 }} />
      <div className="promos-carga-filas promos-hueso" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => <span key={i} />)}
      </div>
    </div>
  );
}
