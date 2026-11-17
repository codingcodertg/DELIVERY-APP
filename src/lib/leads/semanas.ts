/**
 * Las semanas del STXP Pool: cada importación semanal del Excel de permisos (un lote con el mismo `imported_at`) es una
 * semana. Se cuentan por DÍA CALENDARIO de Chicago (no por UTC ni por milisegundo): dos lotes del mismo día son una
 * sola semana. Van de la más vieja a la más nueva: Semana 1, Semana 2, …
 *
 * Función pura, sin base ni navegador: la pantalla la usa para el selector «Semana», la insignia de cada tarjeta y
 * para filtrar. Un lead sin `imported_at` (o que no es privado) no cae en ninguna semana.
 */

import { formateadorDeFecha } from "../formateador";

export const ZONA_DE_LAS_SEMANAS = "America/Chicago";

/** Año, mes y día de un instante en la zona de Chicago (con el horario de verano que toque). El formateador, cacheado. */
const partesDeDia = () => formateadorDeFecha("en-US", { timeZone: ZONA_DE_LAS_SEMANAS, year: "numeric", month: "2-digit", day: "2-digit" });

/** El día calendario de Chicago de un instante, como «2026-10-30» (el orden de texto es el orden de las fechas). null si no es fecha. */
export function diaDeChicago(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p: Record<string, string> = {};
  for (const x of partesDeDia().formatToParts(d)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

export interface SemanaDelPool {
  /** 1 para la más vieja. */
  numero: number;
  /** El día de Chicago del import, «2026-10-30». */
  dia: string;
  /** Lo que se enseña de la fecha: «10/30». */
  fecha: string;
  /** Cuántos leads privados trajo este import. */
  cuenta: number;
}

export interface SemanasDelPool {
  /** De la más vieja a la más nueva. */
  semanas: SemanaDelPool[];
  /** id del lead → número de semana. Los leads sin semana no están. */
  semanaDeLead: Map<string, number>;
}

/** Las semanas de los leads privados, con su conteo y el número de semana de cada lead. */
export function semanasDelPool(leads: readonly { id: string; source?: string; imported_at?: string | null }[]): SemanasDelPool {
  const diaDeLead = new Map<string, string>();
  const cuentaPorDia = new Map<string, number>();
  for (const l of leads) {
    if (l.source !== "privado") continue;
    const dia = diaDeChicago(l.imported_at);
    if (!dia) continue;
    diaDeLead.set(l.id, dia);
    cuentaPorDia.set(dia, (cuentaPorDia.get(dia) ?? 0) + 1);
  }
  const dias = [...cuentaPorDia.keys()].sort();
  const numeroDeDia = new Map(dias.map((dia, i) => [dia, i + 1]));
  const semanas: SemanaDelPool[] = dias.map((dia) => ({
    numero: numeroDeDia.get(dia)!, dia, fecha: `${dia.slice(5, 7)}/${dia.slice(8, 10)}`, cuenta: cuentaPorDia.get(dia)!,
  }));
  const semanaDeLead = new Map<string, number>();
  for (const [id, dia] of diaDeLead) semanaDeLead.set(id, numeroDeDia.get(dia)!);
  return { semanas, semanaDeLead };
}

/** «Week 1 · 10/30» o, en español, «Semana 1 · 10/30». */
export function etiquetaDeSemana(s: Pick<SemanaDelPool, "numero" | "fecha">, lang: "en" | "es" = "en"): string {
  return `${lang === "es" ? "Semana" : "Week"} ${s.numero} · ${s.fecha}`;
}

/**
 * Qué semana se enseña. `elegida` es lo que la persona guardó: «todas», el número de una semana (como texto) o null
 * (nunca eligió). Sin elección y con semanas, la más nueva (los leads nuevos, primero). Un número que ya no existe
 * cae también a la más nueva. Sin semanas, «todas».
 */
export function semanaInicial(elegida: string | null, semanas: readonly Pick<SemanaDelPool, "numero">[]): number | "todas" {
  if (semanas.length === 0) return "todas";
  if (elegida === "todas") return "todas";
  const n = Number(elegida);
  if (elegida !== null && semanas.some((s) => s.numero === n)) return n;
  return semanas[semanas.length - 1].numero;
}
