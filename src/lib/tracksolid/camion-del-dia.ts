import { IMEI_VALIDO } from "./servicio";

// ============================================================
// Qué camión lleva cada chofer CADA DÍA (D-NEXT). Sin React, sin red y sin base: solo la regla.
//
// Dos pisos:
//   · el camión HABITUAL de cada chofer — el enlace de Ajustes (`tracksolid_devices.driver_id`, 257);
//   · la excepción de UN día (`truck_day_assignments`, 261), que pone quien planifica las rutas, porque los
//     choferes cambian de camión: «hoy lleva ESTE» o «hoy va sin camión».
//
// La regla dura: UN camión no va con dos choferes el mismo día. Si a Ana se le da el camión que hoy tiene
// Luis, no se guarda sin más: se contesta con el conflicto y se ofrece INTERCAMBIAR (Luis se queda con el
// que tenía Ana, o sin camión si Ana no tenía).
// ============================================================

/** Enlace habitual (257): rastreador → chofer. */
export type CamionHabitual = { imei: string; driver_id: string | null };
/** Una fila de la 261. `imei: null` es «ese día, sin camión», dicho a propósito. */
export type CamionDeUnDia = { driver_id: string; imei: string | null };

/** De dónde sale el camión de un chofer ese día. */
export type OrigenDelCamion = "day" | "usual";
export type CamionResuelto = { imei: string | null; origen: OrigenDelCamion };

/**
 * El camión de cada chofer ese día. Solo salen los choferes de los que hay algo que decir: los que tienen
 * camión, y los que ese día van sin camión a propósito (`imei: null`, `origen: "day"`).
 *
 * Lo del día manda. El habitual vale solo si el chofer no tiene fila ese día Y nadie más se llevó ese camión.
 * Dos rastreadores enlazados al mismo chofer: el habitual es el de IMEI menor (siempre el mismo).
 */
export function camionesDelDia(habituales: readonly CamionHabitual[], delDia: readonly CamionDeUnDia[]): Map<string, CamionResuelto> {
  const out = new Map<string, CamionResuelto>();
  const ocupados = new Set<string>();
  for (const f of delDia) {
    // Dos filas con el mismo camión no deberían existir (índice único de la 261); si llegaran, vale la primera.
    const imei = f.imei && !ocupados.has(f.imei) ? f.imei : null;
    if (imei) ocupados.add(imei);
    if (!out.has(f.driver_id)) out.set(f.driver_id, { imei, origen: "day" });
  }
  for (const h of [...habituales].sort((a, b) => a.imei.localeCompare(b.imei))) {
    if (!h.driver_id || out.has(h.driver_id) || ocupados.has(h.imei)) continue;
    ocupados.add(h.imei);
    out.set(h.driver_id, { imei: h.imei, origen: "usual" });
  }
  return out;
}

/** El camión habitual de un chofer (el de IMEI menor si tiene dos), o `null`. */
export function camionHabitualDe(habituales: readonly CamionHabitual[], driverId: string): string | null {
  return habituales.filter((h) => h.driver_id === driverId).map((h) => h.imei).sort()[0] ?? null;
}

/** Quién lleva ese camión ese día, o `null`. */
export function quienLleva(resueltos: ReadonlyMap<string, CamionResuelto>, imei: string): string | null {
  for (const [driverId, c] of resueltos) if (c.imei === imei) return driverId;
  return null;
}

/** Lo que pide el selector: un camión, «sin camión» (`null`) o «el habitual» (`"usual"`: se borra la excepción). */
export type PeticionDeCamion = { driverId: string; imei: string | null | "usual"; intercambia?: boolean };

/** Un paso de escritura en la 261, en el orden en que hay que darlo. */
export type PasoDeCamion = { op: "pon"; driver_id: string; imei: string | null } | { op: "quita"; driver_id: string };

export type PlanDeCamion =
  | { ok: true; pasos: PasoDeCamion[] }
  /** Ese camión lo lleva otro chofer ese día. `aCambio` es lo que se llevaría el otro si se intercambian. */
  | { ok: false; conflicto: { driverId: string; imei: string; aCambio: string | null } };

/**
 * Los pasos para dejar al chofer con lo pedido, sin que un camión quede nunca con dos choferes — ni siquiera
 * a medio camino: el índice único de la 261 mira cada escritura, así que el intercambio primero SUELTA
 * (el otro queda un instante sin camión) y después reparte. Si algo falla a la mitad, lo peor que queda es
 * un chofer sin camión, nunca un camión con dos.
 */
