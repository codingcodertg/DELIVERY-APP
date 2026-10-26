import { BUSINESS_TZ } from "@/lib/utils";
/* ---- A qué hora «sale» la medida de una ruta (D-602, 2026-10-19) ----
 * Ernesto (chofer): «Why does ETA say 8 to orders that havent been done yet?». A las 12:40, con 11 paradas hechas, la
 * parada 12 (pendiente) decía 8:23: la medida de la ruta siempre arrancaba de la base a las 08:00 (`DAY_START_MIN`),
 * aunque fueran las doce y el camión llevara horas fuera. Las paradas HECHAS ya no están en la lista que se mide (solo
 * se miden las pendientes), así que la primera pendiente «salía» a las 08:00 más el trayecto desde la base.
 *
 * Regla: la medida de HOY no puede salir antes de la hora que es. Si ya pasaron las 08:00, sale AHORA; si aún no son las
 * 08:00, a las 08:00 como siempre. Otro día (mañana, o uno pasado que se revisa) no tiene «ahora»: las 08:00.
 *
 * Lo que sigue sin ser exacto, y se dice: el camión «sale» de la base, no de donde está (no se usa el GPS), y la hora se
 * fija cuando se mide (al cambiar la lista: cada parada hecha la vuelve a medir), no corre sola con el reloj. */

export const SALIDA_MIN = 8 * 60; // 08:00, la misma `DAY_START_MIN` del Gestor y `SALIDA_POR_DEFECTO_MIN` de optimizar.

/** `fecha` es la del día que se mide (yyyy-mm-dd); `ahora`, el reloj de quien mide (hora local). Minutos desde la medianoche. */
export function salidaDeLaMedida(fecha: string, ahora: Date = new Date(), salidaMin: number = SALIDA_MIN): number {
  const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
  if (fecha !== hoy) return salidaMin;
  const minutosDeAhora = ahora.getHours() * 60 + ahora.getMinutes();
  return Math.max(salidaMin, minutosDeAhora);
}

/* ---- La hora de cada parada cuando parte de la ruta YA está hecha (D-NEXT, 2026-10-26) ----
 * Roberto (admin), ruta de Julio Jijon: «Something is still off with the ETAs». ✓P3 recogida en RDZ Pharr a las 09:37, y aun
 * así «Base: salida 10:31» y P1/P2 (pendientes, en la MISMA tienda) a las 10:31. Causa, en el código: desde D-584 se mide
 * la ruta del DÍA (lo hecho y lo pendiente, en su sitio), pero el reloj recorría todos los puntos desde la base a la hora
 * de `salidaDeLaMedida` (D-602: «ahora» si es hoy) sin mirar que algunos ya estaban hechos: lo hecho se recorría como si
 * aún no, y lo pendiente heredaba una salida de la base a la hora de medir. Además la medida se guarda por forma de la
 * ruta, y hacer una parada no cambia la forma (D-584): las horas no se movían al marcarla.
 *
 * Regla: una parada hecha con hora real ANCLA el reloj en esa hora (y en su sitio: el tramo siguiente sale de ella), y lo
 * pendiente sigue desde ahí con su tramo y su servicio. La salida de la base es la de la PRIMERA parada hecha menos lo que
 * cuesta llegar a ella (tramos y servicios de antes). Sin nada hecho, como D-602. Lo pendiente detrás de la última hecha
 * NO se sube a «ahora»: sigue desde la hora real (lo pidió así el orquestador; si el chofer va tarde, la hora sale pasada).
 * Las paradas enteramente hechas no llevan llegada estimada: la suya es la del plan (D-671) y su hora real. */

/** Minutos del día de una hora real (ISO) en la zona del negocio, solo si cae en `fecha` (yyyy-mm-dd). */
export function minutosReales(iso: string | null | undefined, fecha: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
  if (`${partes.year}-${partes.month}-${partes.day}` !== fecha) return null;
  return Number(partes.hour) * 60 + Number(partes.minute);
}

/** Un punto medido: su clave en `etas`, su servicio, sus órdenes y si es entrega o recogida. */
export interface PuntoDelReloj { id: string; servicio: number; tipo: "P" | "D"; ordenes: readonly string[] }
export interface OrdenDelReloj { id: string; stage?: string | null; pickup_gps_at?: string | null; pod_delivered_at?: string | null }

/** Cuándo se llegó a un punto, si ya se hizo (la primera hora real de sus órdenes hechas), y si está hecho entero. */
export function horaHecha(p: PuntoDelReloj, porId: ReadonlyMap<string, OrdenDelReloj>, fecha: string): { real: number | null; entero: boolean } {
  const horas: number[] = [];
  let hechas = 0;
  for (const id of p.ordenes) {
    const o = porId.get(id);
    const hecha = !!o && (p.tipo === "D" ? o.stage === "delivered" : o.stage === "picked_up" || o.stage === "delivered");
    if (!hecha) continue;
    hechas++;
    const m = minutosReales(p.tipo === "D" ? o!.pod_delivered_at : o!.pickup_gps_at, fecha);
    if (m != null) horas.push(m);
  }
  return { real: horas.length ? Math.min(...horas) : null, entero: p.ordenes.length > 0 && hechas === p.ordenes.length };
}

/** Las horas de la ruta medida: la llegada de cada punto pendiente, la salida de la base y la vuelta. `legs` como los da
 *  el router: con base, el tramo j entra en el punto j y el último es la vuelta; sin base, el tramo j-1 entra en el j. */
export function relojDeLaRuta(e: {
  puntos: readonly PuntoDelReloj[]; legs: readonly number[]; conBase: boolean; vuelve: boolean;
  ordenes: readonly OrdenDelReloj[]; fecha: string; ahora?: Date;
}): { etas: Record<string, string>; salida: number; clock: number; servicio: number } {
  const porId = new Map(e.ordenes.map((o) => [o.id, o]));
  const tramo = (j: number) => (e.conBase || j > 0 ? (e.legs[e.conBase ? j : j - 1] ?? 0) / 60 : 0);
  const hechas = e.puntos.map((p) => horaHecha(p, porId, e.fecha));
  const primera = hechas.findIndex((h) => h.real != null);
  let salida: number;
  if (primera < 0) salida = salidaDeLaMedida(e.fecha, e.ahora);
  else {
    let antes = 0;
    for (let j = 0; j <= primera; j++) antes += tramo(j) + (j < primera ? e.puntos[j].servicio : 0);
    salida = Math.max(0, hechas[primera].real! - antes);
  }
  const etas: Record<string, string> = {};
  let clock = salida;
  let servicio = 0;
  e.puntos.forEach((p, j) => {
    clock += tramo(j);
    const h = hechas[j];
    if (h.real != null) clock = h.real;
    if (!h.entero) etas[p.id] = fmtReloj(clock);
    clock += p.servicio;
    servicio += p.servicio;
  });
  if (e.vuelve) clock += (e.legs[e.puntos.length] ?? 0) / 60;
  return { etas, salida, clock, servicio };
}

function fmtReloj(min: number): string {
  const total = Math.round(min);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
