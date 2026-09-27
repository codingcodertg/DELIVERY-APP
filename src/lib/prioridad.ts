/**
 * Prioridad por orden (D-412, migración 147).
 *
 * El dueño, comparando con OptimoRoute el 2026-09-26, pidió prioridad por orden («las 3 haz»). OptimoRoute tiene cuatro
 * niveles —baja, media, alta, crítica (L / M / H / C)—; aquí son `low`, `normal`, `high` y `critical`, y **normal** es el
 * de siempre: toda orden que nadie tocó.
 *
 * Aquí vive todo lo que decide: qué valores hay, en qué orden van (para ordenar la tabla y para que Auto-asignar reparta
 * primero lo urgente), cuáles se destacan y si la base ya tiene la columna. Las pantallas solo lo pintan.
 */
import type { Delivery, OrderPriority } from "./types";

export const PRIORIDADES: readonly { key: OrderPriority; en: string; es: string }[] = [
  { key: "critical", en: "Critical", es: "Crítica" },
  { key: "high", en: "High", es: "Alta" },
  { key: "normal", en: "Normal", es: "Normal" },
  { key: "low", en: "Low", es: "Baja" },
];

const VALIDAS = new Set<string>(PRIORIDADES.map((p) => p.key));

/** La prioridad de una orden. Sin valor (una base sin la 147, una orden de antes) o con uno que no existe: normal. */
export function prioridadDe(d: Pick<Partial<Delivery>, "priority"> | null | undefined): OrderPriority {
  const v = d?.priority;
  return typeof v === "string" && VALIDAS.has(v) ? (v as OrderPriority) : "normal";
}

/** Su puesto: 0 la crítica, 3 la baja. Lo que se reparte y se lista primero es lo de número más bajo. */
export function rangoDePrioridad(d: Pick<Partial<Delivery>, "priority"> | null | undefined): number {
  return PRIORIDADES.findIndex((p) => p.key === prioridadDe(d));
}

/** Solo alta y crítica llevan pastilla: normal y baja no hacen ruido en la tabla. */
export function seDestaca(p: OrderPriority): boolean {
  return p === "critical" || p === "high";
}

export function etiquetaDePrioridad(p: OrderPriority, lang: "en" | "es"): string {
  const x = PRIORIDADES.find((q) => q.key === p)!;
  return lang === "es" ? x.es : x.en;
}

/**
 * Lo que la columna «Prioridad» da para ORDENAR y FILTRAR: el puesto y el nombre, «1 · Crítica». El menú de filtro y
 * el orden de la tabla comparan TEXTO (`comparaCeldas`, `opcionesDeFiltro`), así que el número delante hace que
 * ascendente sea «crítica primero» y que el menú salga en ese orden, en los dos idiomas. Sin él, «Alta» iría antes que
 * «Crítica» por orden alfabético.
 */
export function valorDePrioridad(d: Pick<Partial<Delivery>, "priority">, lang: "en" | "es"): string {
  const p = prioridadDe(d);
  return `${rangoDePrioridad(d) + 1} · ${etiquetaDePrioridad(p, lang)}`;
}

/**
 * ¿La base ya tiene la columna? Las migraciones se aplican DESPUÉS de fusionar, así que hay una ventana en la que el
 * código nuevo corre contra la base vieja, y mandar `priority` entonces no fallaría solo ese campo: **fallaría el
 * guardado de la orden entera** (PostgREST no conoce la columna). Las órdenes se leen con `select("*")`: si alguna trae
 * la clave, la columna existe. Sin órdenes cargadas no se sabe y se contesta que no (se pierde una marca, no una orden).
 * Es el mismo patrón que `laBaseTieneCustomerType` (D-316).
 */
export function laBaseTienePrioridad(ordenes: readonly object[]): boolean {
  return ordenes.some((o) => "priority" in o);
}

/** El guardado de la ficha, con la prioridad solo si la base la admite; sin ella, la clave se quita. */
export function conPrioridadSiCabe<T extends { priority?: OrderPriority | null }>(payload: T, ordenes: readonly object[]): T {
  if (laBaseTienePrioridad(ordenes)) return payload;
  const { priority: _fuera, ...resto } = payload;
  void _fuera;
  return resto as T;
}
