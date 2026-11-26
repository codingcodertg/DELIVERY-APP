// ============================================================
// Auto-optimizar al asignar (348): QUE hacer con UNA ruta tras una asignacion. Funcion pura: no lee la base ni el
// reloj. El que la llama (la pantalla del Gestor, mas adelante) le pasa lo que ya sabe y ejecuta lo que decide.
//
// Regla de fondo (D-1201): al asignar, lo nuevo se coloca una a una en su mejor lugar (lib/mejor-lugar.ts) y lo que
// ya estaba en la ruta NO se mueve. Reacomodar toda la ruta es solo del boton «Optimizar». (Antes, una ruta sin
// paradas fijadas se reacomodaba entera tras cada asignacion y las filas saltaban mientras se trabajaba.)
// ============================================================

/** Lo que hay que hacer con una ruta tras una asignacion. */
export type PlanAuto =
  | { que: "nada"; motivo: "sin_cambios" | "ruta_vacia" | "bloqueada" }
  | { que: "insertar"; nuevas: string[] /* órdenes a colocar, en el orden de entrada */ };

/** Clave de una ruta y día en `estadoAutoDeRutas` (el proveedor la usa tal cual). */
export const claveDeRutaAuto = (dia: string, lane: string): string => `${dia}|${lane}`;

/**
 * Qué hacer con UNA ruta tras una asignación:
 *  - ruta bloqueada (🔒) → nada;  sin paradas pendientes → nada;
 *  - la huella de ahora == la huella guardada y el estado guardado es "hecha" → nada (no se gasta una consulta de tiempos);
 *  - si no → "insertar": las órdenes del lote (menos las fijadas a mano) se colocan una a una en su mejor lugar, sin
 *    mover lo demás. Nunca reacomoda la ruta entera (D-1201).
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

/** Cuántas ÓRDENES fijadas a mano pisaría «Optimizar» (una orden fijada sale con 📌 en su fila de recogida y en la de entrega), y el texto del aviso (null si ninguna). */
export function avisoDePisar(pendientes: readonly { route_fixed?: boolean | null }[]): { n: number; en: string; es: string } | null {
  const n = pendientes.filter((p) => p.route_fixed === true).length;
  if (n === 0) return null;
  return {
    n,
    en: `Optimize will rearrange the whole route and overwrite ${n} order(s) you placed by hand. Continue?`,
    es: `Optimizar va a reacomodar toda la ruta y pisar ${n} orden(es) que colocaste a mano. ¿Continuar?`,
  };
}

/**
 * Lo que devuelve una auto-optimización de UNA ruta, para que quien la lanza marque la ruta: «hecha» (con su huella, para
 * no repetirla), «fallo» (con la nota; `reintentar` si otro intento puede salir bien: sin tiempos de viaje, o la escritura
 * no pasó), «reprograma» (la ruta cambió mientras se calculaba: se vuelve a pedir) o «nada» (no toca la ruta).
 */
export type ResultadoAuto =
  | { estado: "hecha"; huella: string; nota?: string | null }
  | { estado: "fallo"; nota: string; reintentar: boolean }
  | { estado: "reprograma" }
  | { estado: "nada" };

/** La espera antes del reintento número `intento` (0 = el primero): 5 s, luego 20 s. Después, null: se queda en «fallo». */
export function reintentoAuto(intento: number): number | null {
  if (intento === 0) return 5_000;
  if (intento === 1) return 20_000;
  return null;
}

/** Las reglas que incumple un resultado, sin repetir, para la nota de la ruta (p. ej. «carga_antes_de_descarga, parada_repetida»). */
export function notaDeReglas(violaciones: readonly { clave: string }[]): string {
  return [...new Set(violaciones.map((v) => v.clave))].join(", ");
}

/**
 * Las violaciones de `despues` que NO estaban ya en `antes`. Una violación es la misma si tiene la misma `clave` y las
 * mismas órdenes (sin importar su orden). Así una ruta que ya rompe una regla no bloquea toda optimización: solo cuenta lo
 * que el cambio AÑADE.
 */
export function violacionesNuevas<T extends { clave: string; ordenes?: readonly string[] }>(
  antes: readonly { clave: string; ordenes?: readonly string[] }[],
  despues: readonly T[],
): T[] {
  const firma = (v: { clave: string; ordenes?: readonly string[] }): string => `${v.clave}\u0000${[...(v.ordenes ?? [])].sort().join(",")}`;
  const yaEstaban = new Set(antes.map(firma));
  return despues.filter((v) => !yaEstaban.has(firma(v)));
}

/**
 * ¿Las dos listas tienen las mismas filas en el mismo orden (mismo tipo y las mismas órdenes)? Si sí, escribir la lista no
 * cambia nada: la auto-colocación no escribe ni deja nada en el historial.
 */
export function mismaSecuencia(
  a: readonly { tipo: "P" | "D"; orden?: string; ordenes?: readonly string[] }[],
  b: readonly { tipo: "P" | "D"; orden?: string; ordenes?: readonly string[] }[],
): boolean {
  const firma = (p: { tipo: "P" | "D"; orden?: string; ordenes?: readonly string[] }): string =>
    p.tipo === "D" ? `D:${p.orden ?? ""}` : `P:${(p.ordenes ?? []).join(",")}`;
  return a.length === b.length && a.every((p, i) => firma(p) === firma(b[i]));
}

/**
 * El chip de la tarjeta. «pendiente» se muestra como «⏳ optimizando…» SOLO si esta pestaña la está corriendo ahora. Si
 * quedó guardada como pendiente (la pestaña se cerró, se recargó, o la corrida terminó sin marcarla), se ofrece reintentar.
 */
export function chipAutoEnPantalla(estado: "pendiente" | "hecha" | "fallo" | null | undefined, corriendoAqui: boolean): { en: string; es: string; clase: "calculando" | "fallo" } | null {
  if (estado === "pendiente") return chipAuto(corriendoAqui ? "pendiente" : "fallo");
  return chipAuto(estado);
}
