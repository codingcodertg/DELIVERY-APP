"use client";
/**
 * «Desktop view» en el teléfono (junta con el dueño, 2026-11-20: «we still got to fix this to say desktop view when I'm
 * in mobile»). En un teléfono, el botón general ofrece ver la versión de computadora: la página se dibuja a 1280 px de
 * ancho y el teléfono la achica, como «Sitio de escritorio» del navegador. Se recuerda en este teléfono (localStorage)
 * hasta que toquen «Mobile view». Solo cambia la etiqueta `<meta name="viewport">`; no toca datos.
 */
import { useCallback, useEffect, useState } from "react";

export const CLAVE_VISTA_ESCRITORIO = "rtg-vista-escritorio";
export const ANCHO_ESCRITORIO = 1280;
const VIEWPORT_MOVIL = "width=device-width, initial-scale=1, viewport-fit=cover";
const VIEWPORT_ESCRITORIO = `width=${ANCHO_ESCRITORIO}, viewport-fit=cover`;

/** El contenido de la etiqueta viewport para cada vista. */
export function contenidoDelViewport(escritorio: boolean): string {
  return escritorio ? VIEWPORT_ESCRITORIO : VIEWPORT_MOVIL;
}

function leer(): boolean {
  try { return localStorage.getItem(CLAVE_VISTA_ESCRITORIO) === "1"; } catch { return false; }
}

function aplicar(escritorio: boolean) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta) meta.content = contenidoDelViewport(escritorio);
}

/** ¿Es un teléfono? Pantalla táctil y angosta (de su tamaño real, no del viewport que pusimos). */
function esTelefono(): boolean {
  return window.matchMedia("(pointer: coarse)").matches && Math.min(window.screen.width, window.screen.height) <= 820;
}

export function useVistaEscritorio() {
  const [escritorio, setEscritorio] = useState(false);
  const [telefono, setTelefono] = useState(false);
  useEffect(() => {
    const e = leer();
    setEscritorio(e);
    setTelefono(esTelefono());
    if (e) aplicar(true);
  }, []);
  const cambiar = useCallback(() => {
    setEscritorio((x) => {
      const n = !x;
      try { if (n) localStorage.setItem(CLAVE_VISTA_ESCRITORIO, "1"); else localStorage.removeItem(CLAVE_VISTA_ESCRITORIO); } catch { /* sin almacenamiento: solo esta vez */ }
      aplicar(n);
      return n;
    });
  }, []);
  return { escritorio, telefono, cambiar };
}
