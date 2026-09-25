import type { Delivery } from "@/lib/types";
import { isOverdue } from "@/lib/utils";

/**
 * Qué órdenes ve el Gestor de Rutas: **cada día es aparte** (D-331).
 *
 * Hasta aquí, viendo HOY la lista arrastraba también lo atrasado y lo que no tenía fecha, mezclado con lo del día
 * —en la tabla, en los totales, en las rutas y en el mapa—. El dueño lo rechazó: «estoy en el 19 y aún veo órdenes
 * del día anterior, recuerda que cada día es aparte». Ahora el día es SOLO su fecha. Lo atrasado y lo sin fecha no se
 * pierde de vista: se cuenta aparte y se ve aparte (`pendientes`), nunca dentro de un día que no es el suyo.
 */

export type ModoDelGestor = "dia" | "todas" | "pendientes";

type Orden = Pick<Delivery, "id" | "stage" | "delivery_date">;

/** Lo atrasado (su día ya pasó y no se entregó ni se anuló) y lo que no tiene fecha, de las etapas que se rutean. */
export function pendientesDeOtrosDias<T extends Orden>(deliveries: readonly T[], etapas: readonly string[]): { atrasadas: T[]; sinFecha: T[] } {
  const enEtapa = deliveries.filter((d) => etapas.includes(d.stage));
  return { atrasadas: enEtapa.filter((d) => isOverdue(d as unknown as Delivery)), sinFecha: enEtapa.filter((d) => !d.delivery_date) };
}

export function ordenesDelDia<T extends Orden>(deliveries: readonly T[], fecha: string, modo: ModoDelGestor, etapas: readonly string[]): T[] {
  if (modo === "pendientes") { const p = pendientesDeOtrosDias(deliveries, etapas); return [...p.atrasadas, ...p.sinFecha]; }
  return deliveries.filter((d) => etapas.includes(d.stage) && (modo === "todas" || d.delivery_date === fecha));
}

/**
 * La tabla «Sin asignar» del Gestor (D-358, corregida por D-359): lo del día sin chofer, como manda D-331. Y con el
 * chip «Atrasadas» pulsado, las vencidas sin chofer **de cualquier día**: ese chip filtraba solo lo del día, y como
 * lo del día no está vencido, salía vacío. El dueño: «para eso tienes filtros: hoy, todas y atrasadas». D-358 las
 * había metido en el defecto; no: el defecto es el día, y «Atrasadas» es el chip.
 */
export function sinAsignarDelGestor<T extends Orden & Pick<Delivery, "assigned_driver" | "order_no">>(
  deliveries: readonly T[], fecha: string, modo: ModoDelGestor, etapas: readonly string[], soloAtrasadas = false,
): T[] {
  const sinChofer = (xs: readonly T[]) => xs.filter((d) => !d.assigned_driver).sort((a, b) => a.order_no - b.order_no);
  if (soloAtrasadas) return sinChofer(pendientesDeOtrosDias(deliveries, etapas).atrasadas);
  return sinChofer(ordenesDelDia(deliveries, fecha, modo, etapas));
}

/**
 * Lo mismo para «Mi ruta» del chofer: HOY son sus paradas de hoy. Lo suyo atrasado —«a slipped stop is still theirs to
 * finish», decía el código, y sigue siendo verdad— no se esconde: se cuenta y se ve APARTE, a un toque. Se separa porque
 * quien despacha ya no lo ve dentro de hoy, y al chofer no puede salirle dentro de su día una orden que el Gestor no
 * enseña ahí; y porque una parada de ayer metida en la secuencia de hoy no es la ruta que se le planificó.
 */
export function paradasDelChofer<T extends Orden & Pick<Delivery, "assigned_driver">>(deliveries: readonly T[], chofer: string, hoy: string, modo: "dia" | "atrasadas"): T[] {
  const suyas = deliveries.filter((d) => d.assigned_driver === chofer && d.stage !== "canceled" && d.stage !== "rejected");
  return modo === "atrasadas" ? suyas.filter((d) => isOverdue(d as unknown as Delivery)) : suyas.filter((d) => d.delivery_date === hoy);
}

/**
 * Los chips de «Sin asignar» (D-393). El dueño, el 2026-09-25: *«UNASSIGNED ALL also button in routes manager for that
 * day»*. Hasta aquí el chip «Todas» enseñaba lo del DÍA —era «todas las de este día», no «todas»—, y lo sin chofer de
 * otro día solo salía por «Atrasadas» (lo vencido) o saliendo del día con «🗓 Todas» arriba, que cambia TODA la pantalla.
 * Ahora hay dos: **«Este día»** (el defecto de D-331/D-359, que era el antiguo «Todas») y **«Todas»**, que enseña lo sin
 * chofer de cualquier día —pasado, futuro o sin fecha— sin mover el día del resto de la pantalla.
 *
 * El número de cada chip SALE de la misma función que pinta sus filas (`filasSinAsignar`), como en Órdenes (D-380/D-384):
 * contar por un lado y listar por otro es el fallo que ya pasó dos veces. La búsqueda entra en los dos.
 */
export const CHIPS_SIN_ASIGNAR = ["dia", "todas", "overdue", "windowed", "noloc"] as const;
export type ChipSinAsignar = typeof CHIPS_SIN_ASIGNAR[number];

type OrdenDelPool = Orden & Pick<Delivery, "assigned_driver" | "order_no" | "delivery_windows" | "delivery_lat" | "account" | "delivery_address" | "delivery_phone" | "contact" | "store">;

/** La búsqueda de «Sin asignar»: número, cuenta, dirección, teléfono, contacto o tienda. Vacía, deja pasar todo. */
export function coincideConLaBusqueda(d: OrdenDelPool, busqueda: string): boolean {
  const q = busqueda.trim().toLowerCase();
  if (!q) return true;
  return String(d.order_no).includes(q) || [d.account, d.delivery_address, d.delivery_phone, d.contact, d.store].some((v) => (v || "").toLowerCase().includes(q));
}

/** Las filas que enseña un chip de «Sin asignar», antes de los filtros por columna (que dicen lo suyo en su barra, D-360). */
export function filasSinAsignar<T extends OrdenDelPool>(
  deliveries: readonly T[], fecha: string, modo: ModoDelGestor, etapas: readonly string[], chip: ChipSinAsignar, busqueda = "",
): T[] {
  const base = chip === "overdue" ? sinAsignarDelGestor(deliveries, fecha, modo, etapas, true)
    : chip === "todas" ? sinAsignarDelGestor(deliveries, fecha, "todas", etapas)
    : sinAsignarDelGestor(deliveries, fecha, modo, etapas);
  return base.filter((d) => {
    if (chip === "windowed" && !d.delivery_windows) return false;
    if (chip === "noloc" && d.delivery_lat != null) return false;
    return coincideConLaBusqueda(d, busqueda);
  });
}

/** El número de cada chip: el largo de SUS filas, con la misma búsqueda. Nunca otra cuenta. */
export function cuentasSinAsignar<T extends OrdenDelPool>(
  deliveries: readonly T[], fecha: string, modo: ModoDelGestor, etapas: readonly string[], busqueda = "",
): Record<ChipSinAsignar, number> {
  const r = {} as Record<ChipSinAsignar, number>;
  for (const chip of CHIPS_SIN_ASIGNAR) r[chip] = filasSinAsignar(deliveries, fecha, modo, etapas, chip, busqueda).length;
  return r;
}
