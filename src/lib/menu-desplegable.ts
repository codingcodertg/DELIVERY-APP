"use client";

import { useEffect, useRef } from "react";

/**
 * Los menús desplegables de la tabla de Órdenes (D-NEXT): cuándo se cierran y dónde se pintan.
 *
 * Son dos: el de cada cabecera (ordenar y filtrar esa columna) y «⚙ Columnas». Las reglas viven
 * aquí, como funciones puras, porque las pruebas corren sin navegador: lo que decide se prueba
 * importándolo, y los componentes solo lo enchufan.
 */

/** Lo único que la regla de cierre necesita de un nodo del DOM. */
export type Contenedor = { contains(otro: Node | null): boolean };

export type EventoDeCierre = { type: string; key?: string; target?: EventTarget | null };

/**
 * ¿Cierra el menú este evento? Escape, siempre. Un `mousedown`, solo si cae fuera de todo lo que
 * cuenta como dentro: el menú y el botón que lo abre.
 *
 * El botón cuenta como dentro a propósito. Si no, pulsarlo con el menú abierto lo cierra en el
 * `mousedown` y lo vuelve a abrir en el `click`, que llega después: el botón deja de cerrar su
 * propio menú.
 */
export function cierraElMenu(e: EventoDeCierre, dentro: (Contenedor | null | undefined)[]): boolean {
  if (e.type === "keydown") return e.key === "Escape";
  if (e.type !== "mousedown") return false;
  const destino = (e.target ?? null) as Node | null;
  return !dentro.some((n) => !!n && n.contains(destino));
}

/**
 * Mientras `abierto`, cierra el menú con un clic fuera de `dentro()` o con Escape. `dentro` se
 * evalúa en cada evento, así que puede devolver nodos que no existían al abrir.
 */
export function useCierraAlSalir(
  abierto: boolean,
  cerrar: () => void,
  dentro: () => (Contenedor | null | undefined)[],
) {
  // Lo último que se pasó, sin volver a colgar los oyentes en cada render.
  const ultimo = useRef({ cerrar, dentro });
  useEffect(() => { ultimo.current = { cerrar, dentro }; });

  useEffect(() => {
    if (!abierto) return;
    const alEvento = (e: MouseEvent | KeyboardEvent) => {
      if (cierraElMenu(e, ultimo.current.dentro())) ultimo.current.cerrar();
    };
    document.addEventListener("mousedown", alEvento);
    document.addEventListener("keydown", alEvento);
    return () => {
      document.removeEventListener("mousedown", alEvento);
      document.removeEventListener("keydown", alEvento);
    };
  }, [abierto]);
}

export const ANCHO_MENU = 210;
/** Alto que se le supone al menú (orden, buscador, lista y botones) para decidir hacia dónde abre. */
export const ALTO_PREVISTO = 400;

export type Ancla = { top: number; bottom: number; right: number };

/**
 * Dónde se pinta el menú de una cabecera. Va en un portal con `position: fixed`, así que se
 * coloca respecto a la ventana: debajo de la cabecera, o encima si debajo no cabe y encima hay
 * más sitio. Alineado a su borde derecho, sin salirse de la ventana por ningún lado.
 *
 * `top` y `bottom` van SIEMPRE escritos, uno con número y el otro con "auto". La clase `.col-menu`
 * trae `top: calc(100% + 6px)`, pensado para el menú de «Columnas», que cuelga de su botón. Un
 * `top` sin escribir no la pisa, y en `fixed` ese 100% es el alto de la ventana. Medido en Chrome
 * headless con el CSS real (2026-09-17): en una ventana de 673px, el menú que abría hacia arriba
 * quedaba en `top=679`, fuera de la pantalla; con `top: auto`, en `top=203`.
 */
export function posicionDelMenu(ancla: Ancla, ventana: { ancho: number; alto: number }) {
  const debajo = ventana.alto - ancla.bottom;
  const haciaArriba = debajo < ALTO_PREVISTO && ancla.top > debajo;
  return {
    position: "fixed" as const,
    right: "auto" as const,
    left: Math.max(8, Math.min(ancla.right - ANCHO_MENU, ventana.ancho - ANCHO_MENU - 8)),
    top: haciaArriba ? ("auto" as const) : ancla.bottom + 6,
    bottom: haciaArriba ? ventana.alto - ancla.top + 6 : ("auto" as const),
  };
}
