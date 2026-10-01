import { haversineMi } from "./route-batching";
import { ordenSinRecoger, type ParadaDeLaLista } from "./lista-unica";

/**
 * «🧭 Optimizar» UNA ruta (D-456). El dueño, 2026-10-01: «When doing routes manually it assigned to him but it doesn't
 * optimize have the optimize option for every route when selecting a driver and optimize it».
 *
 * D-437 había quitado «Optimizar ruta» (2026-09-28, «Quitar los dos; solo Armar rutas»). Aquel pedía a Google el mejor orden
 * de las ENTREGAS (`computeRoute` con `optimize`) y lo escribía. Hoy la ruta es una sola lista de recogidas y entregas
 * (D-443), y el optimizador de Google no sabe que una entrega va después de su recogida ni cuánto cabe en el camión: lo que
 * devolviera habría que deshacerlo a mano. Por eso el orden se decide AQUÍ, sin llamar a nadie:
 *
 *   · reordena SOLO las paradas de esa lista (las mismas, ni una más ni una menos);
 *   · una entrega nunca queda antes que su recogida;
 *   · primero que el camión no se pase de su capacidad (si la lista de partida no se pasaba, la optimizada tampoco), y
 *     entre las que cumplen, la de menor recorrido saliendo de la base y volviendo a ella;
 *   · el recorrido se mide EN LÍNEA RECTA (como «📍 Mejor lugar»), no por calles: es una estimación. Las millas por calles
 *     y las horas de llegada las pone después la medida de siempre (`mideLaRuta`), una llamada, como tras cualquier cambio.
 *
 * Es una búsqueda local (vecino más cercano que se pueda, y luego mover paradas de una en una mientras mejore), no una
 * demostración de óptimo: para las 10–40 paradas de un camión da el orden que una persona armaría mirando el mapa. Si no
 * encuentra nada mejor que lo que hay, lo dice y no toca nada.
 *
 * Una parada sin punto en el mapa (una entrega sin pin, una tienda sin coordenadas en Ajustes) no mide: el recorrido pasa
 * por ella sin sumar. Se queda en la lista, donde las reglas la dejen, y se cuenta en `sinPunto` para decirlo.
 */

export interface PuntoEnElMapa { lat: number; lng: number }

export interface EntradaDeOptimizar {
  paradas: readonly ParadaDeLaLista[];
  /** El punto de cada parada, en el mismo orden; `null` si no se sabe. */
  puntos: readonly (PuntoEnElMapa | null)[];
  /** Lo que cada parada suma (+) o resta (−) en pallets (`cambiosDeLaLista`); `null` = sin conteo, cuenta 0. */
  cambios: readonly (number | null)[];
  /** De dónde sale y a dónde vuelve el camión. Sin base, el recorrido es abierto: de la primera parada a la última. */
  base: PuntoEnElMapa | null;
  /** `null` o 0: no se sabe; no se mira. */
  capacidad: number | null;
}

export interface ResultadoDeOptimizar {
  /** La lista en el orden nuevo (la misma si no hubo nada mejor). */
  paradas: ParadaDeLaLista[];
  /** ¿Cambió el orden? Si no, no hay nada que guardar. */
  cambio: boolean;
  /** Millas en línea recta, a la décima, antes y después. */
  millasAntes: number;
  millasDespues: number;
  /** Pallets por encima de la capacidad, sumados parada a parada, antes y después. */
  excesoAntes: number;
  excesoDespues: number;
  /** Paradas sin punto en el mapa: no cuentan en el recorrido. */
  sinPunto: number;
}

const centesimas = (n: number) => Math.round(n * 100);
/** Lo mínimo que tiene que acortarse el recorrido para que un cambio de orden valga la pena: media décima de milla. */
export const MARGEN_MI = 0.05;

