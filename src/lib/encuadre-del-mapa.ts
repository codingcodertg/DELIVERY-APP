import { LOCAL_ZONE_DEFAULT } from "@/lib/delivery-zone";
import { distanceMeters } from "@/lib/geo";

/**
 * Qué encuadra un mapa al abrirse, y qué NO le deja estirar el encuadre (D-NEXT).
 *
 * El dueño, 2026-10-18: «Map defaults to a zoomed out view instead of viewing the region». `fitBounds` mete en el
 * encuadre TODO lo que le pasan: una orden guardada en `0,0` (el Golfo de Guinea; la base las tiene, por eso
 * `necesitaUbicacion` y `puntoEnZonaLocal` ya las tratan como «sin punto»), una dirección geocodificada en otro estado o
 * un camión reportando desde lejos bastan para que el mapa se abra con medio continente. Y sin ningún punto, los dos
 * mapas se quedaban en el centro fijo del Valle con `zoom` 11 en vez de encuadrar la región.
 *
 * Lógica pura, sin Google ni Leaflet, para medirla: los dos mapas (`GoogleMapView`, `LeafletMap`) la llaman igual.
 */

export type Punto = readonly [number, number];
export interface TiendaDelMapa { lat: number; lng: number }

/** Más lejos que esto del centro de las tiendas no es una parada de esta empresa: es un dato malo. */
export const RADIO_MAX_KM = 300;
/** El suelo del tope de alejamiento (`topeDeAlejamiento`), por si la región sale enorme: a 8, un mapa de 430 px enseña
 *  ~500 km de lado, todo el sur de Texas. El tope real es la región de las tiendas, que suele quedar en 9 o 10. */
export const ZOOM_MINIMO_DEL_MAPA = 8;
/** Medio lado mínimo de la caja de la región, en grados (~15 km): una sola tienda se encuadra como su ciudad. */
const MEDIO_LADO_MINIMO = 0.15;

/** Número finito y no el 0,0. Una latitud de 95 o una longitud de −181 no se comprueban aparte: caen a más de 300 km
 *  del centro y el radio las saca (el mutante M2 de la tanda lo midió: esa comprobación sobraba). */
function esCoordenada(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** El centro de la zona por defecto, para cuando Ajustes no tiene ninguna tienda con punto. */
function centroDeLaZona(): { lat: number; lng: number } {
  return { lat: mediana(LOCAL_ZONE_DEFAULT.map((v) => v[0])), lng: mediana(LOCAL_ZONE_DEFAULT.map((v) => v[1])) };
}

/**
 * El centro de la región: la MEDIANA de las tiendas con punto (no la media: una tienda mal geocodificada en otro estado
 * movería la media hacia ella y luego pasaría su propio filtro). Sin tiendas, el centro de la zona local.
 */
export function centroDeLasTiendas(tiendas: readonly TiendaDelMapa[]): { lat: number; lng: number } {
  const con = tiendas.filter((s) => esCoordenada(s.lat, s.lng));
  if (!con.length) return centroDeLaZona();
  return { lat: mediana(con.map((s) => s.lat)), lng: mediana(con.map((s) => s.lng)) };
}

export interface PuntosParaEncuadrar { validos: [number, number][]; descartados: Punto[] }

/**
 * Qué puntos entran en el encuadre: fuera los `0,0`, los no numéricos, los imposibles y los que caen a más de
 * `RADIO_MAX_KM` del centro de las tiendas. Los descartados se devuelven para que quien pinta los cuente en desarrollo.
 */
export function puntosParaEncuadrar(puntos: readonly Punto[], tiendas: readonly TiendaDelMapa[]): PuntosParaEncuadrar {
  const centro = centroDeLasTiendas(tiendas);
  const validos: [number, number][] = [], descartados: Punto[] = [];
  for (const p of puntos) {
    const [lat, lng] = p;
    if (esCoordenada(lat, lng) && distanceMeters(centro, { lat, lng }) <= RADIO_MAX_KM * 1000) validos.push([lat, lng]);
    else descartados.push(p);
  }
  return { validos, descartados };
}

/**
 * El encuadre de la REGIÓN: la vista por defecto. El dueño, 2026-10-18, literal: «so when zoomed out on the emaul i mean
 * to shoq all the region i mean exavtly viisnle all stores but not furhter than that as a degault view». O sea, la caja
 * EXACTA de las tiendas de Ajustes (el margen lo pone el `padding` de `fitBounds`, 45 px), ni un grado más. Solo si esa
 * caja es más chica que `2 × MEDIO_LADO_MINIMO` de lado (una tienda sola, o dos en la misma ciudad) se abre hasta ese
 * mínimo alrededor de su centro: una tienda no es un punto, es su ciudad. Sin tiendas con punto, la caja de la zona
 * local. Devuelve las dos esquinas, listas para `fitBounds`.
 */
export function encuadreDeLaRegion(tiendas: readonly TiendaDelMapa[]): [[number, number], [number, number]] {
  const propias = puntosParaEncuadrar(tiendas.map((s) => [s.lat, s.lng] as const), tiendas).validos;
  const base: readonly Punto[] = propias.length ? propias : LOCAL_ZONE_DEFAULT;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lat, lng] of base) {
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
  }
  if (maxLat - minLat < 2 * MEDIO_LADO_MINIMO) { const c = (minLat + maxLat) / 2; minLat = c - MEDIO_LADO_MINIMO; maxLat = c + MEDIO_LADO_MINIMO; }
  if (maxLng - minLng < 2 * MEDIO_LADO_MINIMO) { const c = (minLng + maxLng) / 2; minLng = c - MEDIO_LADO_MINIMO; maxLng = c + MEDIO_LADO_MINIMO; }
  return [[minLat, minLng], [maxLat, maxLng]];
}

