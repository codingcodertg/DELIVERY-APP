import { safeNext } from "./auth-redirect";

/**
 * La vista móvil del admin (D-NEXT): la app dentro de un marco con ancho de teléfono.
 *
 * El dueño: «solo para admin, crea también la vista móvil para poder probarla». Medido antes de
 * construir: el diseño móvil de la app son **media queries de viewport** (`@media (max-width: …)` en
 * globals.css, timetracker.css y recruiting.css) y nada en TypeScript pregunta el ancho para decidir
 * el diseño. Un `div` de 390 px no dispara ninguna: el viewport sigue siendo el de la ventana. Un
 * `iframe` sí, porque tiene viewport propio, y es del mismo origen, así que comparte la sesión. No hay
 * `X-Frame-Options` ni `frame-ancestors` que lo impidan.
 */

export const RUTA_VISTA_MOVIL = "/home/vista-movil";

/** Los tres tamaños: un Android pequeño, un iPhone normal y uno grande. Ancho y alto en px CSS. */
export const TAMANOS_MOVIL = [
  { ancho: 360, alto: 780 },
  { ancho: 390, alto: 844 },
  { ancho: 430, alto: 932 },
] as const;

export const ANCHO_POR_DEFECTO = 390;

/**
 * La ruta que se carga en el marco: solo una ruta interna (`safeNext`, D-193), y nunca la propia vista
 * móvil, que metería un marco dentro de otro. Cualquier otra cosa, la portada.
 */
export function rutaParaElMarco(ruta: string | null | undefined): string {
  const segura = safeNext(ruta, "/");
  const sinConsulta = segura.split(/[?#]/)[0];
  if (sinConsulta === RUTA_VISTA_MOVIL || sinConsulta.startsWith(RUTA_VISTA_MOVIL + "/")) return "/";
  return segura;
}

/** El ancho pedido, si es uno de los tres; si no, el de por defecto. */
export function anchoElegido(v: string | number | null | undefined): number {
  const n = Number(v);
  return TAMANOS_MOVIL.some((t) => t.ancho === n) ? n : ANCHO_POR_DEFECTO;
}

/** El enlace a la vista móvil con una ruta y un ancho: lo que abre el menú y lo que se guarda en la URL. */
export function enlaceAVistaMovil(ruta: string, ancho: number = ANCHO_POR_DEFECTO): string {
  const q = new URLSearchParams({ ruta: rutaParaElMarco(ruta), ancho: String(anchoElegido(ancho)) });
  return `${RUTA_VISTA_MOVIL}?${q.toString()}`;
}

/** ¿Esta página se está pintando dentro de un marco? Si el navegador no deja mirarlo, sí: es un marco ajeno. */
export function estaEnUnMarco(w: { self: unknown; top: unknown }): boolean {
  try {
    return w.self !== w.top;
  } catch {
    return true;
  }
}
