import { instanteReal, ordenConHechasPrimero } from "@/lib/hechas-del-gestor";
import type { FilaDeLaRuta } from "@/lib/route-plan/lectura-de-ruta";

/**
 * «Mi ruta» en dos secciones (D-520). El dueño, 2026-10-11: *«delivered orders go to do DELIVERED DROPDOWN TO SEE ALL THE
 * DONE ORDERS BY DEFAULT WILL BE CLOSE AND THE PENDIGN ORDERS AS WELL BU TPENDING ON THE DRIVER VIEW»*.
 *
 * - **Pendientes**: lo que falta, abierta. **Entregadas / Delivered**: lo ya hecho, plegada. Las dos se pliegan.
 * - Qué está hecho lo dice la etapa, sin otra regla: una entrega, entregada; una recogida, cuando TODAS sus cargas ya van en
 *   el camión (o se entregaron). Una recogida a medias sigue pendiente —le falta algo— y enseña ✓ en la carga hecha.
 * - Las filas no se reordenan ni se renumeran: cada una sale en su sección **en el orden de la ruta** y con **su número de
 *   parada** de D-515 (`paradasDeLaRuta`). Si una parada queda partida entre las dos (dos entregas en la misma dirección,
 *   una hecha), su número sale en las dos: la primera fila de la parada DENTRO de cada sección lo lleva, y las demás, la
 *   raya de que sigue. Sin eso, la mitad pendiente se quedaría con una raya y sin número.
 *
 * Puro: sin React.
 */

export type SeccionDeMiRuta = "pendientes" | "hechas";

/** Etapas con las que una recogida ya está hecha: la carga va en el camión, o ya se entregó. */
const RECOGIDA_HECHA = new Set(["picked_up", "delivered"]);

/** ¿Está hecha la fila? Una orden que no se encuentra no se da por hecha: mejor a la vista que escondida. */
export function filaHecha(f: FilaDeLaRuta, etapaDe: (id: string) => string | null | undefined): boolean {
  if (f.tipo === "D") return etapaDe(f.orden) === "delivered";
  return f.ordenes.length > 0 && f.ordenes.every((id) => RECOGIDA_HECHA.has(etapaDe(id) ?? ""));
}

/**
 * El orden en que «Mi ruta» lee sus filas: lo HECHO primero, en el orden en que pasó (su hora real), y lo pendiente en su orden
 * de siempre. Es el mismo que el del Gestor (`ordenConHechasPrimero`), para que el número de cada parada sea el mismo en las dos.
 * Devuelve índices de `filas`.
 */
export function ordenDelDiaDeMiRuta(
  filas: readonly FilaDeLaRuta[],
  etapaDe: (id: string) => string | null | undefined,
  ordenes: ReadonlyMap<string, { pickup_gps_at?: string | null; pod_delivered_at?: string | null }>,
): number[] {
  return ordenConHechasPrimero(
    filas.map((f) => ({ hecha: filaHecha(f, etapaDe), tipo: f.tipo, ordenes: f.tipo === "P" ? f.ordenes : [f.orden] })),
    (orden, tipo) => instanteReal(ordenes.get(orden), tipo),
  );
}

export interface SeccionesDeMiRuta {
  /** Índices de `filas`, en el orden de la ruta. */
  pendientes: number[];
  hechas: number[];
  /** ¿La fila lleva el número? La primera de su parada dentro de SU sección; las demás llevan la raya de que sigue. */
  conNumero: boolean[];
  /** Cuántas paradas (números distintos) hay en cada sección: el «(N)» de su título. */
  paradas: Record<SeccionDeMiRuta, number>;
}

/** Reparte las filas en las dos secciones. `deFila`: el número de parada de cada fila (`paradasDeLaRuta(...).deFila`).
 *  `orden` (opcional: las hechas primero, en orden real, `ordenConHechasPrimero`): los índices de `filas` en el orden en que se leen; por defecto, el
 *  de la ruta. Las secciones salen en ese orden, y la primera fila de cada parada dentro de su sección es la que lleva el número. */
export function seccionesDeMiRuta(
  filas: readonly FilaDeLaRuta[],
  etapaDe: (id: string) => string | null | undefined,
  deFila: readonly number[],
  orden: readonly number[] = filas.map((_, i) => i),
): SeccionesDeMiRuta {
  const pendientes: number[] = [];
  const hechas: number[] = [];
  const conNumero: boolean[] = filas.map(() => false);
  const vistas: Record<SeccionDeMiRuta, Set<number>> = { pendientes: new Set(), hechas: new Set() };
  orden.forEach((i) => {
    const f = filas[i];
    const seccion: SeccionDeMiRuta = filaHecha(f, etapaDe) ? "hechas" : "pendientes";
    (seccion === "hechas" ? hechas : pendientes).push(i);
    const n = deFila[i];
    if (!vistas[seccion].has(n)) { vistas[seccion].add(n); conNumero[i] = true; }
  });
  return { pendientes, hechas, conNumero, paradas: { pendientes: vistas.pendientes.size, hechas: vistas.hechas.size } };
}
