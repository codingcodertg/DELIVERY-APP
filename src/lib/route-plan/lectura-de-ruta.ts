import { ordenesDeRuta, secuenciaPD } from "@/lib/secuencia-pd";
import { ordenDeLaParte, posicionesDeLaRuta } from "./publicar";

/**
 * Qué etiquetas P/D lleva una ruta cuando HAY un plan publicado (D-335).
 *
 * El hueco: D-334 lee cualquier ruta asignada con `secuenciaPD` (todas las recogidas del viaje delante, tiendas por
 * primera entrega). Un plan del motor decide él el orden de las recogidas y las intercala. Medido: para la secuencia
 * `P x → P y → D y → D x` el plan dice y = D2, y `secuenciaPD` sobre lo que ESE MISMO plan escribió dice y = D1. El chofer
 * vería «D2» en «Orden planeado del día» y «D1» en su lista; quien despacha, lo mismo entre «Plan del día» y la tabla.
 *
 * La regla, por chofer: **si su ruta sigue siendo EXACTAMENTE la que el plan publicó —las mismas órdenes, en el mismo
 * viaje y en el mismo puesto— manda el plan**: su secuencia tal cual (recogidas donde el motor las puso) y sus etiquetas.
 * **Si alguien la tocó a mano después, manda la lectura derivada**, y se dice. Un cambio de ETAPA (en camino, entregada)
 * no es tocar la ruta. Tocar la ruta de un chofer no invalida las de los demás.
 *
 * «La que el plan publicó» se recalcula de las PARADAS, con la misma función que usa publicar (`posicionesDeLaRuta`), no de
 * `route_plans.writes`: el chofer no puede leer el plan, pero sí sus paradas (134). Así el Gestor y «Mi ruta» deciden igual.
 */

export interface ParadaDelPlanMinima { kind: "P" | "D"; order_ref: string; seq: number; label: string; load_after: number | string; place?: string | null }
export interface OrdenAsignada { id: string; store?: string | null; actual_pallets?: number | null; est_pallets?: number | null; load_no?: number | null; route_seq?: number | null }

/** Una fila que INFORMA entre dos entregas: una recogida (una o varias órdenes en el mismo sitio) o la entrega de otra
 *  carga de una orden repartida. No es una orden de la lista: no se pulsa ni se mueve. */
export interface FilaInformativa { tipo: "P" | "D"; etiquetas: string[]; ordenes: string[]; lugar: string | null; aBordo: number; sinConteo: boolean }

export interface LecturaDeRuta {
  fuente: "plan" | "derivada";
  /** Hay plan publicado para este chofer, pero su ruta ya no es la que el plan escribió: se avisa. */
  cambioTrasPublicar: boolean;
  /** EN QUÉ cambió (D-341). `null` justo cuando `cambioTrasPublicar` es falso: es la misma decisión, con su detalle. */
  cambios: CambiosTrasPublicar | null;
  /** La etiqueta de entrega de cada orden. Una orden repartida en cargas lleva todas: «D3·D5». */
  etiquetaDe: Map<string, string>;
  /** Lo que pasa ANTES de la entrega de cada orden, desde la entrega anterior. */
  previas: Map<string, FilaInformativa[]>;
  /** Lo que el plan deja tras la última entrega de la lista (la segunda carga de una orden repartida, por ejemplo). */
  alFinal: FilaInformativa[];
}

/** El viaje y el puesto que el plan le dio a cada orden: lo que publicar escribió, recalculado de las paradas. */
const posicionesDelPlan = (paradas: readonly ParadaDelPlanMinima[]) =>
  posicionesDeLaRuta(enOrden(paradas).map((p) => ({ tipo: p.kind, orden: p.order_ref, cargaAlSalir: Number(p.load_after) })));

/** ¿La ruta de hoy es exactamente la que el plan publicó? Mismas órdenes, mismo viaje, mismo puesto. */
export function sigueElPlan(paradas: readonly ParadaDelPlanMinima[], asignadas: readonly OrdenAsignada[]): boolean {
  const delPlan = posicionesDelPlan(paradas);
  if (delPlan.length === 0 || delPlan.length !== asignadas.length) return false;
  const hoy = new Map(asignadas.map((o) => [o.id, o]));
  return delPlan.every((p) => { const o = hoy.get(p.id); return !!o && Number(o.load_no ?? 1) === p.load_no && o.route_seq === p.route_seq; });
}

