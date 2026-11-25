import { etiquetaDeLaParada, gruposDeMismoLugar, numeraLaLista, type ParadaDeLaLista } from "@/lib/lista-unica";
import type { OrdenConDestinoDeTienda } from "@/lib/misma-visita";
import type { FilaDeLaRuta } from "@/lib/route-plan/lectura-de-ruta";

/**
 * La ruta de un chofer numerada por PARADAS (D-485). El dueño, 2026-10-06 (dictado): «vamos a hacerlo ahora por stops,
 * like stop. 1, 2, 3, 4, 5, 6, en vez de P1, P2, P3 […] en stop 1 va a recoger P1, P2, P3. Y después, la segunda stop va a
 * ser D1».
 *
 * Una parada es un sitio donde el camión se detiene. Filas SEGUIDAS de la lista en el MISMO sitio son UNA parada: varias
 * recogidas seguidas en la misma tienda, o varias entregas seguidas a la misma dirección. «El mismo sitio» es la regla que
 * ya pinta los grupos de color de la tabla (`gruposDeMismoLugar`, D-444), sin otra: misma tienda (P) o misma dirección (D),
 * sin mayúsculas ni espacios; una P y una D con la misma dirección no se juntan; la misma tienda más adelante es otra parada.
 * La excepción es la TIENDA: una entrega cuyo destino ES una tienda (Intertienda, relevo) y una recogida en esa misma tienda,
 * seguidas, son UNA visita (`misma-visita.ts`, la única definición del sitio); la numeración sigue la misma regla por
 * `gruposDeMismoLugar`.
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
  /** La tienda de una recogida (`null` en una entrega, o si la orden no la dice). Una parada con descarga y carga en la
   *  misma tienda (`misma-visita.ts`) es de recogida y lleva esa tienda. */
  lugar: string | null;
  /** Solo en una parada que lleva descarga Y carga en la misma tienda: las órdenes de sus ENTREGAS (el mapa las pone bajo
   *  la burbuja de la tienda, con su número). Sin ella, la parada es solo de recogidas o solo de entregas. */
  ordenesDeEntrega?: string[];
}

export interface ParadasDeLaRuta {
  /** El número de parada de cada fila. */
  deFila: number[];
  /** ¿La fila es la primera de su parada? (la que lleva el número; las demás, la marca de que sigue). */
  primera: boolean[];
  paradas: ParadaFisica[];
}

/** Lo que hace falta de una fila para numerarla: qué es, de qué orden(es), dónde y su etiqueta P/D. Una `FilaDeLaRuta` lo
 *  cumple; también una fila ya HECHA del Gestor, que no está en la lectura (D-529, `numeros-del-dia.ts`). */
export type FilaQueSeNumera =
  | Pick<Extract<FilaDeLaRuta, { tipo: "P" }>, "tipo" | "ordenes" | "lugar" | "etiqueta">
  | Pick<Extract<FilaDeLaRuta, { tipo: "D" }>, "tipo" | "orden" | "etiqueta">;

/** Agrupa las filas de la ruta en paradas. `ordenes` da la dirección de cada entrega. */
export function paradasDeLaRuta(
  filas: readonly FilaQueSeNumera[], ordenes: readonly OrdenConDestinoDeTienda[],
): ParadasDeLaRuta {
  const comoLista: ParadaDeLaLista[] = filas.map((f) => (f.tipo === "P" ? { tipo: "P", ordenes: f.ordenes, tienda: f.lugar } : { tipo: "D", orden: f.orden }));
  const grupos = gruposDeMismoLugar(comoLista, ordenes);
  const deFila: number[] = [];
  const primera: boolean[] = [];
  const paradas: ParadaFisica[] = [];
  const entregasDe: string[][] = [];
  filas.forEach((f, i) => {
    const sigue = i > 0 && grupos[i] != null && grupos[i] === grupos[i - 1];
    if (!sigue) { paradas.push({ numero: paradas.length + 1, tipo: f.tipo, filas: [], etiquetas: [], ordenes: [], lugar: f.tipo === "P" ? f.lugar : null }); entregasDe.push([]); }
    const p = paradas[paradas.length - 1];
    // Descarga y carga en la misma tienda (la misma visita, `misma-visita.ts`): la parada es de recogida, con su tienda.
    if (f.tipo === "P" && p.tipo === "D") { p.tipo = "P"; p.lugar = f.lugar; }
    if (f.tipo === "D") entregasDe[paradas.length - 1].push(f.orden);
    p.filas.push(i);
    p.etiquetas.push(f.etiqueta);
    for (const id of f.tipo === "P" ? f.ordenes : [f.orden]) if (!p.ordenes.includes(id)) p.ordenes.push(id);
    deFila.push(p.numero);
    primera.push(!sigue);
  });
  paradas.forEach((p, k) => { if (p.tipo === "P" && entregasDe[k].length) p.ordenesDeEntrega = entregasDe[k]; });
  return { deFila, primera, paradas };
}

