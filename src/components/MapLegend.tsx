"use client";

import { usePrefs } from "@/lib/prefs";
import { casaDeTienda } from "@/lib/store-pins";
import type { ElementoLeyenda } from "@/lib/map-legend";

/**
 * Pinta la leyenda del mapa de Entregas (D-274). Qué sale y de qué color lo decide `leyendaDelMapa`;
 * aquí solo se dibuja cada muestra con la forma que tiene en el mapa: punto con borde, tienda más
 * grande, pin con su letra, línea continua o discontinua.
 *
 * Una fila que se parte en varias en un teléfono, con letra pequeña: tiene que caber bajo el mapa sin
 * empujarlo fuera de la pantalla.
 */
export function MapLegend({ elementos }: { elementos: ElementoLeyenda[] }) {
  const { t } = usePrefs();
  return (
    <div
      role="list"
      aria-label={t("Map legend", "Leyenda del mapa")}
      style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", padding: "8px 12px", borderTop: "1px solid var(--line)", fontSize: 12 }}
    >
      {elementos.map((e) => (
        <span key={e.clave} role="listitem" style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Muestra e={e} />
          <span>{t(e.en, e.es)}</span>
        </span>
      ))}
    </div>
  );
}

function Muestra({ e }: { e: ElementoLeyenda }) {
  switch (e.forma) {
    case "tienda":
      return (
        // La misma casita que pinta el mapa (D-348): el dibujo es una cadena fija de `store-pins`, sin nada del usuario dentro.
        <span aria-hidden style={{ width: 18, height: 18, flex: "0 0 auto", display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: casaDeTienda(18) }} />
      );
    case "punto":
      return (
        <span aria-hidden style={{ width: 12, height: 12, borderRadius: "50%", background: e.color, border: "2px solid var(--card)", boxShadow: "0 0 0 1px var(--line)", flex: "0 0 auto" }} />
      );
    case "pin":
      return (
        <span aria-hidden style={{ width: 16, height: 16, borderRadius: "50% 50% 50% 0", transform: "rotate(-45deg)", background: e.color, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
          <span style={{ transform: "rotate(45deg)", color: "#fff", fontSize: 9, fontWeight: 800, lineHeight: 1 }}>{e.insignia}</span>
        </span>
      );
    case "linea":
      return (
        <span aria-hidden style={{ width: 22, height: 0, borderTop: `${e.discontinua ? 3 : 4}px ${e.discontinua ? "dashed" : "solid"} ${e.color}`, flex: "0 0 auto" }} />
      );
    case "icono":
      return <span aria-hidden style={{ fontSize: 14, lineHeight: 1, flex: "0 0 auto" }}>{e.icono}</span>;
  }
}
