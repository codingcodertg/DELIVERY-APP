import { ordenSinRecoger, llevaEnLaLista, type ParadaDeLaLista } from "./lista-unica";
import { relevoRoto, type OpcionesDelBloque } from "./arrastre-multiple";

/**
 * «MOVER A LA PARADA N» y «TRAER SU ENTREGA» en la lista de un chofer del Gestor de Rutas (D-1145).
 *
 * El dueño, 2026-11-23, después de armar las rutas con Roberto: «un botón que diga de un solo "move it to a specific
 * position", like move it to stop number 5, y que ahí se mueva él solo, y otro botón que automáticamente se traiga al
 * delivery portion también up», y «haz posible poder rearrange más de uno a la vez». Roberto, en la reunión: «move this
 * to be number one or number three». Con veinte paradas, subir una de la 14 a la 1 eran trece flechas o un arrastre con
 * la lista sin moverse.
 *
 * Puro: no escribe nada. La pantalla lo llama y guarda el resultado por el MISMO camino que las flechas y el arrastre
 * (`guardaLaLista`): una escritura por lotes y un movimiento para deshacer.
 *
 * El «N» es el NÚMERO DE PARADA que la tabla pinta en su círculo (el del día, con lo ya hecho contado): varias filas en el
 * mismo sitio comparten número. Una parada ya hecha no se toca.
 */

/** De qué fila a qué fila de la lista que se mueve (`lectura.paradas`) va cada número de parada pendiente. */
export type RangosDeParada = ReadonlyMap<number, { desde: number; hasta: number }>;

/**
 * Los rangos: `filas` son las de la lectura (cada una con su `indice` en la lista que se mueve, o `null`) y `dePendiente`
 * el número de parada del día de cada una (`NumerosDelDia.dePendiente`).
 */
export function rangosDeParada(filas: readonly { indice: number | null }[], dePendiente: readonly number[]): Map<number, { desde: number; hasta: number }> {
  const r = new Map<number, { desde: number; hasta: number }>();
  filas.forEach((f, i) => {
    const n = dePendiente[i];
    if (f.indice == null || n == null) return;
    const ya = r.get(n);
    r.set(n, ya ? { desde: Math.min(ya.desde, f.indice), hasta: Math.max(ya.hasta, f.indice) } : { desde: f.indice, hasta: f.indice });
  });
  return r;
}

export type MovimientoAParada =
  | { ok: true; paradas: ParadaDeLaLista[]; ordenes: string[] }
  /** Ya está ahí, o no hay nada que cambiar. */
  | { ok: false; motivo: "borde" }
  /** Ese número no es de una parada pendiente: `min`–`max` son las que sí. */
  | { ok: false; motivo: "no_existe"; min: number; max: number }
  | { ok: false; motivo: "precedencia"; orden: string }
  | { ok: false; motivo: "relevo"; orden: string };

const ordenesDeLaFila = (p: ParadaDeLaLista): string[] => (p.tipo === "P" ? p.ordenes : [p.orden]);

/**
 * Las ÓRDENES `ordenes`, enteras (su recogida y su entrega), juntas y en su orden de lista, justo ANTES de la fila que hoy
 * está en `ante` (o al final, si `ante` es el largo de la lista). Si `ante` cae en una fila de las que se mueven, cuenta la
 * siguiente que no lo sea. Las reglas, las de siempre: la recogida antes que su entrega, y el paso b de un relevo no se
 * adelanta a la entrega de su paso a.
 */
export function llevaOrdenesAntesDe(
  lista: readonly ParadaDeLaLista[], ordenes: readonly string[], ante: number, opciones: OpcionesDelBloque = {},
): MovimientoAParada {
  const enBloque = new Set(ordenes);
  const esDelBloque = (p: ParadaDeLaLista) => ordenesDeLaFila(p).some((id) => enBloque.has(id));
  const bloque = lista.filter(esDelBloque);
  if (!bloque.length || ante < 0 || ante > lista.length) return { ok: false, motivo: "borde" };
  const antes = lista.slice(0, ante).filter((p) => !esDelBloque(p));
  const despues = lista.slice(ante).filter((p) => !esDelBloque(p));
  const nuevas = [...antes, ...bloque, ...despues];
  if (nuevas.every((p, i) => p === lista[i])) return { ok: false, motivo: "borde" };
  const rota = ordenSinRecoger(nuevas);
  if (rota != null) return { ok: false, motivo: "precedencia", orden: rota };
  const relevo = relevoRoto(lista, nuevas, opciones.relevos);
  if (relevo != null) return { ok: false, motivo: "relevo", orden: relevo };
  return { ok: true, paradas: nuevas, ordenes: [...ordenes] };
}