/**
 * Qué se hace en la parada, en una línea: «Stop 1 — pick up P1, P2, P3 · INV-3028, INV-3029» / «Parada 2 — entregar D1 ·
 * INV-3028». `nombres`: cómo se nombra cada orden (en el mapa, su factura: `nombreEnElMapa`); vacío, sin la cola.
 */
export function textoDeLaParada(p: Pick<ParadaFisica, "numero" | "tipo" | "etiquetas">, nombres: readonly string[], t: (en: string, es: string) => string): string {
  // Una visita con descarga y carga en la misma tienda: las dos cosas, en una línea.
  const mixta = p.etiquetas.some((e) => e.startsWith("P")) && p.etiquetas.some((e) => e.startsWith("D"));
  const que = mixta ? t("drop off and pick up", "entregar y recoger") : p.tipo === "P" ? t("pick up", "recoger") : t("deliver", "entregar");
  return `${t("Stop", "Parada")} ${p.numero} — ${que} ${p.etiquetas.join(", ")}${nombres.length ? ` · ${nombres.join(", ")}` : ""}`;
}

/**
 * Numera las filas EN EL ORDEN `orden` (índices de `filas`, p. ej. `ordenDelDiaDeMiRuta`) y devuelve los números a la posición
 * de cada fila: `deFila` y `primera` por índice de `filas`, y las paradas con sus `filas` en esos mismos índices.
 */
export function paradasDeLaRutaEnElOrden(
  filas: readonly FilaQueSeNumera[], ordenes: readonly OrdenConDestinoDeTienda[], orden: readonly number[],
): ParadasDeLaRuta {
  const enElOrden = paradasDeLaRuta(orden.map((i) => filas[i]), ordenes);
  const deFila: number[] = filas.map(() => 0);
  const primera: boolean[] = filas.map(() => false);
  orden.forEach((i, k) => { deFila[i] = enElOrden.deFila[k]; primera[i] = enElOrden.primera[k]; });
  return { deFila, primera, paradas: enElOrden.paradas.map((p) => ({ ...p, filas: p.filas.map((k) => orden[k]) })) };
}

/**
 * La etiqueta P/D de cada fila (índice de `filas`), sobre el orden `orden`. Con plan publicado, la del plan (ya viene en la
 * fila, D-335). Sin plan, se numeran las recogidas en el orden de la lista (`numeraLaLista`, D-334): así, con lo hecho delante,
 * «P1» es la primera recogida de la lista y no la de la lectura de siempre. El Gestor hace lo mismo sobre su lista pintada.
 */
export function etiquetasDelDia(
  filas: readonly (FilaQueSeNumera & { etiqueta: string })[], fuente: "plan" | "derivada", orden: readonly number[],
): string[] {
  if (fuente === "plan") return filas.map((f) => f.etiqueta);
  const lista: ParadaDeLaLista[] = orden.map((i) => {
    const f = filas[i];
    return f.tipo === "P" ? { tipo: "P", ordenes: f.ordenes, tienda: f.lugar } : { tipo: "D", orden: f.orden };
  });
  const numeros = numeraLaLista(lista);
  const etiquetas: string[] = filas.map((f) => f.etiqueta);
  orden.forEach((i, k) => { etiquetas[i] = etiquetaDeLaParada(lista[k], numeros); });
  return etiquetas;
}
