// ============================================================
// «Regresar a tienda» (migración 311): el despachador le ordena al chofer dejar en su tienda una orden que YA VA EN EL
// CAMIÓN (`picked_up`). Antes, la ✕ de Rutas la desasignaba: la orden quedaba recogida y sin chofer, y no salía en
// ninguna lista.
//
// Puro: sin React, sin red. Decide qué botón sale en Rutas y **qué se escribe**; Rutas y la pantalla del chofer usan
// esto, así que el mismo gesto no puede guardar dos cosas distintas.
//
// El flujo: 1) el despachador pide el regreso (la orden sigue con el mismo chofer, con la marca puesta);
// 2) el chofer la deja en la tienda → vuelve a `ready`, sin chofer, sin puesto ni carga: a «Sin asignar», de donde la
// reasigna el despachador. Dejarla NO cuenta como entregada.
// ============================================================
import type { Delivery } from "./types";
import { estaEnElCamion } from "./mover-parada";

/** Lo que este módulo mira de una orden. Las dos columnas pueden faltar (la 311 sin aplicar): entonces no hay solicitud. */
export interface PedidoDeRegreso {
  stage?: string | null;
  return_to_store_at?: string | null;
  return_to_store_by?: string | null;
}

/** ¿Hay una solicitud de regreso pendiente? Sin la columna (`undefined`) o nula, no. */
export function regresoPendiente(pedido: PedidoDeRegreso): boolean {
  return !!pedido.return_to_store_at;
}

/**
 * Qué botón sale en la parada de Rutas:
 *  - `quitar`: la ✕ de siempre. Solo para lo que aún no se recogió.
 *  - `pedir-regreso`: en el camión y sin solicitud. El botón «↩ Regresar a tienda».
 *  - `cancelar-regreso`: en el camión con la solicitud pendiente. La insignia y «Cancelar regreso».
 * En el camión la ✕ NUNCA desasigna: una orden recogida sin chofer se pierde de todas las listas.
 */
export type AccionDeRegreso = "quitar" | "pedir-regreso" | "cancelar-regreso";

export function accionDeLaParadaEnRutas(pedido: PedidoDeRegreso): AccionDeRegreso {
  if (!estaEnElCamion(pedido.stage)) return "quitar";
  return regresoPendiente(pedido) ? "cancelar-regreso" : "pedir-regreso";
}

/** Lo que se escribe al pedir el regreso. El chofer no cambia: la orden sigue con él hasta que la deje. */
export function patchPedirRegreso(quienPide: string | null, cuandoIso: string): Partial<Delivery> {
  return { return_to_store_at: cuandoIso, return_to_store_by: quienPide };
}

/** Lo que se escribe al cancelar la solicitud: la orden se queda con el chofer, como estaba. */
export function patchCancelarRegreso(): Partial<Delivery> {
  return { return_to_store_at: null, return_to_store_by: null };
}

/**
 * Lo que se escribe cuando el chofer la deja en la tienda. La etapa (`ready`) la pone `setStage`, no este patch: así la
 * transición pasa por la misma comprobación que las demás. Aquí van el desasignado y la solicitud borrada.
 * No es una entrega: no lleva fecha de entrega ni firma.
 */
export function patchDejadaEnTienda(): Partial<Delivery> {
  // Los sellos del viaje abandonado se borran, como en «Dejar en tienda» (leave-at-store.ts): si no, el tiempo del
  // primer chofer se le cuenta al siguiente.
  return {
    assigned_driver: null, route_seq: null, load_no: null, return_to_store_at: null, return_to_store_by: null,
    departed_at: null, arrived_at: null, pickup_lat: null, pickup_lng: null, pickup_gps_at: null,
  };
}

/** La nota del historial, para el despachador y para el chofer. */
export const NOTA_PEDIR_REGRESO = "Return to store requested by dispatcher";
export const NOTA_CANCELAR_REGRESO = "Return to store request cancelled by dispatcher";
export const notaDejadaEnTienda = (chofer: string): string => `Left at store by ${chofer}`;

/** El banner del chofer: solo si la orden va en el camión Y tiene la solicitud. */
export function bannerDeRegreso(pedido: PedidoDeRegreso): boolean {
  return estaEnElCamion(pedido.stage) && regresoPendiente(pedido);
}
