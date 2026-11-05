// ============================================================
// Millas imposibles (D-878).
//
// Medido el 2026-11-05 sobre producción: la factura 171838 (RDZ Pharr → 9402 Solana Dr, Monte Alto)
// guardó **321,3 mi / 6 h** cuando son ~25 mi. No fue la dirección final: con ella Google Routes da
// 25,5 mi. Fue la ficha calculando la ruta MIENTRAS se tecleaba (cada 900 ms de pausa) con un trozo
// de dirección («9402», «9402 Solan», «…, Mo») que Google ubica en Holanda, India o Arizona; esa
// respuesta llegó DESPUÉS de la buena —el camino de respaldo (geocodificar + OSRM) tarda más— y la
// pisó. De los 9 pedidos de 60 días con proveedor «Google + OSRM», 7 tienen más de 300 mi.
//
// Dos defensas, puras y probadas aquí:
// 1. `esRespuestaVigente`: solo la ÚLTIMA ruta pedida puede escribir las millas.
// 2. `millasImposibles`: el Valle no tiene entregas a cientos de millas. La más lejana real en 60
//    días es Alice (118 mi desde Pharr); desde Brownsville, Alice o Corpus quedan en ~150-160. 200 deja ese margen y para
//    los 321 de 171838 y todo lo de más.
// ============================================================

/** Por encima de esto, una ruta del Valle no es creíble: se rechaza en el servidor y se avisa en la ficha. */
export const MAX_MILLAS_PLAUSIBLES = 200;

/** Caja del Valle del Río Grande y alrededores (Alice, Port Mansfield incluidos), para sesgar la geocodificación. */
export const CAJA_RGV = { sur: 25.8, oeste: -99.0, norte: 27.9, este: -97.0 } as const;

/** `true` cuando las millas no pueden ser de una entrega del Valle (o no son un número válido positivo). */
export function millasImposibles(millas: number | null | undefined): boolean {
  if (millas == null) return false;
  if (!Number.isFinite(millas) || millas < 0) return true;
  return millas > MAX_MILLAS_PLAUSIBLES;
}

/** ¿El punto cae dentro de la caja del Valle? */
export function puntoEnElValle(lat: number, lng: number): boolean {
  return lat >= CAJA_RGV.sur && lat <= CAJA_RGV.norte && lng >= CAJA_RGV.oeste && lng <= CAJA_RGV.este;
}

/** El parámetro `bounds` de Google Geocoding con la caja del Valle (sesga, no restringe). */
export function boundsGoogleRGV(): string {
  return `${CAJA_RGV.sur},${CAJA_RGV.oeste}|${CAJA_RGV.norte},${CAJA_RGV.este}`;
}

/**
 * Una respuesta de ruta solo vale si es la del último pedido hecho. Las peticiones salen mientras se
 * teclea, y llegan en cualquier orden: sin esto, la de un trozo de dirección pisa a la buena.
 */
export function esRespuestaVigente(numeroDelPedido: number, ultimoPedido: number): boolean {
  return numeroDelPedido === ultimoPedido;
}
