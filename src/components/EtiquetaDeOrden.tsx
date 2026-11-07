"use client";

import { usePrefs } from "@/lib/prefs";
import { etiquetaDeOrden, tituloDeEtiqueta, type OrdenNombrable } from "@/lib/etiqueta-de-parada";

/**
 * D-912: el nombre de una orden en el Recorrido: la FACTURA en negrita; sin factura, «#FW171» en gris y más fino, como
 * suplente (el mismo criterio que la columna del Gestor de Rutas, `data-factura`). El código siempre va en el `title`.
 * Si llega `onAbrir`, es un botón que abre la ficha de la orden en su sitio (regla «abrir en tarjeta»).
 */
export function EtiquetaDeOrden({ orden, prefijo, onAbrir }: { orden: OrdenNombrable; prefijo?: string; onAbrir?: (() => void) | null }) {
  const { t } = usePrefs();
  const e = etiquetaDeOrden(orden);
  const estilo = e.suplente ? { color: "var(--gray)", fontWeight: 500 } : { fontWeight: 700 };
  const contenido = <>{prefijo}{e.texto}{e.suplente && e.codigo && <span className="hint" style={{ marginTop: 0, marginLeft: 4, fontSize: 11, display: "inline" }}>{t("(no invoice)", "(sin factura)")}</span>}</>;
  const titulo = tituloDeEtiqueta(e, t);
  if (onAbrir) {
    return (
      <button type="button" data-abre-la-orden data-factura={e.suplente ? undefined : ""} title={titulo} onClick={onAbrir}
        style={{ ...estilo, background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: e.suplente ? "var(--gray)" : "inherit", textDecoration: "underline dotted" }}>
        {contenido}
      </button>
    );
  }
  return <span data-factura={e.suplente ? undefined : ""} title={titulo} style={estilo}>{contenido}</span>;
}
