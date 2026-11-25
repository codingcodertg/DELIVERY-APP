import { descargaPrimero } from "./descarga-primero";
import { validaLaRuta } from "./validador";
import type { OrdenEntrada, ParadaRef, TipoDeViolacion } from "./types";

/**
 * El reparador de los regresos a una tienda ya visitada (regla 3 del validador): «si cabe, se va». Mientras el validador
 * marque un `regreso_a_la_misma_tienda`, se mueve la visita que vuelve (V2) a la visita anterior en ese mismo sitio (V1):
 *   a. cada "P" de V2 pasa al final de V1 (en su orden);
 *   b. cada "D" de V2 cuya "P" está en V1 o antes pasa también al final de V1;
 *   c. las "D" de V2 cuya "P" está después de V1 se quedan donde están (ese regreso es inevitable).
 * Después de cada pasada se vuelve a ordenar con `descargaPrimero`. Un regreso que el validador no marca (inevitable,
 * por capacidad, por disponibilidad o en viaje nuevo) no se toca. No mueve nada de las primeras `fijas` paradas. Lo que
 * lo decide es el validador (`validaLaRuta`): una sola definición de qué es un regreso sin justificar.
 * Devuelve una lista NUEVA; no muta la entrada. Es idempotente.
 */
export function unaSolaVisita(secuencia: readonly ParadaRef[], ordenes: readonly OrdenEntrada[], capacidad: number, fijas = 0): ParadaRef[] {
  const puntoDe = puntoDeLaParada(ordenes);
  let seq: ParadaRef[] = [...secuencia];
  for (let pasada = 0; pasada < secuencia.length * 4; pasada++) {
    const marcados = regresosMarcados(seq, ordenes, capacidad);
    let cambio: ParadaRef[] | null = null;
    for (const v of marcados) {
      cambio = mueveElRegreso(seq, v.indice, puntoDe, fijas);
      if (cambio) break;
    }
    if (!cambio) break;
    seq = descargaPrimero(cambio, ordenes, fijas);
  }
  return seq;
}

/**
 * Igual que `unaSolaVisita`, pero cada juntada se adopta por separado. Primero se prueba el resultado completo (todas las
 * juntadas a la vez); si `aceptable` lo rechaza, se prueba cada regreso marcado SOLO: se aplica uno, se reordena, y si
 * `aceptable` lo deja pasar se adopta y se sigue desde esa secuencia; si no, se prueba el siguiente regreso desde la misma.
 * Así, una juntada que añade millas o una violación que no es de retraso no arrastra a las que sí valen. `aceptable`
 * recibe la secuencia candidata y las tiendas que se juntan en ella, y decide contra la ruta que ya se adoptó (quien la
 * llama lleva esa cuenta). Determinista y acotado: las mismas pasadas que `unaSolaVisita`.
 */
export function unaSolaVisitaCuandoCabe(
  secuencia: readonly ParadaRef[],
  ordenes: readonly OrdenEntrada[],
  capacidad: number,
  fijas: number,
  aceptable: (nueva: ParadaRef[], tiendas: string[]) => boolean,
): ParadaRef[] {
  const puntoDe = puntoDeLaParada(ordenes);
  const tiendasDe = (seq: readonly ParadaRef[], indices: number[]): string[] =>
    [...new Set(indices.map((i) => puntoDe(seq[i])).filter((p): p is string => p !== null))];

  const marcadosAlPrincipio = regresosMarcados(secuencia, ordenes, capacidad);
  if (marcadosAlPrincipio.length > 0) {
    const completa = unaSolaVisita(secuencia, ordenes, capacidad, fijas);
    const distinta = completa.some((p, i) => p.orden !== secuencia[i].orden || p.tipo !== secuencia[i].tipo);
    if (distinta && aceptable(completa, tiendasDe(secuencia, marcadosAlPrincipio.map((v) => v.indice)))) return completa;
  }

  let seq: ParadaRef[] = [...secuencia];
  for (let pasada = 0; pasada < secuencia.length * 4; pasada++) {
    let adoptado = false;
    for (const v of regresosMarcados(seq, ordenes, capacidad)) {
      const cambio = mueveElRegreso(seq, v.indice, puntoDe, fijas);
      if (!cambio) continue;
      const nueva = descargaPrimero(cambio, ordenes, fijas);
      if (nueva.every((p, i) => p.orden === seq[i].orden && p.tipo === seq[i].tipo)) continue;
      if (aceptable(nueva, tiendasDe(seq, [v.indice]))) { seq = nueva; adoptado = true; break; }
    }
    if (!adoptado) break;
  }
  return seq;
}

