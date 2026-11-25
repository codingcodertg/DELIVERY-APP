import type { OrdenEntrada, ParadaRef } from "./types";

/**
 * Dentro de cada VISITA (paradas CONSECUTIVAS en el mismo punto no nulo; el punto de una "P" es el `origen` de su orden y
 * el de una "D" su `destino`), pone primero todas las "D" y después todas las "P", conservando el orden relativo de cada
 * grupo. Una "D" nunca pasa delante de la "P" de su propia orden: si esa recogida está en la misma visita, la entrega va al
 * final de la visita. Las primeras `fijas` paradas (ya hechas o en curso) no se tocan ni se mezclan con las siguientes: la visita se
 * corta en esa frontera. Una parada de una orden desconocida o sin punto corta la visita y se queda donde está.
 * Devuelve una lista NUEVA; no muta la entrada. Es idempotente.
 */
export function descargaPrimero(secuencia: readonly ParadaRef[], ordenes: readonly OrdenEntrada[], fijas = 0): ParadaRef[] {
  const porId = new Map<string, OrdenEntrada>();
  for (const o of ordenes) if (!porId.has(o.id)) porId.set(o.id, o);
  const puntoDe = (p: ParadaRef): string | null => {
    const o = porId.get(p.orden);
    if (!o) return null;
    return (p.tipo === "P" ? o.origen : o.destino) || null;
  };

  const n = secuencia.length;
  const corte = Math.max(0, Math.min(fijas, n));
  const salida: ParadaRef[] = [];
  let i = 0;
  for (; i < corte; i++) salida.push(secuencia[i]);

  while (i < n) {
    const punto = puntoDe(secuencia[i]);
    if (punto === null) {
      salida.push(secuencia[i]);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < n && puntoDe(secuencia[j]) === punto) j++;
    const visita = secuencia.slice(i, j);
    // Una "D" nunca pasa delante de la "P" de SU orden: si la recogida está en esta misma visita, la entrega va al final.
    const conPEnLaVisita = new Set(visita.filter((p) => p.tipo === "P").map((p) => p.orden));
    salida.push(
      ...visita.filter((p) => p.tipo === "D" && !conPEnLaVisita.has(p.orden)),
      ...visita.filter((p) => p.tipo === "P"),
      ...visita.filter((p) => p.tipo === "D" && conPEnLaVisita.has(p.orden)),
    );
    i = j;
  }
  return salida;
}
