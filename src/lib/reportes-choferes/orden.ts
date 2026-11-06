/**
 * El orden PLANEADO de las paradas contra el orden en que se HICIERON (D-NEXT, «Reportes de choferes»).
 *
 * «Fuera de orden» se cuenta con la medida más benévola que existe: el MENOR número de paradas que habría que mover para
 * que lo hecho quedara en el orden del plan (lo que sobra de la subsecuencia creciente más larga). Hacer primero la última
 * parada y luego las otras nueve en su orden es UNA parada fuera de orden, no diez.
 *
 * Dos paradas con el mismo puesto en el plan (las recogidas de una misma visita a la tienda) o hechas en la misma visita
 * no están desordenadas entre sí.
 *
 * Puro.
 */

export interface ParadaParaElOrden {
  clave: string;
  /** Puesto en el plan (1, 2, 3…; varias paradas pueden compartirlo). */
  plan: number;
  /** Cuándo se hizo de verdad (ms). Las que comparten visita traen la misma hora. */
  real: number;
}

export interface OrdenComparado {
  /** Paradas con puesto en el plan Y hora real: las únicas que se pueden comparar. */
  comparadas: number;
  fueraDeOrden: string[];
}

export function comparaOrden(paradas: readonly ParadaParaElOrden[]): OrdenComparado {
  const hechas = paradas.filter((p) => Number.isFinite(p.plan) && Number.isFinite(p.real)).slice().sort((a, b) => a.real - b.real || a.plan - b.plan);
  const n = hechas.length;
  if (n < 2) return { comparadas: n, fueraDeOrden: [] };
  // Subsecuencia NO decreciente más larga de los puestos del plan, en el orden real. O(n²): son decenas de paradas.
  const largo = new Array<number>(n).fill(1), previo = new Array<number>(n).fill(-1);
  let mejor = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (hechas[j].plan <= hechas[i].plan && largo[j] + 1 > largo[i]) { largo[i] = largo[j] + 1; previo[i] = j; }
    }
    if (largo[i] > largo[mejor]) mejor = i;
  }
  const enOrden = new Set<number>();
  for (let k = mejor; k >= 0; k = previo[k]) enOrden.add(k);
  return { comparadas: n, fueraDeOrden: hechas.filter((_, i) => !enOrden.has(i)).map((p) => p.clave) };
}