export function optimizaLaLista(e: EntradaDeOptimizar): ResultadoDeOptimizar {
  const n = e.paradas.length;
  const cap = e.capacidad != null && e.capacidad > 0 ? centesimas(e.capacidad) : null;
  const cambio = e.paradas.map((_, i) => centesimas(e.cambios[i] ?? 0));
  const punto = (i: number) => e.puntos[i] ?? null;

  /** Millas del recorrido en ese orden: base → cada parada con punto → base. */
  const millas = (orden: readonly number[]): number => {
    let total = 0, desde = e.base;
    for (const i of orden) {
      const p = punto(i);
      if (!p) continue;
      if (desde) total += haversineMi(desde, p);
      desde = p;
    }
    if (e.base && desde && desde !== e.base) total += haversineMi(desde, e.base);
    return total;
  };
  /** Cuánto se pasa el camión, sumado parada a parada (centésimas). 0 = nunca se pasa. */
  const exceso = (orden: readonly number[]): number => {
    if (cap == null) return 0;
    let aBordo = 0, total = 0;
    for (const i of orden) { aBordo += cambio[i]; if (aBordo > cap) total += aBordo - cap; }
    return total;
  };
  const valida = (orden: readonly number[]) => ordenSinRecoger(orden.map((i) => e.paradas[i])) == null;
  /** ¿`a` es mejor que `b`? Primero el exceso; a igual exceso, las millas — por más de `MARGEN_MI`: no se reescribe una ruta
   *  por una ganancia que ni se ve en la décima de milla que se enseña. */
  const mejor = (a: readonly number[], b: readonly number[]) => {
    const ea = exceso(a), eb = exceso(b);
    return ea !== eb ? ea < eb : millas(a) < millas(b) - MARGEN_MI;
  };

  // De qué recogida depende cada entrega.
  const recogidaDe = new Map<string, number>();
  e.paradas.forEach((p, i) => { if (p.tipo === "P") for (const id of p.ordenes) recogidaDe.set(id, i); });

  /** El vecino más cercano que se pueda: una recogida que quepa, o una entrega ya recogida. Si nada cabe, la más cercana. */
  const voraz = (): number[] => {
    const orden: number[] = [];
    const hecha = new Set<number>();
    let aBordo = 0, aqui = e.base;
    while (orden.length < n) {
      const libres: number[] = [];
      for (let i = 0; i < n; i++) {
        if (hecha.has(i)) continue;
        const p = e.paradas[i];
        if (p.tipo === "D") { const r = recogidaDe.get(p.orden); if (r != null && !hecha.has(r)) continue; }
        libres.push(i);
      }
      const caben = cap == null ? libres : libres.filter((i) => aBordo + cambio[i] <= cap);
      const entre = caben.length ? caben : libres;
      const lejos = (i: number) => { const p = punto(i); return p && aqui ? haversineMi(aqui, p) : 0; };
      let elegida = entre[0];
      for (const i of entre) if (lejos(i) < lejos(elegida) - 1e-9) elegida = i;
      orden.push(elegida);
      hecha.add(elegida);
      aBordo += cambio[elegida];
      aqui = punto(elegida) ?? aqui;
    }
    return orden;
  };

  /** Mueve paradas de una en una a otro puesto mientras el recorrido mejore y la lista siga valiendo. */
  const pule = (partida: readonly number[]): number[] => {
    let orden = [...partida];
    for (let vueltas = 0, movio = true; movio && vueltas < 200; vueltas++) {
      movio = false;
      for (let i = 0; i < n && !movio; i++) {
        for (let j = 0; j < n && !movio; j++) {
          if (i === j) continue;
          const prueba = [...orden];
          const [x] = prueba.splice(i, 1);
          prueba.splice(j, 0, x);
          if (valida(prueba) && mejor(prueba, orden)) { orden = prueba; movio = true; }
        }
      }
    }
    return orden;
  };

  const actual = e.paradas.map((_, i) => i);
  const sinPunto = e.puntos.filter((p) => !p).length;
  const redondea = (m: number) => Math.round(m * 10) / 10;
  const sinCambio: ResultadoDeOptimizar = {
    paradas: [...e.paradas], cambio: false, millasAntes: redondea(millas(actual)), millasDespues: redondea(millas(actual)),
    excesoAntes: exceso(actual) / 100, excesoDespues: exceso(actual) / 100, sinPunto,
  };
  // Con menos de tres paradas no hay orden que elegir; y una lista que ya rompe la precedencia no se toca aquí.
  if (n < 3 || !valida(actual)) return sinCambio;

  // Dos puntos de partida: lo que hay, pulido; y el vecino más cercano, pulido. Gana el mejor; a iguales, lo que hay.
  let elegida = pule(actual);
  const desdeCero = pule(voraz());
  if (valida(desdeCero) && mejor(desdeCero, elegida)) elegida = desdeCero;
  if (!mejor(elegida, actual)) return sinCambio;
  return {
    paradas: elegida.map((i) => e.paradas[i]), cambio: true,
    millasAntes: redondea(millas(actual)), millasDespues: redondea(millas(elegida)),
    excesoAntes: exceso(actual) / 100, excesoDespues: exceso(elegida) / 100, sinPunto,
  };
}
