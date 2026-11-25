"use client";

import { useEffect, useRef, useState } from "react";
import { ColumnFilterMenu } from "@/components/OrdersTable";

/**
 * Un filtro de varias opciones para la barra de Nómina (2026-11-25): el botón muestra la elección y abre el menú de
 * casillas que ya usan las tablas (`ColumnFilterMenu`: buscar, «Seleccionar todo», «Limpiar», «Aplicar»).
 * Sin nada elegido significa «todos» (no filtra). Se cierra con clic fuera o con Escape.
 */
export function MenuDeVarios({ titulo, opciones, elegidos, onCambia, texto, ayuda, lang, dato, disabled = false }: {
  titulo: { en: string; es: string };
  opciones: { key: string; label: string }[];
  /** Los ids elegidos; vacío = todos. */
  elegidos: string[];
  onCambia: (ids: string[]) => void;
  /** Lo que dice el botón (el nombre, «N tiendas», «Todas las tiendas»…). */
  texto: string;
  /** El `title` del botón: la lista completa de nombres elegidos. */
  ayuda: string;
  lang: "en" | "es";
  /** Qué filtro es, para su atributo `data-tienda-de-nomina` o `data-empleado-de-nomina`. */
  dato: "tienda" | "empleado";
  disabled?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const atributos = dato === "tienda" ? { "data-tienda-de-nomina": "" } : { "data-empleado-de-nomina": "" };
  const t = (en: string, es: string) => (lang === "es" ? es : en);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  return (
    <div ref={caja} style={{ position: "relative", minWidth: 0 }}>
      <button type="button" className="tt-nomina-select" style={{ textAlign: "left", cursor: disabled ? "not-allowed" : "pointer" }}
        aria-haspopup="true" aria-expanded={abierto} aria-label={`${lang === "es" ? titulo.es : titulo.en}: ${ayuda}`}
        title={ayuda} disabled={disabled} onClick={() => setAbierto((a) => !a)} {...atributos}>
        {texto} ▾
      </button>
      {abierto && (
        <ColumnFilterMenu
          col={titulo}
          options={opciones}
          active={elegidos.length ? new Set(elegidos) : undefined}
          orden={null}
          onOrdenar={() => {}}
          soloFiltro
          onApply={(next) => { onCambia(next.size === 0 || next.size === opciones.length ? [] : [...next]); setAbierto(false); }}
          onClear={() => { onCambia([]); setAbierto(false); }}
          onClose={() => setAbierto(false)}
          lang={lang}
          t={t}
          style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: "auto", width: 260, zIndex: 80 }}
        />
      )}
    </div>
  );
}
