import { cambiosDeLaLista, etiquetaDeLaParada, listaDelChofer, numeraLaLista, type OrdenDeLaLista, type ParadaDeLaLista } from "@/lib/lista-unica";
import { ordenDeLaParte, posicionesDeLaRuta, posicionesPorViajeHistoricas } from "./publicar";

/**
 * La ruta de un chofer como se LEE en el Gestor y en «Mi ruta»: su lista de paradas —recogidas y entregas, una sola lista
 * desde D-443—, con qué etiqueta P/D lleva cada una y cuánto suma o resta de pallets.
 *
 * De dónde sale la lista (D-335, sin viajes desde D-443), por chofer:
 *   · **Si su ruta sigue siendo EXACTAMENTE la que el plan publicó** —las mismas órdenes, cada una en el puesto que el plan
 *     le dio—, manda el plan: sus paradas tal cual (las recogidas donde el motor las puso, también las recargas a media
 *     ruta), sus etiquetas y su carga. Un cambio de ETAPA no es tocar la ruta: lo ya hecho (`hechas`) cuenta para comparar
 *     y no se pinta.
 *   · **Si no** —o no hay plan—, manda lo guardado: `listaDelChofer` (lib/lista-unica). Y si había plan, se avisa de que
 *     cambió y en qué (`cambiosTrasPublicar`, D-341).
 *
 * «La que el plan publicó» se recalcula de las PARADAS, con la misma función que usa publicar (`posicionesDeLaRuta`), no de
 * `route_plans.writes`: el chofer no puede leer el plan, pero sí sus paradas (134). Así el Gestor y «Mi ruta» deciden igual.
 */

export interface ParadaDelPlanMinima { kind: "P" | "D"; order_ref: string; seq: number; label: string; load_after: number | string; place?: string | null }
export interface OrdenAsignada extends OrdenDeLaLista { id: string }

/** Una fila de la lista. `indice`: su parada en `LecturaDeRuta.paradas` (la que mueven las flechas); `null` en la entrega
 *  de OTRA carga de una orden que el motor repartió (informa, no se mueve). `cambio`: + recoge, − entrega, `null` sin conteo. */
export type FilaDeLaRuta =
  | { tipo: "P"; ordenes: string[]; lugar: string | null; etiqueta: string; cambio: number | null; indice: number | null }
  | { tipo: "D"; orden: string; etiqueta: string; cambio: number | null; indice: number | null; otraCarga: boolean };

export interface LecturaDeRuta {
  fuente: "plan" | "derivada";
  /** Hay plan publicado para este chofer, pero su ruta ya no es la que el plan escribió: se avisa. */
  cambioTrasPublicar: boolean;
  /** EN QUÉ cambió (D-341). `null` justo cuando `cambioTrasPublicar` es falso: es la misma decisión, con su detalle. */
  cambios: CambiosTrasPublicar | null;
  /** La etiqueta de entrega de cada orden («D3»; una orden repartida en cargas lleva todas: «D3·D5»). Para el mapa. */
  etiquetaDe: Map<string, string>;
  /** La lista, como se pinta. */
  filas: FilaDeLaRuta[];
  /** Las paradas que se mueven y se escriben (`lista-unica`), en el orden de la lista. */
  paradas: ParadaDeLaLista[];
}

const casi = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * ¿La ruta de hoy es exactamente la que el plan publicó? Mismas órdenes, cada una en su puesto; y, si la base guarda la
 * posición de la recogida (154), también esa. Una ruta publicada ANTES de D-443 se guardó por viajes: también vale si
 * coincide con eso (`posicionesPorViajeHistoricas`), para no avisar de un cambio que nadie hizo.
 */
