import { MINUTOS_POR_BLOQUE } from "@/lib/route-engine";

/**
 * Las claves de la caché de tiempos de viaje (D-318): origen, destino, día de la semana, bloque horario,
 * y si es con tráfico. Diseño en `docs/route-algorithm-design.md`, §3.2.
 */

export type LatLng = { lat: number; lng: number };

/** Un punto como clave: lat y lng a 5 decimales (~1 m), la misma precisión que ya usa la caché de
 *  `/api/optimize-route`. Dos direcciones que caen en el mismo metro comparten tiempos. */
export function claveDePunto(p: LatLng): string {
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

export function puntoDeClave(clave: string): LatLng | null {
  const [lat, lng] = clave.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** El día de la semana de una fecha `YYYY-MM-DD`: 0 = domingo … 6 = sábado. Por sus PARTES y en UTC, para
 *  que el mismo día dé lo mismo en el portátil (Guatemala) y en CI (UTC). `null` si no es una fecha. */
export function diaDeLaSemana(fechaISO: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaISO);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Una fecha imposible (2026-02-31) rebosa al mes siguiente: no es ese día.
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? d.getUTCDay() : null;
}

/** Sin tráfico el tiempo no depende del día ni de la hora: se guarda una sola vez, con estos dos valores. */
export const SIN_DIA = -1;
export const SIN_BLOQUE = -1;
export const BLOQUES_POR_DIA = (24 * 60) / MINUTOS_POR_BLOQUE;

export type ClaveDeTiempo = { origen: string; destino: string; dia: number; bloque: number; trafico: boolean };

export const textoDeClave = (k: ClaveDeTiempo): string => `${k.origen}|${k.destino}|${k.dia}|${k.bloque}|${k.trafico ? 1 : 0}`;

export const claveSinTrafico = (origen: string, destino: string): ClaveDeTiempo => ({ origen, destino, dia: SIN_DIA, bloque: SIN_BLOQUE, trafico: false });

/** Cuánto vale una respuesta guardada. Sin tráfico, 90 días (las carreteras no cambian); con tráfico, 28:
 *  cuatro semanas del mismo día y la misma media hora. */
export const CADUCIDAD_DIAS = { sinTrafico: 90, conTrafico: 28 } as const;
