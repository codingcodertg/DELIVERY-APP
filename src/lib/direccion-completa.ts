import type { Delivery } from "@/lib/types";
import { ciudadDeEntrega } from "@/lib/ciudad-de-entrega";
import { puntosParaEncuadrar, type TiendaDelMapa } from "@/lib/encuadre-del-mapa";
import { esSoloCiudad } from "@/lib/solo-ciudad";
import { isStoreToStore, type OrderTypeRules } from "@/lib/required";
import { recogidaParaElChofer } from "@/lib/recogida-y-ruta-del-dia";

/**
 * Una dirección a medias no se guarda (D-589).
 *
 * El dueño, el 2026-10-18: «delivery address always need to be completed because right now a half saved delivery was 1500
 * miles away s make that rule so that doesnt happens anymore». El caso: la orden #1071, «4408 QUEEN PALM» —sin ciudad ni
 * estado—, que `geocode-on-save` ubicó en Florida (26.18, −80.23), a 1.788 km del Valle. Hasta hoy la ficha solo pedía que
 * la dirección NO estuviera vacía (`missingFields`), y el punto lo buscaba después de guardar, sin mirar dónde caía.
 *
 * Dos reglas, las dos puras y medibles:
 *
 *  1. **Completa** (`direccionCompleta`): calle con número, ciudad, y estado o código postal. Una dirección SOLO ciudad
 *     («Mission, TX, USA») sigue valiendo, porque es lo que el dueño pidió en D-454 como respuesta amplia y la orden ya
 *     sale marcada «solo ciudad — dirección por confirmar»; lo que se cierra es la calle sin ciudad, que es lo que viajó
 *     1.500 millas. Se devuelve QUÉ falta, para decírselo.
 *  2. **Dentro de la región** (`puntoDentroDeLaRegion`): el punto —geocodificado o el pin— cae a menos de `RADIO_MAX_KM`
 *     (300 km) del centro de las tiendas de Ajustes. Es EXACTAMENTE el filtro de D-580 (`puntosParaEncuadrar`): lo que
 *     el mapa ya no encuadra, la ficha ya no guarda.
 *
 * Qué se revisa lo decide `direccionesARevisar`: la de entrega cuando va a un cliente o una obra (en una intertienda
 * la pone Ajustes), y la de recogida cuando NO es una tienda de Ajustes (ahí la teclea una persona).
 */

export type Falta = "numero" | "ciudad" | "estado";

export interface Completitud {
  ok: boolean;
  /** Lo que falta, en el orden en que se lee una dirección. Vacío cuando `ok`. */
  falta: Falta[];
  /** Es solo una ciudad (D-454): vale, pero quien pinta ya la marca «por confirmar». */
  soloCiudad: boolean;
}

