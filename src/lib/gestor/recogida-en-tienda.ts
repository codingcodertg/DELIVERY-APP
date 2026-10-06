/**
 * ¿La recogida es en una tienda de RTG? (D-481, d). El dueño, 2026-10-06 (dictado, literal): «if pickup are ina  astore
 * rmeove the p1 bubble».
 *
 * En el mapa, cada recogida de la lista llevaba su burbuja «P1», «P2»… en el punto de la tienda (D-334/D-443), encima de la
 * casita roja de la tienda y, si es la base del chofer, encima de su «P» de base también: tres marcas en el mismo punto,
 * abiertas en abanico (D-367). Cuando la recogida es en una tienda de RTG la burbuja no dice nada que la casita y la base no
 * digan ya, y estorba. Se deja de pintar; la fila «P» de la tabla sigue (D-444: una fila por recogida, pedida por el dueño),
 * con su cuenta de pallets y su llegada.
 *
 * Es tienda de RTG la que está en Ajustes → Tiendas, por su nombre (sin mayúsculas ni espacios de más). Una recogida en
 * otro sitio (un proveedor, un nombre que no es tienda) conserva su burbuja: ahí no hay casita.
 */
export function esTiendaRtg(lugar: string | null | undefined, tiendas: readonly { name: string }[]): boolean {
  const n = (lugar ?? "").trim().toLowerCase();
  if (!n) return false;
  return tiendas.some((s) => s.name.trim().toLowerCase() === n);
}