/**
 * La fila `desde` (o, con `ordenes`, esas órdenes enteras) a la parada número `numero`.
 *
 *   · sin `ordenes`: SOLO esa fila, como soltarla sobre la parada (`llevaEnLaLista`): si sube queda la primera de esa
 *     parada; si baja, la última;
 *   · con `ordenes` (la orden entera de la fila, o las marcadas): van juntas, recogida y entrega, delante de esa parada si
 *     suben y detrás si bajan.
 */
export function mueveAParada(
  lista: readonly ParadaDeLaLista[], rangos: RangosDeParada, desde: number, numero: number,
  ordenes: readonly string[] | null = null, opciones: OpcionesDelBloque = {},
): MovimientoAParada {
  const destino = rangos.get(numero);
  if (!destino) {
    const numeros = [...rangos.keys()];
    return { ok: false, motivo: "no_existe", min: numeros.length ? Math.min(...numeros) : 0, max: numeros.length ? Math.max(...numeros) : 0 };
  }
  if (!ordenes?.length) {
    if (desde >= destino.desde && desde <= destino.hasta) return { ok: false, motivo: "borde" };
    const r = llevaEnLaLista(lista, desde, desde > destino.desde ? destino.desde : destino.hasta);
    return r.ok ? { ok: true, paradas: r.paradas, ordenes: lista[desde] ? ordenesDeLaFila(lista[desde]) : [] } : r;
  }
  const enBloque = new Set(ordenes);
  const primera = lista.findIndex((p) => ordenesDeLaFila(p).some((id) => enBloque.has(id)));
  if (primera < 0) return { ok: false, motivo: "borde" };
  return llevaOrdenesAntesDe(lista, ordenes, primera > destino.desde ? destino.desde : destino.hasta + 1, opciones);
}

/**
 * «Traer su entrega»: la entrega (o entregas) de la recogida que está en `indice`, justo DETRÁS de ella. La recogida no se
 * mueve de su puesto. `borde` si ya la tiene detrás, o si la fila no es una recogida.
 */
export function traeLaEntrega(lista: readonly ParadaDeLaLista[], indice: number, opciones: OpcionesDelBloque = {}): MovimientoAParada {
  const p = lista[indice];
  if (!p || p.tipo !== "P") return { ok: false, motivo: "borde" };
  return llevaOrdenesAntesDe(lista, p.ordenes, indice, opciones);
}

/**
 * DESPLAZAR SOLA la lista mientras se arrastra (D-1145; el dueño: «si lo muevo hacia arriba que él haga el scroll, porque
 * ahorita debo ir haciendo como escalones»): píxeles por cuadro según lo cerca que esté el puntero del borde de lo que se
 * ve. Negativo sube, positivo baja, 0 no se mueve. Más cerca del borde, más rápido; fuera de la caja, al máximo.
 */
export const MARGEN_DE_AUTOSCROLL = 80;
export const TOPE_DE_AUTOSCROLL = 26;
export function velocidadDeAutoScroll(y: number, arriba: number, abajo: number, margen = MARGEN_DE_AUTOSCROLL, tope = TOPE_DE_AUTOSCROLL): number {
  if (!(abajo > arriba)) return 0;
  const m = Math.min(margen, (abajo - arriba) / 3);
  if (m <= 0) return 0;
  if (y < arriba + m) return -Math.ceil(tope * Math.min(1, (arriba + m - y) / m));
  if (y > abajo - m) return Math.ceil(tope * Math.min(1, (y - (abajo - m)) / m));
  return 0;
}

/**
 * «MARCAR POR…» (D-1145): los grupos de una ruta que se marcan de un toque —por ciudad de entrega y por tienda de recogida—
 * para moverlos juntos, pasarlos a otro chofer o reprogramarlos. Roberto, 2026-11-23: «in Excel I can color things: I would
 * color all the Edinburg stuff and then sort it to the top», y «it would be good here to include the filter options».
 * Lo más numeroso primero.
 */
export interface GrupoParaMarcar { clave: string; tipo: "ciudad" | "tienda"; nombre: string; ids: string[] }
export function gruposParaMarcar<T extends { id: string; pickup_name?: string | null; store?: string | null }>(
  ordenes: readonly T[], ciudadDe: (o: T) => string | null | undefined,
): GrupoParaMarcar[] {
  const junta = (tipo: GrupoParaMarcar["tipo"], nombreDe: (o: T) => string | null | undefined): GrupoParaMarcar[] => {
    const m = new Map<string, GrupoParaMarcar>();
    for (const o of ordenes) {
      const nombre = (nombreDe(o) ?? "").trim();
      if (!nombre) continue;
      const clave = `${tipo}:${nombre.toLowerCase()}`;
      const g = m.get(clave) ?? { clave, tipo, nombre, ids: [] };
      g.ids.push(o.id);
      m.set(clave, g);
    }
    return [...m.values()].sort((a, b) => b.ids.length - a.ids.length || a.nombre.localeCompare(b.nombre));
  };
  return [...junta("ciudad", ciudadDe), ...junta("tienda", (o) => o.pickup_name || o.store)];
}
