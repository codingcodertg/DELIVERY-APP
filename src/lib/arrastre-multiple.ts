import { ordenSinRecoger, type ParadaDeLaLista } from "./lista-unica";

/**
 * ARRASTRAR VARIAS ÓRDENES MARCADAS A LA VEZ en la lista de un chofer del Gestor de Rutas (D-1024).
 *
 * Si hay órdenes MARCADAS (las casillas de la tabla) y se arrastra UNA de ellas, todas las marcadas de esa lista se mueven
 * juntas como un bloque, cada una con su recogida (P) y su entrega (D), y entre ellas conservan su orden relativo. Una fila
 * sin marcar se arrastra sola, como siempre (`llevaEnLaLista`). Las flechas ↑ ↓ de una fila marcada mueven el bloque un
 * puesto.
 *
 * Reglas que se mantienen:
 *   · la recogida de una orden va siempre antes que su entrega (el bloque es de órdenes enteras, así que no se rompe);
 *   · la entrega de un paso b de relevo no se adelanta a la recogida de su paso a (`relevos`: b → a), igual que D-994;
 *   · las filas «fijas» (entregadas o canceladas, si alguna llega a la lista) no se mueven y conservan su puesto: el bloque
 *     y el resto de pendientes ocupan los puestos libres, en orden;
 *   · soltar dentro del propio bloque, o sobre una fila fija, no hace nada («borde»).
 *
 * Dónde cae: igual que `llevaEnLaLista`. Subiendo, el bloque va ANTES de la fila de destino; bajando, DETRÁS de ella. Así,
 * arrastrar un bloque de 3 a lo alto de la lista lo deja en las tres primeras posiciones, y con una sola orden marcada el
 * resultado es el mismo que el de arrastrar esa fila.
 *
 * Puro: no escribe nada. La pantalla lo llama y guarda el resultado con el MISMO camino que una fila suelta
 * (`guardaLaLista`): una sola escritura por lotes y un solo movimiento para deshacer.
 */

export interface OpcionesDelBloque {
  /** Órdenes que no se mueven nunca (entregadas o canceladas). Sus filas conservan el puesto. */
  fijas?: ReadonlySet<string>;
  /** Relevos: el id del paso b → el id de su paso a. La recogida de b no puede quedar antes que la entrega de a. */
  relevos?: ReadonlyMap<string, string>;
}

export type MovimientoDelBloque =
  | { ok: true; paradas: ParadaDeLaLista[]; ordenes: string[] }
  | { ok: false; motivo: "borde" }
  | { ok: false; motivo: "precedencia"; orden: string }
  | { ok: false; motivo: "relevo"; orden: string };

/** Los ids de orden de una fila (una P suelta lleva una sola; una legacy con varias, todas). */
const ordenesDeLaFila = (p: ParadaDeLaLista): string[] => (p.tipo === "P" ? p.ordenes : [p.orden]);

/**
 * El bloque que arrastra la fila `indice`: las órdenes MARCADAS de la lista, en su orden de lista, si la fila es de una
 * orden marcada y hay al menos DOS marcadas. Con una sola (o si la fila no está marcada) es `null`: se mueve la fila sola.
 */
export function ordenesDelBloque(lista: readonly ParadaDeLaLista[], marcadas: ReadonlySet<string>, indice: number): string[] | null {
  const fila = lista[indice];
  if (!fila || !ordenesDeLaFila(fila).some((id) => marcadas.has(id))) return null;
  const ordenes: string[] = [];
  for (const p of lista) for (const id of ordenesDeLaFila(p)) if (marcadas.has(id) && !ordenes.includes(id)) ordenes.push(id);
  return ordenes.length >= 2 ? ordenes : null;
}

/**
 * Mueve el bloque de órdenes `ordenes` (las de `ordenesDelBloque`) a la posición de la fila `destino`.
 * Ver la cabecera: subiendo, antes de `destino`; bajando, después.
 */