export function sigueElPlan(paradas: readonly ParadaDelPlanMinima[], asignadas: readonly OrdenAsignada[]): boolean {
  const enOrdenDelPlan = enOrden(paradas);
  const delPlan = posicionesDeLaRuta(enOrdenDelPlan.map((p) => ({ tipo: p.kind, orden: p.order_ref })));
  if (delPlan.length === 0 || delPlan.length !== asignadas.length) return false;
  const hoy = new Map(asignadas.map((o) => [o.id, o]));
  const seguida = delPlan.every((p) => {
    const o = hoy.get(p.id);
    if (!o || o.route_seq !== p.route_seq) return false;
    if (o.pickup_seq === undefined || p.pickup_seq == null) return true;
    return o.pickup_seq != null && casi(Number(o.pickup_seq), p.pickup_seq);
  });
  if (seguida) return true;
  // Lo histórico solo si se guardó por viajes: publicar escribía `load_no` en TODAS (1 el primero). Una ruta guardada desde
  // D-443 lo lleva vacío, y no se juzga con la regla vieja (le daría por buena una recogida movida).
  if (!asignadas.every((o) => o.load_no != null)) return false;
  const porViaje = posicionesPorViajeHistoricas(enOrdenDelPlan.map((p) => ({ tipo: p.kind, orden: p.order_ref, cargaAlSalir: Number(p.load_after) })));
  return porViaje.every((p) => { const o = hoy.get(p.id); return !!o && Number(o.load_no ?? 1) === p.load_no && o.route_seq === p.route_seq; });
}

/**
 * EN QUÉ cambió la ruta desde que se publicó el plan (D-341), para decírselo al chofer en «Mi ruta».
 *
 * SI cambió lo sigue decidiendo `sigueElPlan` —no hay una segunda comparación—: esto solo desglosa su «no». Por eso puede
 * salir un cambio SIN detalle (listas vacías y `ordenCambiado` falso): las mismas órdenes, en el mismo orden, pero con el
 * puesto renumerado, sin puesto, o con una recogida movida. Entonces se avisa igual, sin pormenor.
 *
 * - `anadidas`: están en la ruta y el plan no las tenía — en el orden en que la pantalla las enseña.
 * - `quitadas`: el plan las tenía y ya no están en la ruta de hoy (otro chofer, otro día, cancelada) — en el orden del plan.
 * - `ordenCambiado`: las que siguen en las dos van en otro orden de entrega. Se comparan SOLO las comunes.
 *
 * (Hasta D-443 había también `viajeCambiado`, «una parada pasó a otro viaje». Sin viajes no hay tal cosa.)
 */
export interface CambiosTrasPublicar { anadidas: string[]; quitadas: string[]; ordenCambiado: boolean }

export function cambiosTrasPublicar(paradas: readonly ParadaDelPlanMinima[] | null, asignadas: readonly OrdenAsignada[]): CambiosTrasPublicar | null {
  if (!paradas || paradas.length === 0 || sigueElPlan(paradas, asignadas)) return null;
  const delPlan = posicionesDeLaRuta(enOrden(paradas).map((p) => ({ tipo: p.kind, orden: p.order_ref }))).map((p) => p.id);
  const enElPlan = new Set(delPlan);
  const hoy = new Set(asignadas.map((o) => o.id));
  const comunesHoy = asignadas.filter((o) => enElPlan.has(o.id));
  const comunesPlan = delPlan.filter((id) => hoy.has(id));
  return {
    anadidas: asignadas.filter((o) => !enElPlan.has(o.id)).map((o) => o.id),
    quitadas: delPlan.filter((id) => !hoy.has(id)),
    ordenCambiado: comunesHoy.some((o, i) => o.id !== comunesPlan[i]),
  };
}

const enOrden = (paradas: readonly ParadaDelPlanMinima[]) => [...paradas].sort((a, b) => a.seq - b.seq);

/**
 * La lectura de la ruta de un chofer.
 * - `ordenes`: las suyas que se pintan (en el Gestor, las pendientes; en «Mi ruta», las del día).
 * - `capacidad`: la de su camión, para la regla de recogidas cuando no hay posición guardada (`listaDelChofer`).
 * - `paradas`: las suyas en el plan publicado, o `null`.
 * - `hechas` (D-433): lo que ya recogió o entregó y la pantalla no pinta; cuenta para saber si la ruta sigue siendo la
 *   publicada (el plan las conserva), y no sale en la lista.
 */
