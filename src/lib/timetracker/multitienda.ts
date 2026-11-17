// ============================================================
// Presencial en VARIAS tiendas (316). Parte pura, sin React ni Supabase, para probarla sola.
//
// El dueño, sobre Francis (gerente que trabaja en McAllen, Pharr, Edinburg…): «pásalo a presencial y
// dale la opción de todas las tiendas para que pueda hacer clock in en cualquier lado». Un presencial
// no tiene proyectos (D-493): su «proyecto» es su tienda y su puesto. Si además trabaja en varias
// tiendas, el «proyecto» pasa a ser la tienda donde está HOY, que elige de un desplegable.
//
// Reglas que aquí viven y que las pantallas llaman (ninguna decide por su cuenta):
//  · Quién ve el desplegable de tiendas en vez de los botones de proyecto: `selectorDeProyecto`.
//  · La tienda del día se recuerda por persona y fecha (si cambia el día, se empieza de cero).
//  · Arrancar exige tienda para quien va en varias; el remoto y el presencial de una sola, no.
//  · Qué campos de lugar lleva la sesión o la solicitud: `camposDeLugar`.
//  · Una solicitud de horas no se bloquea al presencial por falta de proyecto: `validarProyectoEnSolicitud`.
// ============================================================

import { effWorkerType } from "@/lib/timetracker/helpers";
import { necesitaProyecto, type PersonaConTienda } from "@/lib/timetracker/tienda-y-puesto";

/** Lo que hace falta de una persona para decidir esto. Encaja con `Employee`. */
export type PersonaMultiTienda = PersonaConTienda & { multiStore?: boolean | null };

/** Una tienda de `clockin.job_sites`. */
export type TiendaElegible = { id: string; name: string; active?: boolean | null };

/**
 * ¿Va en varias tiendas? Solo el presencial con la casilla puesta. El remoto con la casilla puesta
 * sigue en su cronómetro de proyectos: la casilla no le cambia nada.
 */
export function esMultiTienda(p: PersonaMultiTienda | null | undefined): boolean {
  return !!p && effWorkerType(p) === "inhouse" && p.multiStore === true;
}

/** Qué sale en el sitio del proyecto del cronómetro: el desplegable de tiendas o los proyectos. */
export type SelectorDeProyecto = "tienda" | "proyectos";

export function selectorDeProyecto(p: PersonaMultiTienda | null | undefined): SelectorDeProyecto {
  return esMultiTienda(p) ? "tienda" : "proyectos";
}

/** Las tiendas que se ofrecen: solo las activas, por nombre. Una inactiva no se elige para empezar. */
export function tiendasParaElegir(lista: TiendaElegible[] | null | undefined): TiendaElegible[] {
  return (lista ?? [])
    .filter((t) => t.active !== false)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- La tienda del día --------------------------------------------------------

/** Clave de localStorage: una por persona. Lo que se guarda vale solo para su fecha. */
export function claveTiendaDelDia(uid: string): string {
  return "tt_storeDay_" + uid;
}

/** El valor que se guarda: la fecha (YYYY-MM-DD) y la tienda elegida. */
export function valorTiendaDelDia(fecha: string, storeId: string): string {
  return JSON.stringify({ fecha, storeId });
}

/**
 * La tienda que se recordó HOY. Otro día, o basura en el almacenamiento, es no tener ninguna: no se
 * arrastra la tienda de ayer a la jornada de hoy.
 */
export function tiendaDelDiaDesde(raw: string | null | undefined, hoy: string): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { fecha?: unknown; storeId?: unknown } | null;
    if (v && v.fecha === hoy && typeof v.storeId === "string" && v.storeId) return v.storeId;
  } catch { /* valor corrupto: se trata como si no hubiera */ }
  return null;
}

// --- Arrancar, y los campos de lugar ----------------------------------------

/**
 * Por qué no se puede arrancar en tienda, o null si se puede. Quien va en varias tiendas tiene que
 * elegir una de las activas. Un id que ya no está en la lista (tienda desactivada desde que se eligió)
 * cuenta como no elegida.
 */
export function errorDeInicioEnTienda(
  p: PersonaMultiTienda | null | undefined,
  storeId: string | null | undefined,
  tiendas: TiendaElegible[] | null | undefined,
): "sin_tienda" | null {
  if (!esMultiTienda(p)) return null;
  if (!storeId) return "sin_tienda";
  const elegibles = tiendasParaElegir(tiendas);
  if (elegibles.length > 0 && !elegibles.some((t) => t.id === storeId)) return "sin_tienda";
  return null;
}

/**
 * Los campos de lugar que lleva una sesión o una solicitud.
 *  · Va en varias tiendas: su tienda (`storeId`), sin proyecto ni asignación.
 *  · Cualquier otro caso: sin tienda propia (va a la de fichaje, como siempre), y el proyecto que
 *    haya elegido, si lo hay.
 */
export function camposDeLugar(
  p: PersonaMultiTienda | null | undefined,
  storeId: string | null | undefined,
  asignacion: { id: string; projectId: string } | null | undefined,
): { storeId: string | null; projectId: string | null; assignmentId: string | null } {
  if (esMultiTienda(p)) return { storeId: storeId || null, projectId: null, assignmentId: null };
  return { storeId: null, projectId: asignacion?.projectId ?? null, assignmentId: asignacion?.id ?? null };
}

// --- Solicitudes -------------------------------------------------------------

/**
 * ¿Falta proyecto en una solicitud de horas? Igual que antes para el remoto («Elige un proyecto»).
 * Al presencial en varias tiendas no se le pide nada: la tienda es opcional (sin ella, va a la suya).
 * Al presencial de una sola tienda tampoco: su proyecto es su tienda y su puesto.
 */
export function validarProyectoEnSolicitud(
  p: PersonaMultiTienda | null | undefined,
  assignmentId: string | null | undefined,
): "elige_proyecto" | null {
  if (esMultiTienda(p)) return null;
  if (necesitaProyecto(p) && !assignmentId) return "elige_proyecto";
  return null;
}
