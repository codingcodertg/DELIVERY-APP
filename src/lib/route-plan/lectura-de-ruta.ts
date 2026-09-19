import { ordenesDeRuta, secuenciaPD } from "@/lib/secuencia-pd";
import { ordenDeLaParte, posicionesDeLaRuta } from "./publicar";

/**
 * Qué etiquetas P/D lleva una ruta cuando HAY un plan publicado (D-NEXT).
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
  /** La etiqueta de entrega de cada orden. Una orden repartida en cargas lleva todas: «D3·D5». */
  etiquetaDe: Map<string, string>;
  /** Lo que pasa ANTES de la entrega de cada orden, desde la entrega anterior. */
  previas: Map<string, FilaInformativa[]>;
  /** Lo que el plan deja tras la última entrega de la lista (la segunda carga de una orden repartida, por ejemplo). */
  alFinal: FilaInformativa[];
}

/** ¿La ruta de hoy es exactamente la que el plan publicó? Mismas órdenes, mismo viaje, mismo puesto. */
export function sigueElPlan(paradas: readonly ParadaDelPlanMinima[], asignadas: readonly OrdenAsignada[]): boolean {
  const delPlan = posicionesDeLaRuta(enOrden(paradas).map((p) => ({ tipo: p.kind, orden: p.order_ref, cargaAlSalir: Number(p.load_after) })));
  if (delPlan.length === 0 || delPlan.length !== asignadas.length) return false;
  const hoy = new Map(asignadas.map((o) => [o.id, o]));
  return delPlan.every((p) => { const o = hoy.get(p.id); return !!o && Number(o.load_no ?? 1) === p.load_no && o.route_seq === p.route_seq; });
}

const enOrden = (paradas: readonly ParadaDelPlanMinima[]) => [...paradas].sort((a, b) => a.seq - b.seq);

/** `viajes`: los viajes del chofer tal como los pinta la pantalla. `paradas`: las suyas en el plan publicado, o `null`. */
export function lecturaDeLaRuta(viajes: readonly (readonly OrdenAsignada[])[], paradas: readonly ParadaDelPlanMinima[] | null): LecturaDeRuta {
  const asignadas = viajes.flat();
  const hayPlan = !!paradas && paradas.length > 0;
  if (hayPlan && sigueElPlan(paradas!, asignadas)) return delPlan(enOrden(paradas!), asignadas);

  const pd = secuenciaPD(viajes.map(ordenesDeRuta));
  const etiquetaDe = new Map<string, string>(), previas = new Map<string, FilaInformativa[]>();
  let pendientes: FilaInformativa[] = [];
  for (const p of pd) {
    if (p.tipo === "P") pendientes.push({ tipo: "P", etiquetas: p.etiquetas, ordenes: p.ordenes, lugar: p.tienda, aBordo: p.aBordo, sinConteo: p.sinConteo });
    else { etiquetaDe.set(p.ordenes[0], p.etiquetas[0]); previas.set(p.ordenes[0], pendientes); pendientes = []; }
  }
  return { fuente: "derivada", cambioTrasPublicar: hayPlan, etiquetaDe, previas, alFinal: [] };
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
  return { fuente: "plan", cambioTrasPublicar: false, etiquetaDe: new Map([...etiquetas].map(([id, e]) => [id, e.join("·")])), previas, alFinal: pendientes };
}
