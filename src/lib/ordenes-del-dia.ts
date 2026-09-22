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
 * La tabla «Sin asignar» del Gestor (D-358): lo del día sin chofer, y ADEMÁS lo atrasado sin chofer, venga del día que
 * venga. El dueño: «en logistic manager el table de unscheduled no me salen las late». Es una excepción consciente a
 * D-331 —el día sigue siendo aparte en el mapa, las rutas y los totales—: una orden vencida sin chofer es trabajo que
 * alguien tiene que asignar, y escondida tras «Verlas» no se asignaba. Sale con su «Atrasada» (D-354) para que se
 * distinga del día. En «todas» y «pendientes» ya estaban; no se repite ninguna.
 */
export function sinAsignarDelGestor<T extends Orden & Pick<Delivery, "assigned_driver" | "order_no">>(
  deliveries: readonly T[], fecha: string, modo: ModoDelGestor, etapas: readonly string[],
): T[] {
  const delDia = ordenesDelDia(deliveries, fecha, modo, etapas).filter((d) => !d.assigned_driver);
  if (modo !== "dia") return delDia.sort((a, b) => a.order_no - b.order_no);
  const ya = new Set(delDia.map((d) => d.id));
  const atrasadas = pendientesDeOtrosDias(deliveries, etapas).atrasadas.filter((d) => !d.assigned_driver && !ya.has(d.id));
  return [...delDia, ...atrasadas].sort((a, b) => a.order_no - b.order_no);
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
