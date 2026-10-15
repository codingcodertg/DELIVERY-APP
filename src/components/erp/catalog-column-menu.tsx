"use client";

import { useRef, useState, type ReactNode } from "react";
import { useCierraAlSalir } from "@/lib/menu-desplegable";
import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/erp/utils";

/**
 * El menú de cada cabecera del catálogo del ERP (D-NEXT, traspaso del commit cca6a99 de BH): ordenar
 * ascendente, descendente, u ocultar la columna. Pulsar la cabecera ya no alterna el orden: abre esto.
 *
 * Ordenar NO ordena las filas cargadas en el navegador: llama a `onSort`, que mueve el MISMO estado
 * `sorting` que la consulta del catálogo ya leía (sortId/sortDesc) y vuelve a pedir desde la página 1
 * al servidor. Lo que se puede ordenar y ocultar lo decide `catalogColumns` (lib/erp/catalog-columns.ts);
 * aquí solo se pinta. Las clases `.col-menu`/`.col-opt` y el cierre (`useCierraAlSalir`: clic fuera o
 * Escape) son los del ⚙ Columnas de la casa (SelectorDeColumnas), que el catálogo usa al lado.
 */
export function ColumnHeaderMenu({
  label,
  sorted,
  canSort,
  canHide,
  onSort,
  onHide,
  children,
}: {
  label: string;
  sorted: false | "asc" | "desc";
  canSort: boolean;
  canHide: boolean;
  onSort: (desc: boolean) => void;
  onHide: () => void;
  children: ReactNode;
}) {
  const { t } = usePrefs();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useCierraAlSalir(abierto, () => setAbierto(false), () => [caja.current]);
  const flecha = sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "";
  if (!canSort && !canHide) return <span className="inline-flex items-center gap-1">{children}</span>;

  const elige = (accion: () => void) => {
    accion();
    setAbierto(false);
  };
  const opcion = (activa: boolean, texto: string, accion: () => void) => (
    <button
      type="button"
      className={cn("col-opt w-full text-left", activa && "font-semibold")}
      onClick={() => elige(accion)}
      aria-current={activa || undefined}
    >
      {texto}
      {activa && <span className="ml-auto" aria-hidden>✓</span>}
    </button>
  );

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={t(`${label} column menu`, `Menú de la columna ${label}`)}
        onClick={() => setAbierto((v) => !v)}
        className={cn("inline-flex cursor-pointer select-none items-center gap-1 uppercase hover:text-slate-800", sorted && "text-clay-700")}
      >
        {children}
        {flecha && <span aria-hidden>{flecha}</span>}
      </button>
      {abierto && (
        <div className="col-menu" role="menu" style={{ left: 0, right: "auto", width: 190 }}>
          {canSort && opcion(sorted === "asc", t("Sort ascending", "Orden ascendente"), () => onSort(false))}
          {canSort && opcion(sorted === "desc", t("Sort descending", "Orden descendente"), () => onSort(true))}
          {canHide && opcion(false, t("Hide column", "Ocultar columna"), onHide)}
        </div>
      )}
    </div>
  );
}