/**
 * EN QUÉ cambió la ruta desde que se publicó el plan (D-341), para decírselo al chofer en «Mi ruta».
 *
 * SI cambió lo sigue decidiendo `sigueElPlan` —no hay una segunda comparación—: esto solo desglosa su «no», contra las
 * mismas posiciones del plan. Por eso puede salir un cambio SIN detalle (listas vacías y los dos falsos): las mismas
 * órdenes, en el mismo orden y viaje, pero con el puesto renumerado o sin puesto. Entonces se avisa igual, sin pormenor.
 *
 * - `anadidas`: están en la ruta y el plan no las tenía — en el orden en que la pantalla las enseña.
 * - `quitadas`: el plan las tenía y ya no están en la ruta de hoy (otro chofer, otro día, cancelada) — en el orden del plan.
 * - `ordenCambiado`: las que siguen en las dos van en otro orden. Se comparan SOLO las comunes: añadir o quitar una
 *   parada no es, por sí solo, reordenar las demás. El orden de hoy es el de `asignadas`, que es el que la pantalla pinta.
 * - `viajeCambiado`: alguna de las comunes va ahora en otro viaje (`load_no`).
 *
 * `null`: no hay plan con el que comparar, o la ruta sigue siendo la publicada.
 */
export interface CambiosTrasPublicar { anadidas: string[]; quitadas: string[]; ordenCambiado: boolean; viajeCambiado: boolean }

export function cambiosTrasPublicar(paradas: readonly ParadaDelPlanMinima[] | null, asignadas: readonly OrdenAsignada[]): CambiosTrasPublicar | null {
  if (!paradas || paradas.length === 0 || sigueElPlan(paradas, asignadas)) return null;
  const delPlan = new Map(posicionesDelPlan(paradas).map((p) => [p.id, p]));
  const hoy = new Set(asignadas.map((o) => o.id));
  const comunesHoy = asignadas.filter((o) => delPlan.has(o.id));
  const comunesPlan = [...delPlan.keys()].filter((id) => hoy.has(id));
  return {
    anadidas: asignadas.filter((o) => !delPlan.has(o.id)).map((o) => o.id),
    quitadas: [...delPlan.keys()].filter((id) => !hoy.has(id)),
    ordenCambiado: comunesHoy.some((o, i) => o.id !== comunesPlan[i]),
    viajeCambiado: comunesHoy.some((o) => Number(o.load_no ?? 1) !== delPlan.get(o.id)!.load_no),
  };
}

const enOrden = (paradas: readonly ParadaDelPlanMinima[]) => [...paradas].sort((a, b) => a.seq - b.seq);

/** `viajes`: los viajes del chofer tal como los pinta la pantalla. `paradas`: las suyas en el plan publicado, o `null`. */
export function lecturaDeLaRuta(viajes: readonly (readonly OrdenAsignada[])[], paradas: readonly ParadaDelPlanMinima[] | null): LecturaDeRuta {
  const asignadas = viajes.flat();
  const hayPlan = !!paradas && paradas.length > 0;
  if (hayPlan && sigueElPlan(paradas!, asignadas)) return delPlan(enOrden(paradas!), asignadas);

  // Una ruta ordenada A MEDIAS (D-336): las órdenes que aún no tienen puesto no gastan número. Si lo gastaran, la tabla
  // —que les pinta «—»— saltaría de D1 a D3 y la fila de recogida nombraría un P2 que no está en ninguna parte. Si NINGUNA
  // tiene puesto no hay nada que saltar: se numeran todas, que es como «Mi ruta» enseña una ruta que nadie ordenó.
  const aMedias = asignadas.some((o) => o.route_seq != null);
  const pd = secuenciaPD(viajes.map((v) => ordenesDeRuta(aMedias ? v.filter((o) => o.route_seq != null) : v)));
  const etiquetaDe = new Map<string, string>(), previas = new Map<string, FilaInformativa[]>();
  let pendientes: FilaInformativa[] = [];
  for (const p of pd) {
    if (p.tipo === "P") pendientes.push({ tipo: "P", etiquetas: p.etiquetas, ordenes: p.ordenes, lugar: p.tienda, aBordo: p.aBordo, sinConteo: p.sinConteo });
    else { etiquetaDe.set(p.ordenes[0], p.etiquetas[0]); previas.set(p.ordenes[0], pendientes); pendientes = []; }
  }
  const cambios = cambiosTrasPublicar(paradas, asignadas);
  return { fuente: "derivada", cambioTrasPublicar: cambios !== null, cambios, etiquetaDe, previas, alFinal: [] };
}

