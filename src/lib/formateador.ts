/**
 * Formateadores de fecha y número CACHEADOS (D-NEXT, 2026-10-29).
 *
 * El dueño: «últimamente el app se froze por segundos». Medido: construir un `Intl.DateTimeFormat` con zona horaria
 * cuesta ~0,06 ms; 5.000 construcciones, 307 ms; el mismo formateador reutilizado, 7 ms (44 veces menos). La app lo
 * construía en CADA llamada —`todayISO()`, `fmtDateShort`, `nowHHMM` y una veintena de sitios más—, y el tablero de
 * Órdenes llama a esas funciones varias veces POR FILA en cada recálculo (filtros, cuentas por etapa, orden, celdas),
 * que se repite con cada evento en tiempo real. Con ~1.000 órdenes eran decenas de miles de construcciones por evento.
 *
 * Aquí viven los formateadores, uno por combinación de idioma y opciones, creados la primera vez y reutilizados
 * después. Sin dependencias, para que lo importe cualquiera sin ciclos.
 */
const fechas = new Map<string, Intl.DateTimeFormat>();
const numeros = new Map<string, Intl.NumberFormat>();

export function formateadorDeFecha(locale: string | string[] | undefined, opciones?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const clave = `${Array.isArray(locale) ? locale.join(",") : locale ?? ""}|${opciones ? JSON.stringify(opciones) : ""}`;
  let f = fechas.get(clave);
  if (!f) { f = new Intl.DateTimeFormat(locale, opciones); fechas.set(clave, f); }
  return f;
}

export function formateadorDeNumero(locale: string | string[] | undefined, opciones?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const clave = `${Array.isArray(locale) ? locale.join(",") : locale ?? ""}|${opciones ? JSON.stringify(opciones) : ""}`;
  let f = numeros.get(clave);
  if (!f) { f = new Intl.NumberFormat(locale, opciones); numeros.set(clave, f); }
  return f;
}

/** Cuántos formateadores hay en caché (para las pruebas). */
export const formateadoresEnCache = () => fechas.size + numeros.size;
