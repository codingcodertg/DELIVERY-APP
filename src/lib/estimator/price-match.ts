/**
 * «Price Match» en una línea de la cotización (D-NEXT). El dueño, 2026-10-14: «Quote builder should allow you to tag
 * "Price Match" to a price so its known that competitors are giving low».
 *
 * Es una **marca interna** sobre el precio de la línea: «este precio se bajó porque un competidor cotiza más bajo». La
 * ve el vendedor en el Quote Builder y la ven las listas («Todas las cotizaciones» / «Mis cotizaciones»), con su
 * columna para filtrar; **nunca sale en la hoja del cliente**, igual que el estimado de la competencia (D-425):
 * `hojaDelCliente` arma cada fila campo por campo y no lee estas claves.
 *
 * Dónde se guarda: en el mismo `jsonb` `lines` de `estimator_quotes` (148), como el precio más bajo de D-442 — dos
 * claves opcionales por línea, `price_match` (solo `true` cuenta) y `price_match_competitor` (el competidor, texto libre
 * y opcional). **Sin migración.** Una línea sin marcar NO lleva las claves (ni `false`): así una cotización vieja y una
 * nueva sin marcar son el mismo `jsonb`, y «sin la clave» se lee como «sin marcar».
 */

import { TOPES_DE_TEXTO } from "./competencia";
import { competidoresUsados } from "./lectura";
import type { QuoteLine } from "./modelo";

/** Las dos claves, tal como van en el `jsonb` de la línea. */
export interface MarcaPriceMatch {
  price_match?: boolean;
  /** El competidor que cotiza más bajo. Opcional; solo tiene sentido con `price_match`. */
  price_match_competitor?: string;
}

/** ¿La línea lleva la marca? Solo el booleano `true`: un `"true"` o un `1` tocados a mano en la base no cuentan. */
export function tienePriceMatch(l: MarcaPriceMatch | null | undefined): boolean {
  return l?.price_match === true;
}

/** El competidor escrito, recortado y con el mismo tope que la empresa del estimado de la competencia (120). */
export function competidorLimpio(texto: unknown): string {
  return typeof texto === "string" ? texto.trim().slice(0, TOPES_DE_TEXTO.competidor) : "";
}

/**
 * Lo que `borradorDeFila` saca de una línea cruda del `jsonb`: nada si no está marcada (una fila vieja, o una que se
 * desmarcó), y si lo está, la marca y el competidor si hay. El competidor de una línea SIN marca se descarta: sin la
 * marca no dice nada.
 */
export function marcaDeFila(cruda: Record<string, unknown>): MarcaPriceMatch {
  if (cruda.price_match !== true) return {};
  const competidor = competidorLimpio(cruda.price_match_competitor);
  return competidor ? { price_match: true, price_match_competitor: competidor } : { price_match: true };
}

/** La línea sin las dos claves: desmarcar las QUITA (no deja un `false` en el `jsonb`). */
function sinMarca<L extends QuoteLine>(l: L): L {
  const copia = { ...l };
  delete copia.price_match;
  delete copia.price_match_competitor;
  return copia;
}

/**
 * Marcar o desmarcar. Al marcar, el competidor que ya tuviera la línea se queda; si no tenía y la cotización tiene
 * **un solo** competidor en sus estimados adjuntos (D-425), se pone ese: es casi seguro el que cotiza más bajo. Con dos
 * o más no se adivina: se ofrecen en la lista y el vendedor elige o lo deja vacío.
 */
export function alternarPriceMatch<L extends QuoteLine>(l: L, adjuntos: readonly string[]): L {
  if (tienePriceMatch(l)) return sinMarca(l);
  const previo = competidorLimpio(l.price_match_competitor);
  const unico = adjuntos.length === 1 ? competidorLimpio(adjuntos[0]) : "";
  const competidor = previo || unico;
  return competidor ? { ...l, price_match: true, price_match_competitor: competidor } : { ...l, price_match: true };
}

/**
 * Escribir el competidor. Sin la marca no se escribe nada (la casilla no se enseña); vacío (o solo espacios) quita la
 * clave. Lo tecleado se guarda **sin recortar** (solo el tope de 120): recortar en cada tecla se comería el espacio de
 * «Floor & Decor» al escribirlo, como el punto de D-420. El recorte va al leer (`marcaDeFila`, `etiquetaPriceMatch`).
 */
export function ponCompetidor<L extends QuoteLine>(l: L, texto: string): L {
  if (!tienePriceMatch(l)) return l;
  const crudo = texto.slice(0, TOPES_DE_TEXTO.competidor);
  if (crudo.trim()) return { ...l, price_match_competitor: crudo };
  const copia = { ...l };
  delete copia.price_match_competitor;
  return copia;
}

/** La etiqueta que se pinta junto al precio: «Price Match» o «Price Match · vs Floor & Decor». Null sin la marca. */
export function etiquetaPriceMatch(l: MarcaPriceMatch): string | null {
  if (!tienePriceMatch(l)) return null;
  const competidor = competidorLimpio(l.price_match_competitor);
  return competidor ? `Price Match · vs ${competidor}` : "Price Match";
}

/** Cuántas líneas de la cotización llevan la marca: lo que la lista guarda en cada resumen. */
export function lineasConPriceMatch(lineas: readonly MarcaPriceMatch[]): number {
  return lineas.reduce((n, l) => n + (tienePriceMatch(l) ? 1 : 0), 0);
}

/** Cuántas cotizaciones de una lista tienen al menos una línea marcada: el «N con Price Match» de la cabecera. */
export function cotizacionesConPriceMatch(filas: readonly { price_match_lines: number }[]): number {
  return filas.reduce((n, c) => n + (c.price_match_lines > 0 ? 1 : 0), 0);
}

/**
 * Los competidores de los estimados pegados a ESTA cotización (D-425), para ofrecerlos al escribir el de la marca: el
 * de la lectura si se leyó (D-466), si no el escrito al subir; sin repetir ni vacíos (`competidoresUsados`).
 */
export function competidoresAdjuntos(
  archivos: readonly { id: string; competitor: string | null }[],
  lecturas: Readonly<Record<string, { competitor: string | null } | undefined>>,
): string[] {
  return competidoresUsados(archivos.map((a) => lecturas[a.id]?.competitor ?? a.competitor));
}
