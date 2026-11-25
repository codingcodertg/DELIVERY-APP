// El rango de Nómina (2026-11-24): lo que elige el menú de fechas se vuelve una lista de SEMANAS DE PAGO
// enteras (de viernes a jueves). La semana de pago sigue siendo la unidad de la nómina: cerrar, pagar y aprobar
// van siempre por una sola. Un rango de varias semanas es solo para ver, y se junta aquí, por persona.
//
// Pura: sin base, sin React. Lo usan la página (`payroll/page.tsx`), la pantalla y las pruebas.

import type { PayEntry } from "@/lib/clockin/payroll";
import { rangoDeAtajo, type Atajo, type Eleccion, type Rango } from "@/lib/almacen-ops/rango-de-merma";

/** El orden en que se busca el atajo de una elección: primero los de semana, que son los de la nómina. */
const ATAJOS_DE_NOMINA: readonly Atajo[] = ["semana", "semana-pasada", "mes", "mes-pasado", "30-dias", "hoy", "ayer"];

/** El viernes: `weekStartDay` de la empresa para la nómina (la semana de pago de Nómina, de viernes a jueves). */
export const DIA_DE_INICIO_DE_PAGO = 5;
/** Un rango de nómina nunca pasa de catorce semanas: lo que sobra por delante se recorta y la pantalla lo dice. */
export const MAX_SEMANAS_DE_NOMINA = 14;

const aFecha = (dia: string) => { const [a, m, d] = dia.split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const aDia = (f: Date) => f.toISOString().slice(0, 10);
const sumar = (dia: string, n: number) => { const f = aFecha(dia); f.setUTCDate(f.getUTCDate() + n); return aDia(f); };

/** El primer día de la semana de pago que contiene `dia`. */
export function inicioDeSemanaDePago(dia: string, diaDeInicio: number = DIA_DE_INICIO_DE_PAGO): string {
  return sumar(dia, -((aFecha(dia).getUTCDay() - diaDeInicio + 7) % 7));
}

/** Todas las semanas de pago que tocan el rango `desde`…`hasta` (ambos incluidos), la más antigua primero, sin recortar. */
export function semanasDePagoSinRecortar(desde: string, hasta: string, diaDeInicio: number = DIA_DE_INICIO_DE_PAGO): string[] {
  if (desde > hasta) return [];
  const semanas: string[] = [];
  for (let s = inicioDeSemanaDePago(desde, diaDeInicio); s <= hasta; s = sumar(s, 7)) semanas.push(s);
  return semanas;
}

/** Las semanas de pago del rango, como mucho `max`: si el rango es más largo, se quedan las más recientes. */
export function semanasDePagoDelRango(desde: string, hasta: string, diaDeInicio: number = DIA_DE_INICIO_DE_PAGO, max: number = MAX_SEMANAS_DE_NOMINA): string[] {
  const todas = semanasDePagoSinRecortar(desde, hasta, diaDeInicio);
  return todas.length > max ? todas.slice(todas.length - max) : todas;
}

/** Los siete días de una semana de pago que empieza en `inicio`. */
export function diasDeLaSemana(inicio: string): string[] {
  return Array.from({ length: 7 }, (_, i) => sumar(inicio, i));
}

/**
 * La elección del menú que corresponde a un rango de fechas: el atajo que coincide, o «otro» con esas fechas.
 * Los atajos se cuentan con la semana de pago (viernes), no con la de domingo de Operaciones.
 */
export function eleccionDeRango(desde: string, hasta: string, hoy: string): Eleccion {
  const semanas = semanasDePagoSinRecortar(desde, hasta).join(",");
  for (const a of ATAJOS_DE_NOMINA) {
    const r = rangoDeAtajo(a, hoy, {}, DIA_DE_INICIO_DE_PAGO);
    if (semanasDePagoSinRecortar(r.desde, r.hasta).join(",") === semanas) return { atajo: a, desde: "", hasta: "" };
  }
  return { atajo: "otro", desde, hasta };
}

/**
 * Lo que la URL tiene que llevar para una elección del menú: `period` si el rango son exactamente UNA semana
 * de pago (la forma de siempre), y `desde`/`hasta` en cualquier otro caso. Null si el rango «a mano» no cuadra.
 */
export function parametrosDeRango(r: Rango): { period: string } | { desde: string; hasta: string } | null {
  if (!r.desde || !r.hasta || r.desde > r.hasta) return null;
  const semanas = semanasDePagoSinRecortar(r.desde, r.hasta);
  if (semanas.length === 1) return { period: semanas[0] };
  return { desde: r.desde, hasta: r.hasta };
}

/** El rango que se aplica de una elección del menú, ya en semanas de pago completas. Null si no cuadra. */
export function rangoDeLaEleccion(e: Eleccion, hoy: string): Rango | null {
  if (e.atajo === "otro") return e.desde && e.hasta && e.desde <= e.hasta ? { desde: e.desde, hasta: e.hasta } : null;
  return rangoDeAtajo(e.atajo, hoy, {}, DIA_DE_INICIO_DE_PAGO);
}

// ---- Juntar semanas ----

export type PersonaDeNomina = { id: string; name: string; store: string | null; scheduledMin: number; remote: boolean };
export type TiendaDeNomina = { key: string; name: string };
/** Lo que `getPayrollPeriod` devuelve para UNA semana de pago (sin el `ok`). */
export type DatosDeSemana = {
  signedOff: boolean;
  isOwner: boolean;
  approved: string[];
  people: PersonaDeNomina[];
  stores: TiendaDeNomina[];
  entries: PayEntry[];
};

/**
 * Junta las semanas de un rango en una sola vista, por persona. Con una sola semana devuelve la misma (identidad).
 *  - `entries`: todos los fichajes de todas las semanas (los totales de la persona son la suma).
 *  - `people`: una fila por persona; las horas programadas se suman.
 *  - `approved`: solo cuenta quien está aprobado en TODAS las semanas (la aprobación es por semana).
 *  - `signedOff`: el rango está cerrado solo si todas sus semanas lo están.
 */
export function combinaSemanas(semanas: readonly DatosDeSemana[]): DatosDeSemana {
  if (semanas.length === 1) return semanas[0];
  const personas = new Map<string, PersonaDeNomina>();
  const tiendas = new Map<string, TiendaDeNomina>();
  for (const s of semanas) {
    for (const p of s.people) {
      const previa = personas.get(p.id);
      personas.set(p.id, previa ? { ...previa, scheduledMin: previa.scheduledMin + p.scheduledMin } : p);
    }
    for (const t of s.stores) if (!tiendas.has(t.key)) tiendas.set(t.key, t);
  }
  const aprobadosEnTodas = (semanas[0]?.approved ?? []).filter((id) => semanas.every((s) => s.approved.includes(id)));
  return {
    signedOff: semanas.every((s) => s.signedOff),
    isOwner: semanas.some((s) => s.isOwner),
    approved: aprobadosEnTodas,
    people: [...personas.values()],
    stores: [...tiendas.values()],
    entries: semanas.flatMap((s) => s.entries),
  };
}

/** La tienda de la persona, o `null` si no tiene. Para filtrar las partes de Nómina. */
export function personaDeLaTienda(p: { store: string | null }, tienda: string | null): boolean {
  return !tienda || p.store === tienda;
}
