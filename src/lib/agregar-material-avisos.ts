import { assignmentWarnings } from "@/lib/dispatch";
import { ordenDeLaParte } from "@/lib/route-plan/publicar";
import type { Delivery, Settings } from "@/lib/types";

/**
 * Los dos avisos de «Agregar material» (D-342): subir los pallets de una orden ya hecha (D-339) puede
 * desbordar el camión donde va, y puede dejar desfasado un plan de ruta que ya se publicó (D-334, D-335).
 *
 * **Avisan, no bloquean.** Quien sube los pallets es ventas, y el material es del cliente y va a salir
 * igual: lo que hace falta es que el vendedor sepa que tiene que decírselo a logística, no impedirle
 * apuntarlo. Por eso esto devuelve datos y no un permiso.
 *
 * **No se inventa ninguna fuente.** La cuenta de capacidad es `assignmentWarnings` de `lib/dispatch`
 * —la misma del panel del mapa—, y «qué órdenes lleva el plan publicado» sale de las paradas que ya
 * devuelve `GET /api/route-plan?status=published` (`route-plan/usePlanPublicado`).
 */

/** La de fábrica cuando Ajustes no dice nada: el mismo 12 de `routes`, `map`, `my-route` y `summary`. */
export const CAPACIDAD_DE_FABRICA = 12;

/**
 * La capacidad del camión de un chofer, por la misma cadena que el Gestor de Rutas, el mapa y «Mi ruta»:
 * la suya por nombre → la de flota → la de fábrica.
 */
export function capacidadDelChofer(chofer: string, settings: Pick<Settings, "driver_capacity" | "default_truck_capacity">): number {
  return settings.driver_capacity?.[chofer] ?? settings.default_truck_capacity ?? CAPACIDAD_DE_FABRICA;
}

type OrdenDelAviso = Pick<Delivery, "id" | "assigned_driver" | "delivery_date" | "delivery_windows" | "actual_pallets" | "est_pallets" | "load_no">;

export interface AvisosDeAgregarMaterial {
  /** El camión se pasa: lo que ya lleva sin esta orden, lo que llevará esta orden, y el tope. */
  desborda: { chofer: string; usados: number; conEsta: number; capacidad: number } | null;
  /** La orden es una parada de un plan de ruta PUBLICADO: el plan se hizo con los pallets de antes. */
  enPlanPublicado: boolean;
}

const NINGUNO: AvisosDeAgregarMaterial = { desborda: null, enPlanPublicado: false };

/**
 * Qué hay que avisar antes de guardar.
 *
 * **Solo si los pallets SUBEN.** Una factura más no pesa ni ocupa: ni el camión ni el plan se enteran.
 *
 * **El tope es por viaje, no por día.** Un chofer hace varios viajes y la capacidad es la del camión:
 * si la orden ya tiene viaje (`load_no`), se cuenta contra las órdenes de ESE viaje. Sin viaje todavía
 * se cuenta el día entero del chofer, que es lo que hace el panel del mapa al asignar.
 *
 * `paradasPublicadas` es `null` cuando no hay plan publicado para esa fecha **o cuando quien mira no
 * puede leerlo** (la RLS de la 133): las dos cosas dan «sin aviso», y no se distinguen desde aquí.
 */
export function avisosDeAgregarMaterial(args: {
  pedido: OrdenDelAviso;
  /** El TOTAL tecleado, o `null` si no se tocaron los pallets. */
  pallets: number | null;
  todas: readonly Delivery[];
  settings: Pick<Settings, "driver_capacity" | "default_truck_capacity">;
  paradasPublicadas: readonly { order_ref: string }[] | null;
}): AvisosDeAgregarMaterial {
  const { pedido, pallets, todas, settings, paradasPublicadas } = args;
  const sube = pallets != null && Number.isFinite(pallets) && pallets > Number(pedido.est_pallets ?? 0);
  if (!sube) return NINGUNO;

  let desborda: AvisosDeAgregarMaterial["desborda"] = null;
  const chofer = pedido.assigned_driver;
  if (chofer) {
    const delViaje = pedido.load_no == null ? todas : todas.filter((o) => o.load_no === pedido.load_no);
    const aviso = assignmentWarnings({ ...pedido, est_pallets: pallets }, chofer, [...delViaje], capacidadDelChofer(chofer, settings))
      .find((a) => a.kind === "over_capacity");
    if (aviso) desborda = { chofer, usados: aviso.used ?? 0, conEsta: aviso.adding ?? 0, capacidad: aviso.capacity ?? 0 };
  }

  const enPlanPublicado = (paradasPublicadas ?? []).some((p) => ordenDeLaParte(p.order_ref) === pedido.id);
  return { desborda, enPlanPublicado };
}