function delPlan(paradas: readonly ParadaDelPlanMinima[], asignadas: readonly OrdenAsignada[]): LecturaDeRuta {
  const etiquetas = new Map<string, string[]>(), previas = new Map<string, FilaInformativa[]>();
  const yaEntregada = new Set<string>();
  const sinPallets = new Set(asignadas.filter((o) => o.actual_pallets == null && o.est_pallets == null).map((o) => o.id));
  let pendientes: FilaInformativa[] = [];
  for (const p of paradas) {
    const id = ordenDeLaParte(p.order_ref);
    const aBordo = Number(p.load_after);
    if (p.kind === "D") etiquetas.set(id, [...(etiquetas.get(id) ?? []), p.label]);
    if (p.kind === "D" && !yaEntregada.has(id)) { yaEntregada.add(id); previas.set(id, pendientes); pendientes = []; continue; }
    // Una recogida; o la entrega de OTRA carga de una orden que ya tiene su fila. Recogidas seguidas en el mismo sitio
    // son una sola parada física, como en el motor.
    const ultima = pendientes[pendientes.length - 1];
    if (p.kind === "P" && ultima?.tipo === "P" && !!p.place && ultima.lugar === p.place) {
      ultima.etiquetas.push(p.label); ultima.ordenes.push(id); ultima.aBordo = aBordo; ultima.sinConteo ||= sinPallets.has(id);
    } else pendientes.push({ tipo: p.kind, etiquetas: [p.label], ordenes: [id], lugar: p.place ?? null, aBordo, sinConteo: sinPallets.has(id) });
  }
  return { fuente: "plan", cambioTrasPublicar: false, cambios: null, etiquetaDe: new Map([...etiquetas].map(([id, e]) => [id, e.join("·")])), previas, alFinal: pendientes };
}

/**
 * Una ruta que NADIE ordenó —ninguna de sus órdenes tiene puesto (`route_seq`)— enseña su P/D **provisional** (D-379).
 *
 * Hasta D-379 el Gestor pintaba «—» en toda ella (D-336 lo dejó escrito: «el Gestor ya no pinta etiquetas en ese caso»),
 * aunque `lecturaDeLaRuta` ya la numeraba entera para «Mi ruta». El dueño, viendo un chofer sin optimizar junto a otro
 * con P1·P2, D1, D2: «¿por qué no tiene P1, D1 y así?». Ahora se pinta la misma lectura —el orden en que la tabla enseña
 * las paradas, el que las flechas ↑↓ cambian—, marcada como provisional. Una ruta ordenada A MEDIAS no es provisional:
 * sigue D-336 (las que no tienen puesto no gastan número y enseñan «—»).
 */
export function esProvisional(ordenes: readonly { route_seq?: number | null }[]): boolean {
  return ordenes.length > 0 && ordenes.every((o) => o.route_seq == null);
}

/** Lo que pinta la celda «#» de una parada en la tabla del Gestor. `puesto` es su número en la lista (1 = primera). */
export function etiquetaDeLaParada(
  o: { id: string; route_seq?: number | null }, etiquetaDe: ReadonlyMap<string, string>, puesto: number, provisional: boolean,
): { texto: string; provisional: boolean } {
  if (o.route_seq != null) return { texto: etiquetaDe.get(o.id) ?? String(puesto), provisional: false };
  const e = provisional ? etiquetaDe.get(o.id) : undefined;
  return e ? { texto: e, provisional: true } : { texto: "—", provisional: false };
}

/** La lectura que se pasa a `filasDelViaje`: con la ruta ordenada entera, o con la provisional, salen las filas de
 *  recogida delante de sus entregas —una D nunca antes que su P—; a medias, no (D-336). */
export function lecturaParaLasFilas(lectura: LecturaDeRuta, secuenciada: boolean, provisional: boolean): LecturaDeRuta | null {
  return secuenciada || provisional ? lectura : null;
}

export type FilaDelViaje<T> ={ clase: "informa"; fila: FilaInformativa } | { clase: "orden"; orden: T; indice: number };

/** Las filas de UN viaje en el orden en que se pintan: lo que informa va justo ANTES de la entrega a la que precede —donde el
 *  plan lo puso—, y `alFinal` tras la última entrega del último viaje. Las dos pantallas pintan esto, tal cual. */
export function filasDelViaje<T extends { id: string }>(lectura: LecturaDeRuta | null, viaje: readonly T[], esElUltimoViaje: boolean): FilaDelViaje<T>[] {
  const informa = (fila: FilaInformativa): FilaDelViaje<T> => ({ clase: "informa", fila });
  return [
    ...viaje.flatMap((orden, indice): FilaDelViaje<T>[] => [...(lectura?.previas.get(orden.id) ?? []).map(informa), { clase: "orden", orden, indice }]),
    ...(esElUltimoViaje ? (lectura?.alFinal ?? []).map(informa) : []),
  ];
}