/**
 * Las violaciones que `despues` tiene de MÁS frente a `antes`, contando por tipo y orden (no por cuántas hay). Quitar una
 * violación no cuenta como añadir otra. Es la cuenta que decide si una juntada se adopta (`soloAnadeRetraso`).
 */
export function violacionesAnadidas<V extends { tipo: TipoDeViolacion; orden?: string }>(antes: readonly V[], despues: readonly V[]): V[] {
  const cuenta = new Map<string, number>();
  for (const v of antes) {
    const k = `${v.tipo}|${v.orden ?? ""}`;
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  const anadidas: V[] = [];
  for (const v of despues) {
    const k = `${v.tipo}|${v.orden ?? ""}`;
    const n = cuenta.get(k) ?? 0;
    if (n > 0) cuenta.set(k, n - 1); else anadidas.push(v);
  }
  return anadidas;
}

/**
 * Los tipos de violación que son LLEGAR TARDE a una ventana de entrega: lo único que una juntada puede añadir. `ventana_estrecha`
 * (la ventana que no admite retraso) y `retraso_sobre_el_tope` (la ancha, pasada de su tope). Capacidad, turno, tiempo de
 * viaje que falta, precedencia o chofer distinto del fijado siguen rechazando la juntada.
 */
export const TIPOS_DE_LLEGAR_TARDE: readonly TipoDeViolacion[] = ["ventana_estrecha", "retraso_sobre_el_tope"];

/**
 * ¿La ruta `despues` solo añade LLEGAR TARDE a una ventana frente a `antes`? Verdadero si no añade ninguna violación, o si
 * todas las que añade son de `TIPOS_DE_LLEGAR_TARDE`. Las que ya estaban (y siguen) no cuentan.
 */
export function soloAnadeRetraso<V extends { tipo: TipoDeViolacion; orden?: string }>(antes: readonly V[], despues: readonly V[]): boolean {
  return violacionesAnadidas(antes, despues).every((v) => TIPOS_DE_LLEGAR_TARDE.includes(v.tipo));
}

function puntoDeLaParada(ordenes: readonly OrdenEntrada[]): (p: ParadaRef) => string | null {
  const porId = new Map<string, OrdenEntrada>();
  for (const o of ordenes) if (!porId.has(o.id)) porId.set(o.id, o);
  return (p: ParadaRef): string | null => {
    const o = porId.get(p.orden);
    if (!o) return null;
    return (p.tipo === "P" ? o.origen : o.destino) || null;
  };
}

/** Los regresos a una tienda que el validador marca sin justificar, con el índice de la parada donde empieza la visita que vuelve. */
function regresosMarcados(seq: readonly ParadaRef[], ordenes: readonly OrdenEntrada[], capacidad: number) {
  return validaLaRuta({ chofer: { nombre: "", capacidad }, ordenes, secuencia: [...seq] })
    .violaciones.filter((v) => v.clave === "regreso_a_la_misma_tienda");
}

/** Mueve la visita V2 (que empieza en `a2`) a la V1 anterior en el mismo sitio. `null` si no se puede (V1 entra en las fijas). */
function mueveElRegreso(seq: readonly ParadaRef[], a2: number, puntoDe: (p: ParadaRef) => string | null, fijas: number): ParadaRef[] | null {
  const punto = puntoDe(seq[a2]);
  if (punto === null) return null;
  let b2 = a2;
  while (b2 + 1 < seq.length && puntoDe(seq[b2 + 1]) === punto) b2++;
  let b1 = -1;
  for (let i = a2 - 1; i >= 0; i--) if (puntoDe(seq[i]) === punto) { b1 = i; break; }
  if (b1 < 0 || b1 < fijas) return null;

  const primeraP = new Map<string, number>();
  seq.forEach((p, i) => { if (p.tipo === "P" && !primeraP.has(p.orden)) primeraP.set(p.orden, i); });
  const movidos: number[] = [];
  const quedan: number[] = [];
  for (let i = a2; i <= b2; i++) {
    const p = seq[i];
    const pEnV1 = p.tipo === "D" && primeraP.has(p.orden) && (primeraP.get(p.orden) as number) <= b1;
    if (p.tipo === "P" || pEnV1) movidos.push(i); else quedan.push(i);
  }
  if (movidos.length === 0) return null;
  const en = (ids: number[]) => ids.map((i) => seq[i]);
  const movidosP = en(movidos.filter((i) => seq[i].tipo === "P"));
  const movidosD = en(movidos.filter((i) => seq[i].tipo === "D"));
  const restantes = en(quedan);
  return [
    ...seq.slice(0, b1 + 1), ...movidosP, ...movidosD,
    ...seq.slice(b1 + 1, a2), ...restantes, ...seq.slice(b2 + 1),
  ];
}
