import { LOCAL_ZONE_DEFAULT, type Vertice } from "./delivery-zone";

/**
 * Dónde busca el autocompletado de direcciones (D-NEXT).
 *
 * El dueño: «put the search direction scope in TX and even more on the area marked in the green». Hasta ahora lo único que
 * se le decía al proveedor era «Estados Unidos», y al teclear una calle salían las de otros estados.
 *
 *   · **Texas es un límite:** una sugerencia de fuera no se enseña. Si no queda ninguna, no sale ninguna — nunca las de otro
 *     estado «por no dejarlo vacío».
 *   · **La zona verde es un sesgo, no un límite:** lo de dentro sale primero, pero hay entregas fuera de zona (con su tarifa) y
 *     tienen que poder buscarse. «Lo verde» es `LOCAL_ZONE_DEFAULT`, el mismo polígono que pintan los mapas (D-219); la caja
 *     se CALCULA de él, así que si el contorno se mueve, la búsqueda lo sigue.
 *
 * Puro: aquí se construye lo que se pide y se decide qué respuesta vale. Quien llama a la red es `/api/geocode`.
 *
 * **Places, medido el 2026-09-19 por el orquestador con dos llamadas reales** («100 Main St», la caja de la zona): con
 * `locationBias` contesta 200 pero no prioriza lo bastante —5 sugerencias, 1 de Texas y 4 de otros estados: con el filtro
 * quedaría UNA—; con `locationRestriction` a la misma caja, 5 de 5 locales. Por eso Places va en DOS pasos, los dos con
 * restricción: primero la zona verde, y solo si lo local escasea, Texas (`sugerenciasDePlaces`). Así una entrega fuera de zona
 * sigue pudiendo buscarse y la segunda llamada solo se gasta cuando hace falta. El formato es «…, La Feria, TX, USA».
 * Las respuestas de los otros tres proveedores siguen sin verificar con una llamada real.
 */

export interface Caja { sur: number; oeste: number; norte: number; este: number }

/** La caja que envuelve un contorno de vértices `[lat, lng]`. */
export function cajaDe(contorno: readonly Vertice[]): Caja {
  const lats = contorno.map((v) => v[0]), lngs = contorno.map((v) => v[1]);
  return { sur: Math.min(...lats), oeste: Math.min(...lngs), norte: Math.max(...lats), este: Math.max(...lngs) };
}

export const centroDe = (c: Caja): { lat: number; lng: number } => ({ lat: (c.sur + c.norte) / 2, lng: (c.oeste + c.este) / 2 });

/** La caja de la zona verde. */
export const CAJA_DE_LA_ZONA: Caja = cajaDe(LOCAL_ZONE_DEFAULT);

/** Texas, por fuera: geografía, no un dato de nadie. La caja incluye trozos de los estados vecinos y de México, así que donde
 *  se usa como límite se acompaña SIEMPRE del filtro por estado de abajo. */
export const CAJA_DE_TEXAS: Caja = { sur: 25.83, oeste: -106.65, norte: 36.51, este: -93.5 };

// ---------------------------------------------------------------- lo que se pide

export function cuerpoDePlaces(q: string, caja: Caja): object {
  return {
    input: q,
    includedRegionCodes: ["us"],
    locationRestriction: { rectangle: { low: { latitude: caja.sur, longitude: caja.oeste }, high: { latitude: caja.norte, longitude: caja.este } } },
  };
}

/** Con menos sugerencias locales que estas, se pregunta también por todo Texas. */
export const MINIMO_LOCALES = 3;
/** Cuántas sugerencias de Places se enseñan como mucho. */
export const TOPE_DE_PLACES = 5;

/**
 * Places en dos pasos. `pide` hace la llamada de verdad (la ruta) o la finge (las pruebas) y devuelve los textos sugeridos.
 * Una llamada que falla cuenta como vacía: si la local falla se intenta Texas igual, en vez de darse por vencido sin probar.
 * La caja de Texas pisa estados vecinos y México, así que lo que vuelve se filtra SIEMPRE por estado.
 */
export async function sugerenciasDePlaces(q: string, pide: (cuerpo: object) => Promise<string[]>): Promise<string[]> {
  const deTexas = async (caja: Caja) => (await pide(cuerpoDePlaces(q, caja)).catch(() => [] as string[])).filter(esTextoDeTexas);
  const locales = await deTexas(CAJA_DE_LA_ZONA);
  if (locales.length >= MINIMO_LOCALES) return locales.slice(0, TOPE_DE_PLACES);
  const resto = await deTexas(CAJA_DE_TEXAS);
  return [...new Set([...locales, ...resto])].slice(0, TOPE_DE_PLACES);
}

export function urlDeGoogleGeocode(q: string, key: string): string {
  const z = CAJA_DE_LA_ZONA;
  return `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=us` +
    `&components=${encodeURIComponent("administrative_area:TX|country:US")}` +
    `&bounds=${encodeURIComponent(`${z.sur},${z.oeste}|${z.norte},${z.este}`)}&key=${key}`;
}

export function urlDeMapbox(q: string, token: string): string {
  const t = CAJA_DE_TEXAS, c = centroDe(CAJA_DE_LA_ZONA);
  return `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
    `?autocomplete=true&limit=5&country=us&bbox=${t.oeste},${t.sur},${t.este},${t.norte}&proximity=${c.lng},${c.lat}&access_token=${token}`;
}

export function urlDeOSM(q: string): string {
  const t = CAJA_DE_TEXAS;
  return `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=us` +
    `&addressdetails=1&bounded=1&viewbox=${t.oeste},${t.norte},${t.este},${t.sur}`;
}

// ---------------------------------------------------------------- qué respuesta vale

/**
 * Places solo da TEXTO («…, McAllen, TX, USA»). Anclado al FINAL: el estado es lo último antes del código postal y el país.
 * Así «Texarkana, AR, USA» no cuela por empezar por «Tex», ni una calle «TX-107» de otro estado por llevar «TX» delante.
 */
export function esTextoDeTexas(texto: string | null | undefined): boolean {
  return /,\s*(TX|Texas)(\s+\d{5}(-\d{4})?)?(\s*,\s*(USA|US|United States|EE\.\s?UU\.|Estados Unidos))?\s*$/i.test(texto ?? "");
}

/** Google Geocoding: los componentes de la dirección, estructurados. */
export function esDeTexasGoogle(r: { address_components?: { short_name?: string; types?: string[] }[] }): boolean {
  return (r.address_components ?? []).some((c) => (c.types ?? []).includes("administrative_area_level_1") && c.short_name === "TX");
}

/** Mapbox: el contexto de la sugerencia (o ella misma, si lo que se sugiere es la región). */
export function esDeTexasMapbox(f: { id?: string; properties?: { short_code?: string }; context?: { id?: string; short_code?: string }[] }): boolean {
  const regiones = [...(f.context ?? []), { id: f.id, short_code: f.properties?.short_code }].filter((c) => (c.id ?? "").startsWith("region."));
  return regiones.some((c) => (c.short_code ?? "").toUpperCase() === "US-TX");
}

/** Nominatim con `addressdetails=1`. */
export function esDeTexasOSM(d: { address?: Record<string, string | undefined> }): boolean {
  return d.address?.["ISO3166-2-lvl4"] === "US-TX";
}
