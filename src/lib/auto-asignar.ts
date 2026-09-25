/**
 * «Auto-asignar» del Gestor de Rutas con diálogo (D-NEXT).
 *
 * El dueño, el 2026-09-25: *«cuando le apreto autoasignar se debe abrir un dialog para seleccionar a qué conductores les
 * quiero asignar todas las órdenes, o seleccionar algunas, y que se auto-asignen optimizando la ruta»*.
 *
 * Hasta aquí «✨ Auto-asignar (N)» repartía al instante lo sin chofer del día entre TODOS los choferes disponibles, y
 * optimizar era un botón aparte («Optimizar todas las rutas»). Ahora el botón abre un diálogo que pregunta tres cosas:
 * qué órdenes, a qué choferes y si se optimiza al terminar. Aquí vive lo que el diálogo decide, sin pantalla; la
 * pantalla (`routes/page.tsx` y `components/AutoAsignarDialogo.tsx`) solo lo pinta y le pasa con qué asignar y con qué
 * optimizar.
 */
import type { Delivery } from "@/lib/types";
import { autoAssign, type AutoAssignResult } from "@/lib/dispatch";
import type { OpcionDeConductor } from "@/lib/elige-conductor";

/** Qué órdenes reparte: todas las sin chofer del día, o solo las marcadas en la tabla «Sin asignar». */
export type AlcanceDelReparto = "todas" | "marcadas";

/** Con órdenes marcadas, el diálogo nace en «Solo las marcadas»: si alguien marcó, es que quiere esas. Si no, «Todas». */
export function alcanceInicial(marcadas: number): AlcanceDelReparto {
  return marcadas > 0 ? "marcadas" : "todas";
}

/** Las órdenes que se reparten según el alcance. «Marcadas» sin ninguna marcada no reparte nada. */
export function ordenesDelReparto(alcance: AlcanceDelReparto, delDia: readonly Delivery[], marcadas: readonly Delivery[]): Delivery[] {
  return alcance === "marcadas" ? [...marcadas] : [...delDia];
}

/** Se puede marcar un chofer en el diálogo si ese día está disponible (no de vacaciones, baja ni taller). */
export const seMarca = (o: OpcionDeConductor) => !o.noDisponible;

/**
 * Qué choferes nacen marcados. Con el filtro de chofer de arriba (D-393) en un chofer disponible, **solo ese**: el
 * filtro dice «trabajo con Diego», y repartirle a él es lo que se espera; los demás se añaden con un clic o con
 * «Todos». Sin filtro (o con el filtro en uno no disponible, o en una ruta temporal, que no entra en el reparto),
 * **todos los disponibles**: es lo que hacía «Auto-asignar» hasta hoy. Los no disponibles nunca nacen marcados.
 */
export function choferesIniciales(opciones: readonly OpcionDeConductor[]): Set<string> {
  const delFiltro = opciones.find((o) => o.delFiltro && seMarca(o));
  if (delFiltro) return new Set([delFiltro.clave]);
  return new Set(opciones.filter(seMarca).map((o) => o.clave));
}

/** «Todos»: los disponibles. Los no disponibles salen desactivados y no se marcan. */
export function todosLosChoferes(opciones: readonly OpcionDeConductor[]): Set<string> {
  return new Set(opciones.filter(seMarca).map((o) => o.clave));
}

/** «Asignar y optimizar» se enciende con algún chofer marcado y alguna orden que repartir. */
export function puedeRepartir(choferes: ReadonlySet<string>, ordenes: number): boolean {
  return choferes.size > 0 && ordenes > 0;
}

/** Una ruta que optimizar: el chofer y sus paradas del día, ya con lo que acaba de recibir. */
export interface RutaQueOptimizar { clave: string; paradas: Delivery[] }

/**
 * Reparte y, si se pidió, optimiza. El reparto es el `autoAssign` de siempre (capacidad, ventanas, dos viajes al día),
 * pero **solo entre los choferes marcados**. Después optimiza **solo las rutas de los choferes que recibieron algo**,
 * con sus paradas del día más las nuevas (las de otro día no entran en la ruta de este día).
 *
 * `asigna` y `optimiza` los pone quien llama: la pantalla pasa su `assignTo` y el mismo bucle que usa «Optimizar todas
 * las rutas»; las pruebas pasan un stub y cuentan las llamadas (optimizar llama a la API de rutas de Google, de pago).
 */
