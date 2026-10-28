/**
 * El recorte de la foto rápida de Ayuda (D-NEXT): snapdom fotografía la página ENTERA y de ahí se recorta lo que la
 * persona está viendo.
 *
 * Por qué no `clip: "viewport"`: medido el 2026-10-28 (herramienta `medir-captura-9.mjs`, Rutas con una ruta desplegada,
 * la ventana bajada hasta la tabla y la tabla bajada por dentro): snapdom 3.3.3 y 3.5.0 pintan la cabecera pegada
 * arriba, un hueco y las tarjetas de las rutas, que es lo que el dueño mandó por WhatsApp («It's not capturing
 * screenshot of what I'm looking at»). La foto entera sale bien en el mismo estado, y recortarla por el scroll de la
 * ventana da lo que se ve. Lo que NO reproduce ninguna de las dos: el scroll de dentro de una caja (`.tbl-caja`) —la
 * tabla sale desde su primera fila— ni la cabecera pegada; para eso está «con el navegador».
 *
 * `rect` es `document.body.getBoundingClientRect()`: su esquina dice dónde está el borde de arriba a la izquierda de
 * la ventana dentro del body (negativo = bajado), y su ancho da el factor del lienzo (snapdom puede pintar a 2×).
 */
export interface RecorteDeLaVista { sx: number; sy: number; sw: number; sh: number; ancho: number; alto: number }

export function recorteDeLaVista(
  lienzo: { width: number; height: number },
  rect: { left: number; top: number; width: number },
  ventana: { innerWidth: number; innerHeight: number },
): RecorteDeLaVista | null {
  if (!lienzo.width || !lienzo.height || !rect.width || !ventana.innerWidth || !ventana.innerHeight) return null;
  const f = lienzo.width / rect.width;
  const sx = Math.max(0, Math.round(-rect.left * f));
  const sy = Math.max(0, Math.round(-rect.top * f));
  const sw = Math.min(Math.round(ventana.innerWidth * f), lienzo.width - sx);
  const sh = Math.min(Math.round(ventana.innerHeight * f), lienzo.height - sy);
  if (sw <= 0 || sh <= 0) return null;
  return { sx, sy, sw, sh, ancho: Math.round(sw / f), alto: Math.round(sh / f) };
}