/**
 * El zoom (Web Mercator, teselas de 256 px) al que una caja cabe en un mapa de `anchoPx × altoPx` dejando `margenPx` por
 * lado: lo mismo que calcula `fitBounds`, pero sin mapa, para fijar el TOPE de alejamiento en «la región de las tiendas»
 * («not further than that»): ningún encuadre —ni el de un día con una parada lejana— se aleja más que eso. Con fracción;
 * quien lo use lo redondea hacia abajo, que es «un poco más que la región», nunca menos.
 */
export function zoomDeLaCaja(caja: readonly [Punto, Punto], anchoPx: number, altoPx: number, margenPx = 45): number {
  const [[minLat, minLng], [maxLat, maxLng]] = caja;
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const fracLat = Math.abs(merc(maxLat) - merc(minLat)) / (2 * Math.PI);
  const fracLng = Math.abs(maxLng - minLng) / 360;
  const util = (px: number) => Math.max(px - 2 * margenPx, 64) / 256;
  return Math.min(Math.log2(util(altoPx) / fracLat), Math.log2(util(anchoPx) / fracLng));
}

/** El `minZoom` del mapa: la región de las tiendas redondeada hacia abajo, y nunca por debajo de `ZOOM_MINIMO_DEL_MAPA`. */
export function topeDeAlejamiento(tiendas: readonly TiendaDelMapa[], anchoPx: number, altoPx: number): number {
  const z = zoomDeLaCaja(encuadreDeLaRegion(tiendas), anchoPx, altoPx);
  return Number.isFinite(z) ? Math.max(ZOOM_MINIMO_DEL_MAPA, Math.floor(z)) : ZOOM_MINIMO_DEL_MAPA;
}

/**
 * Lo que `fitBounds` recibe: los puntos válidos, o la región si no queda ninguno. `fitTo` ausente es «quien monta el
 * mapa no encuadra» (la ficha, el estimador, Almacén) y se respeta: devuelve `null`.
 */
export function encuadreFinal(fitTo: readonly Punto[] | undefined, tiendas: readonly TiendaDelMapa[]): PuntosParaEncuadrar & { region: boolean } | null {
  if (!fitTo) return null;
  const r = puntosParaEncuadrar(fitTo, tiendas);
  return r.validos.length ? { ...r, region: false } : { validos: encuadreDeLaRegion(tiendas), descartados: r.descartados, region: true };
}

/** El primer punto que sirve para centrar el mapa al crearlo, o el centro de las tiendas. */
export function centroInicial(puntos: readonly Punto[], tiendas: readonly TiendaDelMapa[]): { lat: number; lng: number } {
  const v = puntosParaEncuadrar(puntos, tiendas).validos[0];
  return v ? { lat: v[0], lng: v[1] } : centroDeLasTiendas(tiendas);
}
