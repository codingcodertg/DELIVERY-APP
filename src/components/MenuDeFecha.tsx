"use client";

import { useRef, useState } from "react";
import { useCierraAlSalir } from "@/lib/menu-desplegable";
import { ATAJOS_DEL_MENU, NOMBRE_DE_ATAJO, type Atajo, type Eleccion } from "@/lib/almacen-ops/rango-de-merma";

/**
 * «📅 Elegir fecha» (dueño, 11 nov): un botón con la elección actual («📅 Este mes», o el rango si es personalizado) que
 * abre el menú: primero «Rango personalizado» (abre Desde / Hasta), luego Hoy, Ayer, Esta semana… Se cierra con un clic
 * fuera o con Escape; con teclado, Tab recorre las opciones.
 *
 * Compartido (2026-11-24): lo usan Entregas · Operaciones (reportes) y Time Tracker · Nómina. El componente solo dice
 * qué atajo se eligió; el rango lo calcula quien lo usa (`rangoDeAtajo`, con su semana: domingo en operaciones,
 * viernes en la semana de pago). La persistencia también es de quien lo usa.
 */
export function MenuDeFecha({ eleccion, etiqueta, onElegir, lang, titulo }: {
  eleccion: Eleccion;
  /** El texto del rango ya calculado, para la elección «Rango personalizado». */
  etiqueta: string;
  onElegir: (a: Atajo) => void;
  lang: "en" | "es";
  /** El `title` del botón («Elegir fecha» / «Pick date»). */
  titulo: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useCierraAlSalir(abierto, () => setAbierto(false), () => [caja.current]);
  const nombre = (a: Atajo) => (lang === "es" ? NOMBRE_DE_ATAJO[a].es : NOMBRE_DE_ATAJO[a].en);
  const actual = eleccion.atajo === "otro" ? etiqueta : nombre(eleccion.atajo);
  return (
    <div ref={caja} className="ops-menu-fecha" data-rango-atajos>
      <button type="button" className="chip active" aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)} data-accion="elegir-fecha"
        title={titulo}>📅 {actual} ▾</button>
      {abierto && (
        <div className="ops-menu-fecha-lista" role="menu">
          {ATAJOS_DEL_MENU.map((a) => (
            <button type="button" role="menuitemradio" aria-checked={eleccion.atajo === a} key={a}
              className={"ops-menu-fecha-opcion" + (eleccion.atajo === a ? " activa" : "")}
              onClick={() => { onElegir(a); setAbierto(false); }} data-atajo={a}>
              {a === "otro" ? "📅 " : ""}{nombre(a)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
