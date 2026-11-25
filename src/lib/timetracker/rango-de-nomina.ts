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

const MS_DIA = 86_400_000;
const aMs = (dia: string) => Date.parse(`${dia}T00:00:00Z`);

/** Una fecha `YYYY-MM-DD` de verdad: año entre 2000 y 2100, y que vuelve a escribirse igual (no hay 2026-02-31 ni 2026-13-01). */
export function esFechaDeNomina(dia: unknown): dia is string {
  if (typeof dia !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const ms = aMs(dia);
  if (!Number.isFinite(ms)) return false;
  const anio = Number(dia.slice(0, 4));
  return anio >= 2000 && anio <= 2100 && new Date(ms).toISOString().slice(0, 10) === dia;
}

/**
 * El rango pedido por la URL, validado en un solo sitio: las dos fechas son reales y `desde` no va después de
 * `hasta` (se compara como instante, no como texto). Si algo no cuadra, `null`: quien llama usa la semana de hoy.
 */
export function rangoValidoDeNomina(desde: unknown, hasta: unknown): Rango | null {
  if (!esFechaDeNomina(desde) || !esFechaDeNomina(hasta)) return null;
  if (aMs(desde) > aMs(hasta)) return null;
  return { desde, hasta };
}

/** Cuántas semanas de pago tocan el rango. Aritmética: no recorre nada, así que vale para cualquier rango. */
export function cuantasSemanasDePago(desde: string, hasta: string, diaDeInicio: number = DIA_DE_INICIO_DE_PAGO): number {
  if (aMs(desde) > aMs(hasta)) return 0;
  const a = aMs(inicioDeSemanaDePago(desde, diaDeInicio));
  const b = aMs(inicioDeSemanaDePago(hasta, diaDeInicio));
  return Math.round((b - a) / MS_DIA / 7) + 1;
}

/**
 * Las semanas de pago del rango, la más antigua primero, como mucho `max`. Si el rango es más largo, se quedan
 * las `max` semanas que terminan en la de `hasta` (las más recientes). Nunca recorre el rango: cuenta hacia atrás
 * desde la semana de `hasta`, así que un rango enorme cuesta lo mismo que uno de una semana.
 */
export function semanasDePagoDelRango(desde: string, hasta: string, diaDeInicio: number = DIA_DE_INICIO_DE_PAGO, max: number = MAX_SEMANAS_DE_NOMINA): string[] {
  const n = cuantasSemanasDePago(desde, hasta, diaDeInicio);
  if (n <= 0 || max <= 0) return [];
  const k = Math.min(n, Math.floor(max));
  const primera = sumar(inicioDeSemanaDePago(hasta, diaDeInicio), -7 * (k - 1));
  return Array.from({ length: k }, (_, i) => sumar(primera, 7 * i));
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
  // Dos rangos son el mismo conjunto de semanas si empiezan y terminan en la misma semana de pago.
  const clave = (d: string, h: string) => `${inicioDeSemanaDePago(d)}..${inicioDeSemanaDePago(h)}`;
  const semanas = clave(desde, hasta);
  for (const a of ATAJOS_DE_NOMINA) {
    const r = rangoDeAtajo(a, hoy, {}, DIA_DE_INICIO_DE_PAGO);
    if (clave(r.desde, r.hasta) === semanas) return { atajo: a, desde: "", hasta: "" };
  }
  return { atajo: "otro", desde, hasta };
}

/**
 * Lo que la URL tiene que llevar para una elección del menú: `period` si el rango son exactamente UNA semana
 * de pago (la forma de siempre), y `desde`/`hasta` en cualquier otro caso. Null si el rango «a mano» no cuadra.
 */
export function parametrosDeRango(r: Rango): { period: string } | { desde: string; hasta: string } | null {
  const valido = rangoValidoDeNomina(r.desde, r.hasta);
  if (!valido) return null;
  if (cuantasSemanasDePago(valido.desde, valido.hasta) === 1) return { period: inicioDeSemanaDePago(valido.desde) };
  return { desde: valido.desde, hasta: valido.hasta };
}

/** El rango que se aplica de una elección del menú, ya en semanas de pago completas. Null si no cuadra. */
export function rangoDeLaEleccion(e: Eleccion, hoy: string): Rango | null {
  if (e.atajo === "otro") return rangoValidoDeNomina(e.desde, e.hasta);
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
