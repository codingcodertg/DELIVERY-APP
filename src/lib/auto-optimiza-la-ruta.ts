// ============================================================
// Auto-optimizar al asignar (348): QUE hacer con UNA ruta tras una asignacion. Funcion pura: no lee la base ni el
// reloj. El que la llama (la pantalla del Gestor, mas adelante) le pasa lo que ya sabe y ejecuta lo que decide.
//
// Regla de fondo: una parada que una persona coloco a mano (`route_fixed`) no se mueve sola. Si la ruta tiene
// alguna, lo nuevo se coloca una a una en su mejor lugar (lib/mejor-lugar.ts) sin reordenar lo demas; si no tiene
// ninguna, se optimiza toda la ruta con el mismo motor que el boton «Optimizar».
// ============================================================

/** Lo que hay que hacer con una ruta tras una asignacion. */
export type PlanAuto =
  | { que: "nada"; motivo: "sin_cambios" | "ruta_vacia" | "bloqueada" }
  | { que: "insertar"; nuevas: string[] /* órdenes a colocar, en el orden de entrada */ }
  | { que: "optimizar_todo" };

/** Clave de una ruta y día en `estadoAutoDeRutas` (el proveedor la usa tal cual). */
export const claveDeRutaAuto = (dia: string, lane: string): string => `${dia}|${lane}`;

/**
 * Qué hacer con UNA ruta tras una asignación:
 *  - ruta bloqueada (🔒) → nada;  sin paradas pendientes → nada;
 *  - la huella de ahora == la huella guardada y el estado guardado es "hecha" → nada (no se gasta una consulta de tiempos);
 *  - si la ruta tiene alguna parada pendiente con `route_fixed` → "insertar": las órdenes del lote que aún no tienen puesto
 *    (o que acaban de llegar) se colocan una a una en su mejor lugar, sin mover lo demás;
 *  - si no tiene ninguna fijada → "optimizar_todo" (el mismo motor del botón).
 */
export function planAuto(e: {
  bloqueada: boolean;
  pendientes: readonly { id: string; route_fixed?: boolean | null; route_seq: number | null }[];
  delLote: readonly string[];
  huellaAhora: string;
  guardado: { estado: "pendiente" | "hecha" | "fallo"; huella: string | null } | null;
}): PlanAuto {
  if (e.bloqueada) return { que: "nada", motivo: "bloqueada" };
  if (e.pendientes.length === 0) return { que: "nada", motivo: "ruta_vacia" };
  if (e.guardado && e.guardado.estado === "hecha" && e.guardado.huella === e.huellaAhora) {
    return { que: "nada", motivo: "sin_cambios" };
  }

  const fijadas = new Set(e.pendientes.filter((p) => p.route_fixed === true).map((p) => p.id));
  if (fijadas.size === 0) return { que: "optimizar_todo" };

  // Una orden ya fijada a mano no se vuelve a colocar: la decidio una persona.
  const nuevas = [...new Set(e.delLote)].filter((id) => !fijadas.has(id));
  if (nuevas.length === 0) return { que: "nada", motivo: "sin_cambios" };
  return { que: "insertar", nuevas };
}

/** El texto del chip de la tarjeta, o null: "pendiente" → «⏳ optimising…»/«⏳ optimizando…»; "fallo" → «↻ not optimised — retry»/«↻ sin optimizar — reintentar». */
export function chipAuto(estado: "pendiente" | "hecha" | "fallo" | null | undefined): { en: string; es: string; clase: "calculando" | "fallo" } | null {
  if (estado === "pendiente") return { en: "⏳ optimising…", es: "⏳ optimizando…", clase: "calculando" };
  if (estado === "fallo") return { en: "↻ not optimised — retry", es: "↻ sin optimizar — reintentar", clase: "fallo" };
  return null;
}

/** Cuántas paradas fijadas a mano pisaría «Optimizar», y el texto del aviso (null si ninguna). */
export function avisoDePisar(pendientes: readonly { route_fixed?: boolean | null }[]): { n: number; en: string; es: string } | null {
  const n = pendientes.filter((p) => p.route_fixed === true).length;
  if (n === 0) return null;
  return {
    n,
    en: `Optimize will rearrange the whole route and overwrite ${n} stop(s) you placed by hand. Continue?`,
    es: `Optimizar va a reacomodar toda la ruta y pisar ${n} parada(s) que colocaste a mano. ¿Continuar?`,
  };
}
