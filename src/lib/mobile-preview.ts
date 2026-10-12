import { safeNext } from "./auth-redirect";

/**
 * La vista móvil del admin (D-278): la app dentro de un marco con ancho de teléfono.
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

/** ¿Esta ruta es la propia vista móvil? (con o sin consulta, o algo debajo de ella) */
export function esLaVistaMovil(ruta: string): boolean {
  const sinConsulta = ruta.split(/[?#]/)[0];
  return sinConsulta === RUTA_VISTA_MOVIL || sinConsulta.startsWith(RUTA_VISTA_MOVIL + "/");
}

/**
 * La ruta que se carga en el marco: solo una ruta interna (`safeNext`, D-193), y nunca la propia vista
 * móvil, que metería un marco dentro de otro. Cualquier otra cosa, `porDefecto`.
 *
 * `porDefecto` era siempre la portada `/`. Desde D-NEXT la página de la vista móvil pasa la pantalla de
 * inicio del rol de la sesión (`roleHome`): dentro de «Entrar como» un chofer, el marco sin ruta abre
 * `/driver`, que es lo suyo, y no el tablero de Órdenes, que no lo es.
 */
export function rutaParaElMarco(ruta: string | null | undefined, porDefecto: string = "/"): string {
  const inicio = esLaVistaMovil(porDefecto) ? "/" : safeNext(porDefecto, "/");
  const segura = safeNext(ruta, inicio);
  return esLaVistaMovil(segura) ? inicio : segura;
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

/**
 * El botón del aviso amarillo que cambia de vista (D-NEXT). El dueño, 2026-10-11, con la vista móvil del hub
 * abierta: «EN ESE MISMO AMARILLO QUIERO QUE ESTE PARA CMABIAR DE DESKTOP VIEW A MOBILE VIEW».
 *
 * - **Dentro del marco** de la vista móvil: «🖥 Vista de escritorio», y saca ESTA pantalla del marco, en la
 *   pestaña de arriba, a tamaño normal.
 * - **En la propia página de la vista móvil** (fuera del marco, que también lleva su aviso): lo mismo, con la
 *   pantalla que hay dentro del marco. Ofrecer ahí «Vista móvil» abriría la vista móvil de sí misma, que
 *   `rutaParaElMarco` convierte en la portada: un botón que no hace lo que dice.
 * - **En cualquier otra pantalla**: «📱 Vista móvil», que abre esta pantalla dentro del marco.
 *
 * `rutaDelMarco` es la ruta que tiene cargada el marco ahora (se navega dentro de él, y la URL de la vista
 * móvil no se entera); si no se puede leer, la `?ruta=` de la URL.
 */
export type BotonDeVista = { vista: "movil" | "escritorio"; destino: string };

export function botonDeVista(a: {
  enMarco: boolean;
  pathname: string;
  search?: string;
  rutaDelMarco?: string | null;
}): BotonDeVista {
  const aqui = (a.pathname || "/") + (a.search ?? "");
  if (a.enMarco) return { vista: "escritorio", destino: rutaParaElMarco(aqui) };
  if (esLaVistaMovil(a.pathname || "/")) {
    const pedida = a.rutaDelMarco ?? new URLSearchParams(a.search ?? "").get("ruta");
    return { vista: "escritorio", destino: rutaParaElMarco(pedida) };
  }
  return { vista: "movil", destino: enlaceAVistaMovil(aqui) };
}
