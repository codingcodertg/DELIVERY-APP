import { hechasQueSePintan } from "@/lib/hechas-del-gestor";
import { CHIPS_SIN_ASIGNAR, coincideConLaBusqueda, ordenesDelDia, pendientesDeOtrosDias, type ChipSinAsignar, type ModoDelGestor, type OrdenDelPool } from "@/lib/ordenes-del-dia";
import { TODOS_LOS_CHOFERES, pasaElFiltroDeChofer } from "@/lib/vista-del-gestor";
import { pasaElFiltro } from "@/lib/gestor/filtro-de-choferes";

/**
 * La pestaña «Todas (N)» del Gestor de Rutas (D-462): TODAS las órdenes del día elegido, con chofer o sin él, en una
 * sola tabla. El dueño, 2026-10-02: «agrega el tab donde se mire la lista de todas las ordenes para ese dia asignanada o
 * no que ahi esten». Hasta aquí lo del día estaba repartido: lo sin chofer en «Sin asignar», lo de cada chofer en su
 * tarjeta de «Rutas», y para ver el día entero en una lista no había dónde.
 *
 * Qué entra, con el chip «Este día» (el defecto): lo PENDIENTE del día (`ordenesDelDia`, las mismas etapas que rutea el
 * Gestor), tenga chofer o no, MÁS lo ya recogido o entregado ese día (`hechasQueSePintan`, la misma regla con que la
 * tarjeta del chofer lo pinta desde D-459: lo hecho no desaparece). Los otros chips son los de «Sin asignar» (D-393),
 * sin la condición «sin chofer»: «Todas las fechas» es lo pendiente de cualquier día; «Expiradas», lo vencido de cualquier
 * día; «Con ventana» y «Sin ubicación», lo del día que cumple eso. Lo hecho solo entra en los chips del DÍA: viendo
 * cualquier fecha, lo entregado sería toda la historia (D-459 lo decidió igual para la tarjeta).
 *
 * El FILTRO DE CHOFER de la barra (D-393) también manda aquí, y de esta forma: con un chofer elegido salen LAS SUYAS y
 * LAS SIN ASIGNAR. Las sin asignar no son de nadie: son justo lo que la persona que filtró por ese chofer está decidiendo
 * si darle (el recuadro «Elige conductor» ya lo propone a él el primero, D-395), y «Sin asignar» tampoco las esconde con
 * el filtro puesto. Esconderlas dejaría la pestaña diciendo «todas» y enseñando media jornada.
 *
 * El número de la pestaña y el de cada chip SALEN de la misma función que lista las filas (patrón de D-380/D-384/D-393):
 * contar por un lado y listar por otro es el fallo que ya pasó dos veces.
 */

/** Lo que una fila de «Todas» necesita de la orden: lo de «Sin asignar» y lo que distingue una ya hecha (`hechasQueSePintan`). */
export type OrdenDeTodas = OrdenDelPool & { route_seq?: number | null };

/** El filtro de chofer: UN chofer (el desplegable de D-393, "" = todos) o, desde D-481, los MARCADOS en el panel (vacío = todos). */
export type FiltroDeChofer = string | ReadonlySet<string>;

/** ¿Entra esta orden en «Todas» con este filtro de chofer? Las de ESE chofer (o de esos), y las que no tienen ninguno. */
export const entraEnTodas = (filtro: FiltroDeChofer, chofer: string | null | undefined): boolean =>
  !chofer || (typeof filtro === "string" ? pasaElFiltroDeChofer(filtro, chofer) : pasaElFiltro(filtro, chofer));

/** Las filas que enseña un chip de «Todas», antes de los filtros por columna (D-360), por número de orden como «Sin asignar». */
export function filasDeTodas<T extends OrdenDeTodas>(
  deliveries: readonly T[], fecha: string, modo: ModoDelGestor, etapas: readonly string[], chip: ChipSinAsignar, busqueda = "", filtro: FiltroDeChofer = TODOS_LOS_CHOFERES,
): T[] {
  const deOtrosDias = chip === "overdue" || chip === "todas";
  const pendientes: T[] = chip === "overdue" ? pendientesDeOtrosDias(deliveries, etapas).atrasadas
    : chip === "todas" ? ordenesDelDia(deliveries, fecha, "todas", etapas)
    : ordenesDelDia(deliveries, fecha, modo, etapas);
  // Lo ya hecho ese día, solo en los chips del día: la misma regla con que la tarjeta del chofer lo pinta (D-459).
  const hechas: T[] = deOtrosDias ? [] : [...hechasQueSePintan(deliveries, fecha, modo).values()].flat();
  return [...pendientes, ...hechas]
    .filter((d) => entraEnTodas(filtro, d.assigned_driver))
    .filter((d) => (chip !== "windowed" || !!d.delivery_windows) && (chip !== "noloc" || d.delivery_lat == null) && coincideConLaBusqueda(d, busqueda))
    .sort((a, b) => a.order_no - b.order_no);
}

/** Lo que cuenta la pestaña «Todas (N)»: las filas de «Este día» sin búsqueda, con el filtro de chofer. */
export function todasDelGestor<T extends OrdenDeTodas>(deliveries: readonly T[], fecha: string, modo: ModoDelGestor, etapas: readonly string[], filtro: FiltroDeChofer = TODOS_LOS_CHOFERES): T[] {
  return filasDeTodas(deliveries, fecha, modo, etapas, "dia", "", filtro);
}

/** El número de cada chip de «Todas»: el largo de SUS filas, con la misma búsqueda y el mismo filtro. Nunca otra cuenta. */
export function cuentasDeTodas<T extends OrdenDeTodas>(
  deliveries: readonly T[], fecha: string, modo: ModoDelGestor, etapas: readonly string[], busqueda = "", filtro: FiltroDeChofer = TODOS_LOS_CHOFERES,
): Record<ChipSinAsignar, number> {
  const r = {} as Record<ChipSinAsignar, number>;
  for (const chip of CHIPS_SIN_ASIGNAR) r[chip] = filasDeTodas(deliveries, fecha, modo, etapas, chip, busqueda, filtro).length;
  return r;
}
