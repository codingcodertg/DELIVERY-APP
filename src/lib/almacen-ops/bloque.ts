// Operaciones de almacén — acciones en bloque sobre la merma (desechar / ajustar varias de una vez). Lógica PURA
// (sin React, sin red): decide cuáles de las seleccionadas SÍ pueden pasar a la etapa destino y cuáles se omiten.
//
// Las etapas van en orden y de una en una (270): documented → photographed → approved → dumped → adjusted. Así que a
// `dumped` solo pueden pasar las que están en `approved`, y a `adjusted` solo las que están en `dumped`. Lo mismo que
// exige la base en `warehouse_ops_set_scrap_stage`; esto solo decide qué ofrecer y qué avisar.
import { ETAPAS, etapaAlDeshacer, etapaDe, nombreDeEtapa, type Etapa, type FilaConEtapa, type Lang } from "./etapas";

/** La etapa en la que tiene que estar un reporte para poder pasar a `destino` (la de justo antes). */
export function etapaRequeridaPara(destino: Etapa): Etapa | null {
  const i = ETAPAS.indexOf(destino);
  return i > 0 ? ETAPAS[i - 1] : null;
}

export interface ParticionDeEtapa<T> { elegibles: T[]; omitidos: T[] }

/** Separa los reportes: los que SÍ pueden pasar a `destino` (están en la etapa previa) y los que no. */
export function particionaPorEtapa<T extends FilaConEtapa>(reportes: readonly T[], destino: Etapa): ParticionDeEtapa<T> {
  const prev = etapaRequeridaPara(destino);
  const elegibles: T[] = [];
  const omitidos: T[] = [];
  for (const r of reportes) (etapaDe(r) === prev ? elegibles : omitidos).push(r);
  return { elegibles, omitidos };
}

/** El aviso tras una acción en bloque: cuántas se marcaron y, si hubo omitidas, por qué (les faltaba la etapa previa). */
export function resumenDeBloque(destino: Etapa, nElegibles: number, nOmitidos: number, lang: Lang): string {
  const prev = etapaRequeridaPara(destino);
  const dest = nombreDeEtapa(destino, lang).toLowerCase();
  const hechas = lang === "es"
    ? `${nElegibles} marcada${nElegibles === 1 ? "" : "s"} como ${dest}`
    : `${nElegibles} marked as ${dest}`;
  if (nOmitidos === 0) return hechas;
  const prevN = prev ? nombreDeEtapa(prev, lang).toLowerCase() : "";
  const omit = lang === "es"
    ? `${nOmitidos} omitida${nOmitidos === 1 ? "" : "s"} (no está${nOmitidos === 1 ? "" : "n"} en «${prevN}»)`
    : `${nOmitidos} skipped (not in “${prevN}”)`;
  return `${hechas} · ${omit}`;
}

/**
 * 296 — deshacer en bloque (dueño, 11 nov): cada seleccionada regresa UN paso desde su propia etapa (ajustada →
 * desechada, desechada → aprobada, aprobada → fotografiada). Las fotografiadas / documentadas no tienen qué deshacer y se
 * omiten. Se agrupan por etapa destino porque la base cambia una etapa a la vez.
 */
export function particionaParaDeshacer<T extends FilaConEtapa>(reportes: readonly T[]): { porDestino: Map<Etapa, T[]>; elegibles: T[]; omitidos: T[] } {
  const porDestino = new Map<Etapa, T[]>();
  const elegibles: T[] = [];
  const omitidos: T[] = [];
  for (const r of reportes) {
    const destino = etapaAlDeshacer(r);
    if (!destino) { omitidos.push(r); continue; }
    elegibles.push(r);
    porDestino.set(destino, [...(porDestino.get(destino) ?? []), r]);
  }
  return { porDestino, elegibles, omitidos };
}

/** El aviso tras deshacer en bloque. */
export function resumenDeDeshacer(nHechas: number, nOmitidas: number, lang: Lang): string {
  const es = lang === "es";
  const hechas = es ? `${nHechas} regresada${nHechas === 1 ? "" : "s"} un paso` : `${nHechas} moved back one step`;
  if (nOmitidas === 0) return hechas;
  return es
    ? `${hechas} · ${nOmitidas} omitida${nOmitidas === 1 ? "" : "s"} (no tenía${nOmitidas === 1 ? "" : "n"} qué deshacer)`
    : `${hechas} · ${nOmitidas} skipped (nothing to undo)`;
}
