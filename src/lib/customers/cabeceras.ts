import { claveDeFiltro, SIN_VALOR, type FiltrosPorColumna, type ValorDeCelda } from "@/lib/orden-y-filtro";
import { codigoDeTienda } from "./duplicados";
import type { Empresa } from "./empresas";
import { ORDEN_INICIAL, textoDeValor, valorDeColumna, type ClaveDeColumna, type Orden } from "./reglas";

type T = (en: string, es: string) => string;

/**
 * Las cabeceras de la lista de Clientes (D-NEXT). El dueño, 2026-10-22: «we need to filter columns and in the columns
 * as well to do the dragging, so you can rearrange it by drag, and also the sorting thing […] that the sorting has
 * hierarchies, like if you sort 1, 2, and 3, it will keep sorting by number 1, but it will be giving priority to number
 * 3. That will be the last one».
 *
 * Aquí, sin navegador: el orden en niveles (qué pasa al pulsar una cabecera o al elegir en su menú) y el filtro por
 * columna sobre la lista por EMPRESA (189). El menú es el de Órdenes (`ColumnFilterMenu`, D-275); el arrastre de
 * columnas, `colocaColumnaDeClientes` (reglas). Lo prueba `cabeceras.test.ts`.
 */

/** Hasta tres niveles: el 1 manda, el 2 desempata, el 3 es el último en desempatar. */
export const MAX_NIVELES = 3;
export const ORDENES_INICIALES: readonly Orden[] = [ORDEN_INICIAL];

/** En qué nivel (1, 2, 3) y en qué sentido ordena la columna `por`; null si no ordena. */
export function nivelDeOrden(ordenes: readonly Orden[], por: ClaveDeColumna): { nivel: number; desc: boolean } | null {
  const i = ordenes.findIndex((o) => o.por === por);
  return i < 0 ? null : { nivel: i + 1, desc: ordenes[i].desc };
}

/**
 * Pulsar una cabecera. Sin Mayúsculas: ordenar SOLO por ella, ascendente (como hasta hoy). Con Mayúsculas (`anadir`):
 * se añade como siguiente nivel; con los tres puestos, sustituye al tercero, el último en desempatar. Pulsar una que ya
 * ordena —con o sin Mayúsculas— le da la vuelta a SU sentido sin tocar los otros niveles: así se invierte el nivel 2
 * sin perder el 1. Con un solo nivel, es exactamente lo de antes: la misma invierte, otra empieza ascendente.
 */
export function alPulsarCabecera(ordenes: readonly Orden[], por: ClaveDeColumna, anadir: boolean): Orden[] {
  const i = ordenes.findIndex((o) => o.por === por);
  if (i >= 0) return ordenes.map((o, j) => (j === i ? { ...o, desc: !o.desc } : o));
  if (!anadir) return [{ por, desc: false }];
  return [...ordenes.slice(0, MAX_NIVELES - 1), { por, desc: false }];
}

/**
 * Lo que se elige en el menú de la columna. ↑ / ↓ en una que ya ordena le pone ese sentido en SU nivel; en otra, ordena
 * solo por ella (como el clic). «Quitar orden» la saca y las de debajo suben un nivel; sin ninguna, vuelve el de entrada.
 */
export function ordenDesdeMenu(ordenes: readonly Orden[], por: ClaveDeColumna, dir: "asc" | "desc" | null): Orden[] {
  if (dir === null) {
    const quedan = ordenes.filter((o) => o.por !== por);
    return quedan.length ? quedan : [...ORDENES_INICIALES];
  }
  const desc = dir === "desc";
  return ordenes.some((o) => o.por === por) ? ordenes.map((o) => (o.por === por ? { por, desc } : o)) : [{ por, desc }];
}

/** ¿Está como al entrar? «Quitar orden» solo se enseña cuando hace algo. */
export function esOrdenInicial(ordenes: readonly Orden[]): boolean {
  return ordenes.length === 1 && ordenes[0].por === ORDEN_INICIAL.por && ordenes[0].desc === ORDEN_INICIAL.desc;
}

// ---- Filtro por columna ------------------------------------------------------------------------------------------

/**
 * Los valores de una empresa en una columna, para filtrar: los de la fila que se pinta (`principal`), igual que el
 * orden. «Tienda» es la excepción, porque su celda pinta TODAS las tiendas de la empresa: marcar una tienda que se ve
 * en la celda tiene que dejar la fila. «Actualizado» va por día, que es lo que enseña la celda (por instante saldría
 * una casilla por fila).
 */
export function valoresDeLaColumna(e: Empresa, key: ClaveDeColumna): ValorDeCelda[] {
  if (key === "store") return [...new Set(e.filas.map((c) => codigoDeTienda(c.store)))];
  const v = valorDeColumna(e.principal, key);
  if (key === "updated_at") return [typeof v === "string" ? v.slice(0, 10) : null];
  return [typeof v === "number" || typeof v === "string" ? v : null];
}

/**
 * Las empresas que pasan TODOS los filtros de columna puestos (una columna pasa si alguno de sus valores está marcado).
 * `saltar` deja fuera el de una columna: así el menú de esa columna ofrece lo que quedaría si se quitara solo ese, y
 * los de las otras siguen acotando (en cascada, como Órdenes, D-275). Se suma a los de arriba (tienda, QB, búsqueda).
 */
export function filtraEmpresas(empresas: readonly Empresa[], filtros: FiltrosPorColumna, saltar?: string): Empresa[] {
  const activos = Object.entries(filtros).filter(([k, s]) => k !== saltar && s && s.size > 0);
  if (!activos.length) return [...empresas];
  return empresas.filter((e) => activos.every(([k, s]) => valoresDeLaColumna(e, k as ClaveDeColumna).some((v) => s.has(claveDeFiltro(v)))));
}

/** Las casillas del menú de una columna: cada valor una vez, con el texto de la celda, por orden alfabético. */
export function opcionesDeColumna(empresas: readonly Empresa[], filtros: FiltrosPorColumna, key: ClaveDeColumna, t: T): { key: string; label: string }[] {
  const vistos = new Map<string, string>();
  for (const e of filtraEmpresas(empresas, filtros, key)) {
    for (const v of valoresDeLaColumna(e, key)) {
      const k = claveDeFiltro(v);
      if (!vistos.has(k)) vistos.set(k, k === SIN_VALOR ? "—" : textoDeValor(key, v, t));
    }
  }
  return [...vistos].map(([k, label]) => ({ key: k, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
