import { gruposDeMismoLugar, type ParadaDeLaLista } from "@/lib/lista-unica";
import type { FilaDeLaRuta } from "@/lib/route-plan/lectura-de-ruta";

/**
 * La ruta de un chofer numerada por PARADAS (D-485). El dueño, 2026-10-06 (dictado): «vamos a hacerlo ahora por stops,
 * like stop. 1, 2, 3, 4, 5, 6, en vez de P1, P2, P3 […] en stop 1 va a recoger P1, P2, P3. Y después, la segunda stop va a
 * ser D1».
 *
 * Una parada es un sitio donde el camión se detiene. Filas SEGUIDAS de la lista en el MISMO sitio son UNA parada: varias
 * recogidas seguidas en la misma tienda, o varias entregas seguidas a la misma dirección. «El mismo sitio» es la regla que
 * ya pinta los grupos de color de la tabla (`gruposDeMismoLugar`, D-444), sin otra: misma tienda (P) o misma dirección (D),
 * sin mayúsculas ni espacios; una P y una D en el mismo sitio no se juntan; la misma tienda más adelante es otra parada.
 *
 * No cambia el orden ni las etiquetas P/D (que siguen siendo de la orden: `Dk` es la entrega de `Pk`): solo agrupa y numera
 * lo que ya hay, en el orden en que viene.
 */

export interface ParadaFisica {
  /** 1, 2, 3… en el orden de la lista. */
  numero: number;
  tipo: "P" | "D";
  /** Los índices de sus filas en `filas`. */
  filas: number[];
  /** Las etiquetas de sus filas, en orden: «P1», «P2»… o «D1». */
  etiquetas: string[];
  /** Sus órdenes, en orden, sin repetir. */
  ordenes: string[];
  /** La tienda de una recogida (`null` en una entrega, o si la orden no la dice). */
  lugar: string | null;
}

export interface ParadasDeLaRuta {
  /** El número de parada de cada fila. */
  deFila: number[];
  /** ¿La fila es la primera de su parada? (la que lleva el número; las demás, la marca de que sigue). */
  primera: boolean[];
  paradas: ParadaFisica[];
}

/** Agrupa las filas de la ruta en paradas. `ordenes` da la dirección de cada entrega. */
export function paradasDeLaRuta(
  filas: readonly FilaDeLaRuta[], ordenes: readonly { id: string; store?: string | null; delivery_address?: string | null }[],
): ParadasDeLaRuta {
  const comoLista: ParadaDeLaLista[] = filas.map((f) => (f.tipo === "P" ? { tipo: "P", ordenes: f.ordenes, tienda: f.lugar } : { tipo: "D", orden: f.orden }));
  const grupos = gruposDeMismoLugar(comoLista, ordenes);
  const deFila: number[] = [];
  const primera: boolean[] = [];
  const paradas: ParadaFisica[] = [];
  filas.forEach((f, i) => {
    const sigue = i > 0 && grupos[i] != null && grupos[i] === grupos[i - 1];
    if (!sigue) paradas.push({ numero: paradas.length + 1, tipo: f.tipo, filas: [], etiquetas: [], ordenes: [], lugar: f.tipo === "P" ? f.lugar : null });
    const p = paradas[paradas.length - 1];
    p.filas.push(i);
    p.etiquetas.push(f.etiqueta);
    for (const id of f.tipo === "P" ? f.ordenes : [f.orden]) if (!p.ordenes.includes(id)) p.ordenes.push(id);
    deFila.push(p.numero);
    primera.push(!sigue);
  });
  return { deFila, primera, paradas };
}

/**
 * Qué se hace en la parada, en una línea: «Stop 1 — pick up P1, P2, P3 · INV-3028, INV-3029» / «Parada 2 — entregar D1 ·
 * INV-3028». `nombres`: cómo se nombra cada orden (en el mapa, su factura: `nombreEnElMapa`); vacío, sin la cola.
 */
export function textoDeLaParada(p: Pick<ParadaFisica, "numero" | "tipo" | "etiquetas">, nombres: readonly string[], t: (en: string, es: string) => string): string {
  const que = p.tipo === "P" ? t("pick up", "recoger") : t("deliver", "entregar");
  return `${t("Stop", "Parada")} ${p.numero} — ${que} ${p.etiquetas.join(", ")}${nombres.length ? ` · ${nombres.join(", ")}` : ""}`;
}