export function planDeCamion(habituales: readonly CamionHabitual[], delDia: readonly CamionDeUnDia[], p: PeticionDeCamion): PlanDeCamion {
  const ahora = camionesDelDia(habituales, delDia);
  const mio = ahora.get(p.driverId)?.imei ?? null;
  const habitual = camionHabitualDe(habituales, p.driverId);
  // «El habitual», o pedir a mano justo el habitual: es lo mismo que no tener excepción.
  const pedido = p.imei === "usual" ? habitual : p.imei;
  const esElHabitual = p.imei === "usual" || (pedido != null && pedido === habitual);

  if (pedido == null) {
    // Sin camión. Si tampoco tiene habitual, no hace falta fila; si lo tiene, hay que decirlo con una fila.
    return { ok: true, pasos: [p.imei === "usual" || !habitual ? { op: "quita", driver_id: p.driverId } : { op: "pon", driver_id: p.driverId, imei: null }] };
  }
  const otro = quienLleva(ahora, pedido);
  const mia: PasoDeCamion = esElHabitual ? { op: "quita", driver_id: p.driverId } : { op: "pon", driver_id: p.driverId, imei: pedido };
  if (!otro || otro === p.driverId) return { ok: true, pasos: [mia] };
  if (!p.intercambia) return { ok: false, conflicto: { driverId: otro, imei: pedido, aCambio: mio } };

  // Intercambio: el otro suelta, yo tomo el suyo, y el otro toma el que yo tenía (si tenía).
  const pasos: PasoDeCamion[] = [{ op: "pon", driver_id: otro, imei: null }];
  // Mi fila se ESCRIBE aunque sea mi habitual: mientras el otro lo tenga por una fila suya, «quitar» la mía
  // me dejaría sin él. Con el otro ya suelto, mi habitual vuelve solo; la fila explícita no estorba.
  pasos.push({ op: "pon", driver_id: p.driverId, imei: pedido });
  if (mio) {
    const habitualDelOtro = camionHabitualDe(habituales, otro);
    pasos.push(mio === habitualDelOtro ? { op: "quita", driver_id: otro } : { op: "pon", driver_id: otro, imei: mio });
  }
  return { ok: true, pasos };
}

/**
 * Qué camiones salen en el mapa del Gestor (el dueño, 2026-11-06: un camión sin chofer ese día está estacionado y solo
 * estorba). ASIGNADO para el mapa es:
 *   · el que alguien le puso a un chofer ESE día (`origin: "day"`), o
 *   · el habitual de un chofer que ese día TIENE RUTA.
 * Un camión que solo tiene chofer habitual en Ajustes, sin ruta ni asignación ese día, cuenta como SIN ASIGNAR: no se
 * pinta salvo que se encienda «camiones sin asignar (N)», que nace apagado. Todos siguen en el selector y en Ajustes.
 */
export function repartoParaElMapa(
  imeis: readonly string[],
  asignaciones: readonly { driverId: string; driver: string; imei: string | null; origin: OrigenDelCamion }[],
  choferesConRuta: ReadonlySet<string>,
): { asignados: Map<string, { driverId: string; driver: string }>; sinAsignar: string[] } {
  const asignados = new Map<string, { driverId: string; driver: string }>();
  for (const a of asignaciones) {
    if (a.imei && (a.origin === "day" || choferesConRuta.has(a.driverId))) asignados.set(a.imei, { driverId: a.driverId, driver: a.driver });
  }
  return { asignados, sinAsignar: imeis.filter((i) => !asignados.has(i)) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es un día de verdad? («2026-02-31» no). */
export function fechaValida(texto: unknown): texto is string {
  if (typeof texto !== "string" || !FECHA.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

/** Lo que llega del selector, validado. `error` en inglés: se le enseña tal cual a quien lo pulsó. */
export function peticionValida(cuerpo: unknown): { ok: true; fecha: string; peticion: PeticionDeCamion } | { ok: false; error: string } {
  const c = (cuerpo ?? {}) as Record<string, unknown>;
  if (!fechaValida(c.date)) return { ok: false, error: "Invalid date." };
  if (typeof c.driver_id !== "string" || !UUID.test(c.driver_id)) return { ok: false, error: "Invalid driver." };
  const imei = c.imei === "usual" ? "usual" : c.imei == null || c.imei === "" ? null : c.imei;
  if (imei !== null && imei !== "usual" && (typeof imei !== "string" || !IMEI_VALIDO.test(imei.trim()))) return { ok: false, error: "Invalid truck." };
  return { ok: true, fecha: c.date, peticion: { driverId: c.driver_id, imei: typeof imei === "string" && imei !== "usual" ? imei.trim() : (imei as null | "usual"), intercambia: c.swap === true } };
}

/**
 * ¿Puede leer dónde está el chofer? La MISMA lista que la política de `driver_locations` (043 + 121): admin,
 * logística, gerencia y almacén ven a todos; el chofer, solo lo suyo. La posición del camión de un chofer es
 * dónde está el chofer, así que se abre a los mismos y a nadie más.
 */
export function puedeVerPosicionDeChoferes(rol: string | null | undefined): boolean {
  return rol === "admin" || rol === "logistics" || rol === "manager" || rol === "warehouse";
}
