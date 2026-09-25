"use client";

import { usePrefs } from "@/lib/prefs";
import type { FiltroDeVista, VistaFiltrada } from "@/lib/almacen";

export interface PestanaDeAlmacen {
  key: string;
  label: string;
  label_es: string;
}

/**
 * La barra de búsqueda y las pastillas de etapa de almacén, **una sola vez para las dos vistas**:
 * la Cola y Recepción. El dueño, el 2026-09-25: *«THE SAME FILTERS AND SEARCH BAR MOVE IT INTO
 * RECEIVING WAREHOUSE»*.
 *
 * No guarda estado: el texto y la pestaña los tiene la pantalla, **uno por vista**, y aquí solo se
 * pintan. Lo que se cuenta en cada pastilla llega ya calculado de `filtraLaVistaDeAlmacen`, sobre la
 * lista de ESA vista, para que el número y la tabla de debajo salgan de lo mismo.
 */
export function FiltrosDeAlmacen({ pestanas, filtro, onCambio, vista }: {
  pestanas: readonly PestanaDeAlmacen[];
  filtro: FiltroDeVista;
  onCambio: (f: FiltroDeVista) => void;
  vista: Pick<VistaFiltrada<unknown>, "visibles" | "cuentas">;
}) {
  const { lang, t } = usePrefs();
  return (
    <div className="filters">
      <input
        style={{ maxWidth: 260 }}
        placeholder={t("Search invoice #…", "Buscar factura #…")}
        value={filtro.q}
        onChange={(e) => onCambio({ ...filtro, q: e.target.value })}
      />
      {pestanas.map((tb) => (
        <button key={tb.key} className={"chip " + (filtro.tab === tb.key ? "on" : "")} onClick={() => onCambio({ ...filtro, tab: tb.key })}>
          {lang === "es" ? tb.label_es : tb.label} <span className="cnt">{tb.key === "all" ? vista.visibles.length : (vista.cuentas[tb.key] ?? 0)}</span>
        </button>
      ))}
    </div>
  );
}