export async function repartirYOptimizar(e: {
  ordenes: readonly Delivery[];
  choferes: readonly string[];
  capacidadDe: (chofer: string) => number;
  noDisponibles: ReadonlySet<string>;
  optimizar: boolean;
  /** Las paradas que el chofer ya tiene ese día, antes del reparto. */
  paradasDe: (chofer: string) => readonly Delivery[];
  /** Si la orden es del día que se mira (una marcada con el chip «Todas» puede ser de otro). */
  esDelDia: (d: Delivery) => boolean;
  asigna: (orderId: string, chofer: string) => Promise<unknown>;
  /** Optimiza las rutas y devuelve las que SALIERON bien: una que falla (sin sesión, sin red) no cuenta como optimizada. */
  optimiza: (rutas: RutaQueOptimizar[]) => Promise<string[]>;
}): Promise<{ reparto: AutoAssignResult; pedidas: string[]; optimizadas: string[] }> {
  const reparto = autoAssign([...e.ordenes], [...e.choferes], e.capacidadDe, {
    maxTripsPerDay: 2,
    unavailable: new Set(e.noDisponibles),
  });
  for (const a of reparto.assignments) await e.asigna(a.orderId, a.driver);
  if (!e.optimizar || !reparto.assignments.length) return { reparto, pedidas: [], optimizadas: [] };

  const porId = new Map(e.ordenes.map((d) => [d.id, d]));
  const nuevas = new Map<string, Delivery[]>();
  for (const a of reparto.assignments) {
    const d = porId.get(a.orderId);
    if (!d || !e.esDelDia(d)) continue;
    const lista = nuevas.get(a.driver) ?? [];
    lista.push({ ...d, assigned_driver: a.driver, route_seq: null, load_no: null });
    nuevas.set(a.driver, lista);
  }
  const rutas: RutaQueOptimizar[] = [...nuevas].map(([clave, lista]) => ({ clave, paradas: [...e.paradasDe(clave), ...lista] }));
  const pedidas = rutas.map((r) => r.clave);
  const optimizadas = rutas.length ? await e.optimiza(rutas) : [];
  return { reparto, pedidas, optimizadas };
}

/** Lo que dice el aviso al terminar: cuántas, a cuántos, qué no se colocó (con sus números) y cuántas rutas se optimizaron. */
export function resumenDelReparto(
  r: { reparto: AutoAssignResult; pedidas: readonly string[]; optimizadas: readonly string[] },
  etiqueta: (d: Delivery) => string,
  optimizar: boolean,
): { en: string; es: string } {
  const n = r.reparto.assignments.length;
  const choferes = new Set(r.reparto.assignments.map((a) => a.driver)).size;
  const sueltas = r.reparto.unassigned;
  const lista = sueltas.slice(0, 6).map((d) => `#${etiqueta(d)}`).join(", ") + (sueltas.length > 6 ? ` +${sueltas.length - 6}` : "");
  const enSueltas = sueltas.length ? ` · ${sueltas.length} not placed (no location, no room or window already taken): ${lista}` : "";
  const esSueltas = sueltas.length ? ` · ${sueltas.length} sin colocar (sin ubicación, sin capacidad o con la ventana ya ocupada): ${lista}` : "";
  // Lo que se optimizó de verdad: si alguna falló, se dice cuántas de cuántas, no «optimizadas» a secas.
  const fallaron = r.pedidas.length - r.optimizadas.length;
  const enOpt = !optimizar ? ". Routes not optimized"
    : fallaron > 0 ? ` · ${r.optimizadas.length} of ${r.pedidas.length} route(s) optimized (${fallaron} failed)`
    : ` · ${r.optimizadas.length} route(s) optimized`;
  const esOpt = !optimizar ? ". Rutas sin optimizar"
    : fallaron > 0 ? ` · ${r.optimizadas.length} de ${r.pedidas.length} ruta(s) optimizada(s) (${fallaron} con error)`
    : ` · ${r.optimizadas.length} ruta(s) optimizada(s)`;
  return {
    en: `Auto-assigned ${n} order(s) to ${choferes} driver(s)${enSueltas}${enOpt}.`,
    es: `Auto-asignadas ${n} orden(es) a ${choferes} chofer(es)${esSueltas}${esOpt}.`,
  };
}
