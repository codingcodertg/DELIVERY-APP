import { descargaPrimero } from "./descarga-primero";
import { validaLaRuta } from "./validador";
import type { OrdenEntrada, ParadaRef } from "./types";

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
  const porId = new Map<string, OrdenEntrada>();
  for (const o of ordenes) if (!porId.has(o.id)) porId.set(o.id, o);
  const puntoDe = (p: ParadaRef): string | null => {
    const o = porId.get(p.orden);
    if (!o) return null;
    return (p.tipo === "P" ? o.origen : o.destino) || null;
  };

  let seq: ParadaRef[] = [...secuencia];
  for (let pasada = 0; pasada < secuencia.length * 4; pasada++) {
    const marcados = validaLaRuta({ chofer: { nombre: "", capacidad }, ordenes, secuencia: seq })
      .violaciones.filter((v) => v.clave === "regreso_a_la_misma_tienda");
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
