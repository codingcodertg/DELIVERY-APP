/**
 * «📅 Pedir para hoy» — la solicitud de asignación (D-NEXT, migración 176).
 *
 * El dueño, 2026-10-15: «vamos a hacer un assign order request para employees y office que van or ejemplo sale una orden
 * para manna pero el driver tiene spacio hoy ellos pueden pedir que sa orden se asgine para hoy hadciendo un reschedue y un
 * assgin request».
 *
 * Ventas, Office (`accounting`) y el gerente PIDEN desde la ficha que una orden pase a otra fecha (por defecto hoy) y,
 * si quieren, con un chofer sugerido. Logística y el admin DECIDEN en el Gestor de Rutas: «Aprobar» reprograma la orden con
 * la función de D-549 (`reprogramarOrden` → `reprogramar_orden`, 173; la 172 la saca de la ruta vieja) y la asigna por el
 * mismo camino que el «Asignar a…» de cada fila del Gestor (`manualAssign`); «Rechazar» pide un motivo. Quien pidió se
 * entera en su campana: los avisos los escribe la base (disparador de la 176), no el navegador.
 *
 * Aquí está la regla, sin pantalla: quién pide, quién decide, qué se puede pedir, qué hace «Aprobar» y qué hacer si la
 * tabla todavía no existe. La base repite cada regla de permiso (176); una prueba compara las dos listas.
 */
import type { Delivery, UserRole } from "./types";

/** Una fila de `public.assign_requests` (176). */
export interface SolicitudDeAsignacion {
  id: string;
  delivery_id: string;
  requested_by: string | null;
  requested_date: string;
  /** La fecha que tenía la orden al pedir (la pone la base). */
  from_date: string | null;
  suggested_driver: string | null;
  note: string | null;
  status: EstadoDeSolicitud;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  /** El chofer al que se asignó al aprobar (null = se aprobó sin chofer: queda en «Sin asignar» de ese día). */
  assigned_driver: string | null;
  created_at: string;
}

export type EstadoDeSolicitud = "open" | "approved" | "rejected" | "canceled";

/** Quién pide. Editable: el dueño dijo «employees y office»; el gerente entra por defecto (lo confirma él). */
export const ROLES_QUE_PIDEN: readonly UserRole[] = ["sales", "accounting", "manager"];

/** Quién decide (aprueba o rechaza). Editable: los que asignan rutas en el Gestor. */
export const ROLES_QUE_DECIDEN: readonly UserRole[] = ["logistics", "admin"];

/** Las etapas en las que una orden se puede pedir: las abiertas (ni recogida, ni entregada, ni anulada, ni rechazada). */
export const ETAPAS_QUE_SE_PIDEN: readonly string[] = ["draft", "pending", "approved", "fulfilling", "ready"];

/**
 * ¿Ve esta persona el botón «📅 Pedir para hoy» en esta orden? Ventas, solo en SU orden (`esSuya` = `esMia`, la misma
 * dueñez de D-544/D-549; la base mira `created_by` y `assigned_sales_rep`). Office y gerente, en cualquiera que vean.
 */
export function puedePedirAsignacion(rol: string | null | undefined, etapa: string | null | undefined, esSuya = false): boolean {
  if (!etapa || !ETAPAS_QUE_SE_PIDEN.includes(etapa)) return false;
  if (!esRolQuePide(rol)) return false;
  if (rol === "sales") return esSuya;
  return true;
}

/** ¿Es de un rol que pide? (la ficha monta el botón solo para estos y para quien decide; la etapa la mira el de arriba). */
export function esRolQuePide(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_QUE_PIDEN as readonly string[]).includes(rol);
}

/** ¿Ve esta persona la bandeja de solicitudes del Gestor, con Aprobar y Rechazar? */
export function puedeDecidirSolicitudes(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_QUE_DECIDEN as readonly string[]).includes(rol);
}

/**
 * ¿Se puede enviar? La fecha es válida, no es un día pasado (el selector no deja elegirlo y la base lo rechaza), y no es la
 * que la orden ya tiene: pedir «para hoy» una orden que ya es de hoy no pide nada.
 */
export function solicitudValida(fecha: string, fechaDeLaOrden: string | null | undefined, hoy: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  if (fecha < hoy) return false;
  if (fechaDeLaOrden && fecha === fechaDeLaOrden.slice(0, 10)) return false;
  return true;
}

/** La fecha que propone el cuadro: hoy. Si la orden ya es de hoy (o de antes), mañana. */
export function fechaPropuestaDeSolicitud(fechaDeLaOrden: string | null | undefined, hoy: string, manana: string): string {
  return fechaDeLaOrden && fechaDeLaOrden.slice(0, 10) === hoy ? manana : hoy;
}

/** La solicitud abierta de una orden (la base permite una sola: índice único parcial de la 176). */
export function abiertaDe(lista: readonly SolicitudDeAsignacion[], deliveryId: string): SolicitudDeAsignacion | null {
  return lista.find((s) => s.delivery_id === deliveryId && s.status === "open") ?? null;
}

