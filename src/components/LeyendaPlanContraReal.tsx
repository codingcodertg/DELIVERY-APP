"use client";

import type { MapLine } from "@/components/LeafletMap";
import { usePrefs } from "@/lib/prefs";
import {
  ANCHO_PLAN_CON_RECORRIDO, BORDE_RECORRIDO_REAL, COLOR_HUECO, COLOR_RECORRIDO_REAL, leyendaPlanContraReal,
} from "@/lib/recorrido-contra-plan";

/**
 * D-NEXT: la clave de las dos líneas, bajo el mapa, para comparar lo planeado con lo manejado. Solo sale cuando el mapa
 * pinta un recorrido real; sin él, nada. D-520 quitó la leyenda general del mapa; esta explica solo estas dos líneas.
 */
export function LeyendaPlanContraReal({ lineas }: { lineas: readonly MapLine[] }) {
  const { t } = usePrefs();
  const entradas = leyendaPlanContraReal(lineas);
  if (!entradas.length) return null;
  // La muestra de la ruta planeada lleva el color de cada chofer que tiene recorrido (con uno, el suyo).
  const colores = [...new Set(lineas.filter((l) => l.weight === ANCHO_PLAN_CON_RECORRIDO).map((l) => l.color))];
  const fondoPlan = colores.length > 1 ? `linear-gradient(90deg, ${colores.join(", ")})` : colores[0] ?? "var(--accent)";
  const muestra = { display: "inline-block", width: 26, verticalAlign: "middle", marginRight: 6 } as const;
  return (
    <div className="hint" data-leyenda-recorrido style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
      {entradas.map((e) => (
        <span key={e.clave} data-leyenda={e.clave} style={{ whiteSpace: "nowrap" }}>
          {e.clave === "plan" && <span style={{ ...muestra, height: 8, borderRadius: 4, background: fondoPlan }} />}
          {e.clave === "real" && <span style={{ ...muestra, height: 3, borderRadius: 2, background: COLOR_RECORRIDO_REAL, boxShadow: `0 0 0 2px ${BORDE_RECORRIDO_REAL}, 0 0 0 3px var(--line)` }} />}
          {e.clave === "hueco" && <span style={{ ...muestra, height: 0, borderTop: `3px dotted ${COLOR_HUECO}` }} />}
          {t(e.en, e.es)}
        </span>
      ))}
    </div>
  );
}