export function mueveBloque(
  lista: readonly ParadaDeLaLista[], ordenes: readonly string[], destino: number, opciones: OpcionesDelBloque = {},
): MovimientoDelBloque {
  const fijas = opciones.fijas ?? new Set<string>();
  const enBloque = new Set(ordenes.filter((id) => !(opciones.fijas?.has(id))));
  const esFija = (p: ParadaDeLaLista) => ordenesDeLaFila(p).every((id) => fijas.has(id));
  const esDelBloque = (p: ParadaDeLaLista) => ordenesDeLaFila(p).some((id) => enBloque.has(id));
  if (destino < 0 || destino >= lista.length) return { ok: false, motivo: "borde" };
  if (esFija(lista[destino]) || esDelBloque(lista[destino])) return { ok: false, motivo: "borde" };

  // Las filas que se mueven (no fijas), en orden; dentro de ellas, las del bloque y el resto.
  const movibles = lista.map((_, i) => i).filter((i) => !esFija(lista[i]));
  const delBloque = movibles.filter((i) => esDelBloque(lista[i]));
  const resto = movibles.filter((i) => !esDelBloque(lista[i]));
  if (!delBloque.length) return { ok: false, motivo: "borde" };

  // Dónde cae: subiendo (el destino está antes del último del bloque), antes del destino; bajando, después.
  const bajando = destino > delBloque[delBloque.length - 1];
  const antes = resto.filter((i) => i < destino).length;
  const posicion = bajando ? antes + 1 : antes;
  const nuevoOrden = [...resto.slice(0, posicion), ...delBloque, ...resto.slice(posicion)];

  // Las filas fijas se quedan donde estaban; el resto ocupa los puestos libres, en el nuevo orden.
  const porPuesto: ParadaDeLaLista[] = [...lista];
  nuevoOrden.forEach((origen, k) => { porPuesto[movibles[k]] = lista[origen]; });
  const nuevas = porPuesto;

  if (nuevas.every((p, i) => p === lista[i])) return { ok: false, motivo: "borde" };

  const rota = ordenSinRecoger(nuevas);
  if (rota != null) return { ok: false, motivo: "precedencia", orden: rota };

  // Relevo: el paso b no puede quedar antes que la entrega de su paso a (si antes no estaba así).
  const sacaPosiciones = (l: readonly ParadaDeLaLista[]) => {
    const p = new Map<string, number>(), d = new Map<string, number>();
    l.forEach((x, i) => { if (x.tipo === "P") x.ordenes.forEach((id) => p.set(id, i)); else d.set(x.orden, i); });
    return { p, d };
  };
  const antesRel = sacaPosiciones(lista), despuesRel = sacaPosiciones(nuevas);
  for (const [b, a] of opciones.relevos ?? []) {
    const pb = despuesRel.p.get(b), da = despuesRel.d.get(a);
    if (pb == null || da == null || pb > da) continue;
    const pbAntes = antesRel.p.get(b), daAntes = antesRel.d.get(a);
    if (pbAntes != null && daAntes != null && pbAntes < daAntes) continue;
    return { ok: false, motivo: "relevo", orden: b };
  }

  return { ok: true, paradas: nuevas, ordenes: [...ordenes] };
}

/**
 * Las flechas ↑ / ↓ de una fila marcada: el bloque sube o baja UN paso, saltando la orden entera (su recogida y su entrega)
 * que tiene al lado. Si ya está arriba (o abajo) del todo, es «borde».
 */
export function flechaDelBloque(
  lista: readonly ParadaDeLaLista[], ordenes: readonly string[], dir: -1 | 1, opciones: OpcionesDelBloque = {},
): MovimientoDelBloque {
  const enBloque = new Set(ordenes.filter((id) => !opciones.fijas?.has(id)));
  const idx = lista.map((p, i) => (ordenesDeLaFila(p).some((id) => enBloque.has(id)) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return { ok: false, motivo: "borde" };
  const filasDe = (orden: string) => lista.flatMap((p, i) => (ordenesDeLaFila(p).includes(orden) ? [i] : []));
  if (dir < 0) {
    const j = idx[0] - 1;
    if (j < 0) return { ok: false, motivo: "borde" };
    // Sube por delante de la orden de arriba entera: antes de su primera fila.
    return mueveBloque(lista, ordenes, Math.min(...ordenesDeLaFila(lista[j]).flatMap(filasDe)), opciones);
  }
  const j = idx[idx.length - 1] + 1;
  if (j >= lista.length) return { ok: false, motivo: "borde" };
  // Baja detrás de la orden de abajo entera: después de su última fila.
  return mueveBloque(lista, ordenes, Math.max(...ordenesDeLaFila(lista[j]).flatMap(filasDe)), opciones);
}