export function lecturaDeLaRuta(
  ordenes: readonly OrdenAsignada[], capacidad: number, paradas: readonly ParadaDelPlanMinima[] | null, hechas: readonly OrdenAsignada[] = [],
): LecturaDeRuta {
  const hayPlan = !!paradas && paradas.length > 0;
  const todas = [...ordenes, ...hechas];
  if (hayPlan && sigueElPlan(paradas!, todas)) return delPlan(enOrden(paradas!), ordenes);
  const lista = listaDelChofer(ordenes, capacidad);
  const numeros = numeraLaLista(lista);
  const cambios = cambiosDeLaLista(lista, ordenes);
  const filas: FilaDeLaRuta[] = lista.map((p, i) => (p.tipo === "P"
    ? { tipo: "P", ordenes: p.ordenes, lugar: p.tienda, etiqueta: etiquetaDeLaParada(p, numeros), cambio: cambios[i], indice: i }
    : { tipo: "D", orden: p.orden, etiqueta: etiquetaDeLaParada(p, numeros), cambio: cambios[i], indice: i, otraCarga: false }));
  const etiquetaDe = new Map(filas.flatMap((f) => (f.tipo === "D" ? [[f.orden, f.etiqueta] as const] : [])));
  const detalle = hayPlan ? cambiosTrasPublicar(paradas, todas) : null;
  return { fuente: "derivada", cambioTrasPublicar: detalle !== null, cambios: detalle, etiquetaDe, filas, paradas: lista };
}

/** La lista tal como la dejó el plan, solo con las órdenes que se pintan. La carga de cada parada, la del plan (lo que
 *  cambió `load_after`): así cuadra también una orden repartida en cargas. Cada recogida, su fila (D-444). */
function delPlan(paradas: readonly ParadaDelPlanMinima[], ordenes: readonly OrdenAsignada[]): LecturaDeRuta {
  const pinta = new Set(ordenes.map((o) => o.id));
  const filas: FilaDeLaRuta[] = [];
  const lista: ParadaDeLaLista[] = [];
  const etiquetas = new Map<string, string[]>();
  const entregada = new Set<string>(), recogida = new Set<string>();
  let antes = 0;
  for (const p of paradas) {
    const id = ordenDeLaParte(p.order_ref);
    const ahora = Number(p.load_after);
    const cambio = Math.round((ahora - antes) * 100) / 100;
    antes = ahora;
    if (!pinta.has(id)) continue;
    if (p.kind === "D") {
      etiquetas.set(id, [...(etiquetas.get(id) ?? []), p.label]);
      const otraCarga = entregada.has(id);
      entregada.add(id);
      if (!otraCarga) lista.push({ tipo: "D", orden: id });
      filas.push({ tipo: "D", orden: id, etiqueta: p.label, cambio, indice: otraCarga ? null : lista.length - 1, otraCarga });
      continue;
    }
    // Cada recogida en su fila, también seguidas en el mismo sitio (D-444): el grupo lo pinta el color, no una fila juntada.
    const lugar = p.place ?? null;
    if (recogida.has(id)) {
      // Otra carga de una orden ya recogida: el camión vuelve a por ella. Se pinta; no es otra recogida que mover.
      filas.push({ tipo: "P", ordenes: [id], lugar, etiqueta: p.label, cambio, indice: null });
    } else {
      lista.push({ tipo: "P", ordenes: [id], tienda: lugar });
      filas.push({ tipo: "P", ordenes: [id], lugar, etiqueta: p.label, cambio, indice: lista.length - 1 });
    }
    recogida.add(id);
  }
  return { fuente: "plan", cambioTrasPublicar: false, cambios: null, etiquetaDe: new Map([...etiquetas].map(([id, e]) => [id, e.join("·")])), filas, paradas: lista };
}

/**
 * Una ruta que NADIE ordenó —ninguna de sus órdenes tiene puesto (`route_seq`)— enseña su P/D **provisional** (D-379): en
 * gris, siguiendo el orden de ahora. Desde D-443 también en una ruta ordenada A MEDIAS: la lista ya lleva la recogida y la
 * entrega de TODAS sus órdenes (las que no tienen puesto, al final), así que no queda ningún número que saltar (lo que
 * D-336 evitaba pintando «—»); lo que aún no tiene puesto se marca provisional, fila a fila (`esProvisionalLaFila`).
 */
export function esProvisional(ordenes: readonly { route_seq?: number | null }[]): boolean {
  return ordenes.length > 0 && ordenes.every((o) => o.route_seq == null);
}

/** ¿La etiqueta de esta fila es provisional? Una entrega sin puesto; una recogida cuyas órdenes no tienen ninguna puesto. */
export function esProvisionalLaFila(f: FilaDeLaRuta, porId: ReadonlyMap<string, { route_seq?: number | null }>): boolean {
  const sin = (id: string) => porId.get(id)?.route_seq == null;
  return f.tipo === "D" ? sin(f.orden) : f.ordenes.every(sin);
}