/** La más reciente de una orden, abierta o no: la que la ficha enseña («⏳ pedida», «✓ aprobada», «✕ rechazada»). */
export function ultimaDe(lista: readonly SolicitudDeAsignacion[], deliveryId: string): SolicitudDeAsignacion | null {
  let ultima: SolicitudDeAsignacion | null = null;
  for (const s of lista) if (s.delivery_id === deliveryId && (!ultima || s.created_at > ultima.created_at)) ultima = s;
  return ultima;
}

/** Las abiertas, la más vieja primero: se atiende por orden de llegada. */
export function abiertasEnOrden(lista: readonly SolicitudDeAsignacion[]): SolicitudDeAsignacion[] {
  return lista.filter((s) => s.status === "open").sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * ¿La tabla no existe todavía? (la migración se aplica después de fusionar). Entonces el botón no aparece y la bandeja no
 * se pinta: nada revienta. `42P01` = relación inexistente en Postgres; `PGRST205` = PostgREST no la tiene en su caché.
 */
export function tablaAusente(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /could not find the table|relation .*assign_requests.* does not exist/i.test(error.message ?? "");
}

/** Lo mínimo para un motivo de rechazo: tres letras, como la nota de «Reprogramar» (D-500). */
export const MINIMO_MOTIVO = 3;

export function motivoValido(motivo: string): boolean {
  return motivo.trim().replace(/\s+/g, " ").length >= MINIMO_MOTIVO;
}

/**
 * Qué hace «Aprobar» con esta orden, sin hacerlo todavía:
 * - `reprogramar`: la orden no tiene ya esa fecha → pasa por `reprogramarOrden` (D-549). Si alguien ya la movió a esa
 *   fecha entre pedir y aprobar, no se reprograma (la función rechazaría «misma fecha»).
 * - `asignar`: el chofer elegido al aprobar (null = se aprueba sin chofer y queda en «Sin asignar» de ese día).
 * - `error`: por qué no se puede. `cerrada` = la solicitud ya no está abierta; `etapa` = la orden ya salió, se entregó o se
 *   anuló; `sin-orden` = esta persona no la tiene cargada; `fecha-pasada` = el día pedido ya pasó (la función lo rechaza).
 */
export function pasosAlAprobar(args: {
  solicitud: Pick<SolicitudDeAsignacion, "status" | "requested_date">;
  orden: Pick<Delivery, "stage" | "delivery_date"> | null | undefined;
  chofer: string | null | undefined;
  hoy: string;
}): { reprogramar: boolean; asignar: string | null; error: null } | { error: "cerrada" | "etapa" | "sin-orden" | "fecha-pasada" } {
  const { solicitud, orden, chofer, hoy } = args;
  if (solicitud.status !== "open") return { error: "cerrada" };
  if (!orden) return { error: "sin-orden" };
  if (!ETAPAS_QUE_SE_PIDEN.includes(orden.stage)) return { error: "etapa" };
  const reprogramar = (orden.delivery_date ?? "").slice(0, 10) !== solicitud.requested_date;
  if (reprogramar && solicitud.requested_date < hoy) return { error: "fecha-pasada" };
  const elegido = (chofer ?? "").trim();
  return { reprogramar, asignar: elegido || null, error: null };
}

/**
 * La nota de la reprogramación al aprobar (va al historial de la orden por `reprogramar_orden`, que exige tres letras):
 * quién lo pidió y su nota.
 */
export function notaAlAprobar(quienPidio: string, nota: string | null | undefined, lang: "en" | "es"): string {
  const limpia = (nota ?? "").trim().replace(/\s+/g, " ");
  const quien = quienPidio.trim() || (lang === "es" ? "alguien" : "someone");
  const base = lang === "es" ? `Solicitud de asignación de ${quien}` : `Assign request from ${quien}`;
  return limpia ? `${base}: ${limpia}` : base;
}

/** El chofer que el cuadro de «Aprobar» trae elegido: el sugerido, si es uno de los choferes de la lista; si no, ninguno. */
export function choferInicial(sugerido: string | null | undefined, choferes: readonly string[]): string {
  const s = (sugerido ?? "").trim();
  return s && choferes.includes(s) ? s : "";
}

/** Los `kind` de la campana (los escribe el disparador de la 176). */
export const AVISO_SOLICITUD_NUEVA = "assign_request";
export const AVISO_SOLICITUD_APROBADA = "assign_request_approved";
export const AVISO_SOLICITUD_RECHAZADA = "assign_request_rejected";

/**
 * A dónde lleva el aviso al tocarlo. La nueva, a quien decide: a la bandeja del Gestor. Las decididas, a quien pidió: a su
 * orden (la ficha enseña en qué quedó). null = no es de una solicitud: lo decide la campana como siempre.
 */
export function destinoDelAvisoDeSolicitud(kind: string, deliveryId: string | null): string | null {
  if (kind === AVISO_SOLICITUD_NUEVA) return "/routes?solicitudes=1";
  if (kind === AVISO_SOLICITUD_APROBADA || kind === AVISO_SOLICITUD_RECHAZADA) return deliveryId ? `/?order=${deliveryId}` : null;
  return null;
}
