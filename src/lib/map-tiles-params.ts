/**
 * Los parámetros de un tile de mapa (`/api/map-tiles/{z}/{x}/{y}`) antes de montar ninguna URL con ellos. Solo
 * enteros no negativos, con zoom de 0 a 22 y x, y dentro del cuadrado del zoom (0 … 2^z − 1). Sin esto, lo que
 * llega en la ruta acaba escrito tal cual en la URL de Google y de OpenStreetMap.
 */
export const ZOOM_MAXIMO_TILE = 22;

export function paramsDeTileValidos(z: string, x: string, y: string): { z: number; x: number; y: number } | null {
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,10}$/.test(x) || !/^\d{1,10}$/.test(y)) return null;
  const zoom = Number(z);
  if (zoom > ZOOM_MAXIMO_TILE) return null;
  const lado = 2 ** zoom;
  const xn = Number(x);
  const yn = Number(y);
  if (xn >= lado || yn >= lado) return null;
  return { z: zoom, x: xn, y: yn };
}