const PAIS = /^(?:usa|us|u\.s\.a?\.?|united states(?: of america)?|estados unidos|m[eé]xico|mx)$/i;
const CODIGO_POSTAL = /^\d{5}(?:-\d{4})?$/;
const ESTADO_SIGLA = /^[A-Z]{2}\.?(?:\s+\d{5}(?:-\d{4})?)?$/;
const ESTADO_NOMBRE = /^(?:tx|texas|tamaulipas|tamps\.?|nuevo le[oó]n|n\.\s?l\.)\.?(?:\s*\d{5}(?:-\d{4})?)?$/i;
/** Un estado o un código postal PEGADOS detrás de la ciudad, en su mismo trozo: «McAllen TX», «McAllen TX 78504», «McAllen 78504». */
const COLA_ESTADO_O_POSTAL = /\s(?:[A-Z]{2}\.?|texas|tx\.?)(?:\s+\d{5}(?:-\d{4})?)?$|\s\d{5}(?:-\d{4})?$/i;
/** Un lote, apartamento o suite con su número (el mismo patrón que `ciudad-de-entrega`): no es ni la calle ni su número. */
const UNIDAD = /(?:\b(?:lote|lot|apt|apartment|unit|ste|suite|sweet|spc|space|trlr)\b\.?|#)\s*#?\s*[a-z]?-?\d+[a-z]?\b/gi;

/** ¿La dirección dice el estado o el código postal? Se mira desde el final, quitado el país. */
function traeEstadoOPostal(trozos: string[]): boolean {
  const t = [...trozos];
  while (t.length > 1 && PAIS.test(t[t.length - 1])) t.pop();
  // Desde el final hacia la calle: el primer trozo que sea estado o código postal cuenta; el formato de Nominatim
  // («…, Hidalgo County, Texas, 78577, United States») entra por el código postal, que va detrás del condado.
  for (let i = t.length - 1; i >= 1; i--) {
    const x = t[i];
    if (CODIGO_POSTAL.test(x) || ESTADO_SIGLA.test(x) || ESTADO_NOMBRE.test(x)) return true;
    // Es la ciudad (u otra cosa): si lleva el estado pegado, vale; si no, ya no hay nada detrás que lo diga.
    return COLA_ESTADO_O_POSTAL.test(x);
  }
  // Un solo trozo («123 Main St McAllen TX 78504»): el estado va pegado al final.
  return t.length === 1 && COLA_ESTADO_O_POSTAL.test(t[0]);
}

/**
 * ¿Está completa? Calle CON número (el primer trozo lleva un número y letras), ciudad (la que lee `ciudadDeEntrega`;
 * `conocidas` sirve para las tecleadas sin comas, D-423) y estado o código postal. Vacía → le falta todo.
 */
export function direccionCompleta(texto: string | null | undefined, conocidas: Iterable<string> = []): Completitud {
  const limpio = String(texto ?? "").replace(UNIDAD, " ").replace(/\s+/g, " ").trim();
  if (!limpio) return { ok: false, falta: ["numero", "ciudad", "estado"], soloCiudad: false };
  if (esSoloCiudad(limpio)) return { ok: true, falta: [], soloCiudad: true };
  const trozos = limpio.split(",").map((p) => p.trim()).filter(Boolean);
  const calle = trozos[0];
  const falta: Falta[] = [];
  if (!(/\d/.test(calle) && /[a-z]{2,}/i.test(calle))) falta.push("numero");
  if (!ciudadDeEntrega(limpio, conocidas)) falta.push("ciudad");
  if (!traeEstadoOPostal(trozos)) falta.push("estado");
  return { ok: falta.length === 0, falta, soloCiudad: false };
}

/**
 * ¿El punto cae en la región? `null` sin punto (incluido el 0,0, que es «sin punto» desde D-219). El criterio es el de
 * D-580, sin copiarlo: `puntosParaEncuadrar` con un solo punto.
 */
export function puntoDentroDeLaRegion(
  lat: number | null | undefined,
  lng: number | null | undefined,
  tiendas: readonly { lat?: number | null; lng?: number | null }[],
): boolean | null {
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  // Las tiendas de Ajustes pueden no tener punto: entran solo las que lo tienen (como en los mapas).
  const conPunto: TiendaDelMapa[] = tiendas.flatMap((s) => (typeof s.lat === "number" && typeof s.lng === "number" ? [{ lat: s.lat, lng: s.lng }] : []));
  return puntosParaEncuadrar([[lat, lng]], conPunto).validos.length === 1;
}

export type QueDireccion = "entrega" | "recogida";

export interface DireccionARevisar {
  que: QueDireccion;
  texto: string;
  /** El punto que ya tiene la orden y que VALE para esta dirección (el pin a mano, o el geocodificado si la dirección no cambió). */
  punto: { lat: number; lng: number } | null;
  /** Hay que buscarle el punto antes de guardar: no tiene uno que valga. */
  geocodificar: boolean;
}

type FilaConDirecciones = Pick<Partial<Delivery>,
  "order_type" | "store" | "pickup_name" | "pickup_address" | "delivery_address" | "delivery_lat" | "delivery_lng" | "delivery_pin_source">;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Qué direcciones de esta orden las tecleó una persona y hay que revisar. Las vacías no salen: una vacía la cubre
 * `missingFields` (y un borrador puede no tenerla todavía, D-531); lo que se cierra aquí es la que está A MEDIAS.
 */
export function direccionesARevisar(
  fila: FilaConDirecciones,
  anterior: FilaConDirecciones | null | undefined,
  tiendas: readonly { name: string }[],
  reglas: OrderTypeRules | undefined,
): DireccionARevisar[] {
  const out: DireccionARevisar[] = [];
  const entrega = (fila.delivery_address ?? "").trim();
  if (entrega && !isStoreToStore(fila.order_type, reglas)) {
    const lat = fila.delivery_lat, lng = fila.delivery_lng;
    const tienePunto = typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    const mismaQueAntes = !!anterior && norm(anterior.delivery_address) === norm(entrega);
    // El pin a mano vale siempre (lo puso una persona, D-221); el geocodificado solo si la dirección es la misma de antes.
    const vale = tienePunto && (fila.delivery_pin_source === "manual" || mismaQueAntes);
    out.push({ que: "entrega", texto: entrega, punto: vale ? { lat: lat as number, lng: lng as number } : null, geocodificar: !vale });
  }
  const recogida = recogidaParaElChofer(fila, tiendas, reglas);
  if (!recogida.enTienda && recogida.direccion) {
    // La recogida no guarda punto: se busca al guardar, y solo si es nueva o cambió (una llamada por dirección nueva).
    const mismaQueAntes = !!anterior && norm(anterior.pickup_address) === norm(recogida.direccion);
    out.push({ que: "recogida", texto: recogida.direccion, punto: null, geocodificar: !mismaQueAntes });
  }
  return out;
}

const NOMBRE_FALTA = {
  numero: { en: "street with number", es: "calle con número" },
  ciudad: { en: "city", es: "ciudad" },
  estado: { en: "state or ZIP", es: "estado o código postal" },
} as const;

const QUE = {
  entrega: { en: "delivery address", es: "dirección de entrega" },
  recogida: { en: "pickup address", es: "dirección de recolección" },
} as const;

/** «Completa la dirección de entrega: falta ciudad, estado o código postal. Elígela del buscador.» */
export function avisoDireccionIncompleta(que: QueDireccion, falta: readonly Falta[], lang: string): string {
  const es = lang === "es";
  const lista = falta.map((f) => (es ? NOMBRE_FALTA[f].es : NOMBRE_FALTA[f].en)).join(", ");
  return es
    ? `Completa la ${QUE[que].es}: falta ${lista}. Elígela del buscador (calle con número, ciudad y estado).`
    : `Complete the ${QUE[que].en}: missing ${lista}. Pick it from the search (street with number, city and state).`;
}

/** «La dirección de entrega cayó fuera de la región (a 1.788 km de las tiendas); revísala.» */
export function avisoFueraDeLaRegion(que: QueDireccion, lang: string): string {
  const es = lang === "es";
  return es
    ? `La ${QUE[que].es} cayó fuera de la región (a más de 300 km de las tiendas); revísala. No se guardó.`
    : `The ${QUE[que].en} landed outside the region (over 300 km from the stores); check it. Not saved.`;
}

/** El tipo de evento con el que queda en el historial que un punto se rechazó por caer fuera. */
export const EVENTO_FUERA_DE_REGION = "geocode_out_of_region";
export const NOTA_FUERA_DE_REGION = "La dirección se ubicó fuera de la región (a más de 300 km de las tiendas) y el punto no se guardó";
