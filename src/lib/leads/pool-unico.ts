import { esPrivado, type Lead } from "./reglas";

/**
 * La pestaña única («Leads Pool»): el GOV y el STXP juntos, cada lead con su origen. Estas son las reglas de qué se ve
 * de cada uno, para que la pantalla no decida nada por su cuenta y cada una tenga su prueba.
 */

/**
 * Lo que se enseña = el GOV (el banco de siempre) más el STXP (lo privado de siempre). Sin repetir por id: si un lead
 * saliera en los dos, gana su primera aparición (el GOV).
 */
export function unirPoolUnico<L extends { id: string }>(gov: readonly L[], stxp: readonly L[]): L[] {
  const ids = new Set<string>();
  const out: L[] = [];
  for (const l of [...gov, ...stxp]) {
    if (ids.has(l.id)) continue;
    ids.add(l.id);
    out.push(l);
  }
  return out;
}

/**
 * El pool con el que se filtra cada lead. El GOV sigue al selector de tienda. El STXP solo lo sigue cuando quien mira
 * puede elegir tienda; si no, no se filtra por pool (D-770: su tienda y la cercana que le toque).
 */
export function poolDelFiltro(l: Pick<Lead, "source">, pool: string | null, eligeTienda: boolean): string | null {
  return esPrivado(l) && !eligeTienda ? null : pool;
}

/**
 * La semana del STXP Pool (un import = una semana). Solo filtra a los STXP: los GOV nunca se esconden por la semana.
 * `semana` null = todas las semanas.
 */
export function pasaSemanaSTXP(l: Pick<Lead, "id" | "source">, semanaDeLead: ReadonlyMap<string, number>, semana: number | null): boolean {
  return !esPrivado(l) || semana === null || semanaDeLead.get(l.id) === semana;
}
