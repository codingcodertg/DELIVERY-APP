// ============================================================
// «Dejar en tienda»: el chofer descarga un pedido que no pudo entregar y vuelve a la lista (D-NEXT).
//
// El caso real: un chofer lleva el pedido en el camión, no puede entregarlo, y en vez de devolverlo
// a la tienda de origen lo descarga en otra tienda del grupo. Otro chofer lo recoge **desde ahí** y
// lo entrega.
//
// La transición ya era legal antes de esta rama: `LEGAL_TRANSITIONS` tiene
// `picked_up: ["delivered", "ready"]`, comentado como «driver delivers (or reverts if not taken)».
// Lo que faltaba no era el camino, sino la acción: elegir la tienda, cambiar el origen y soltar el
// pedido.
//
// Puro: sin React, sin red. Decide quién puede hacerlo y **qué se escribe**; las dos pantallas que
// lo ofrecen —la ficha y Mi ruta— usan esto, así que el mismo gesto no puede guardar dos cosas
// distintas. Es la misma línea de D-218 con `escrituraRecogida`.
// ============================================================

export interface TiendaDestino {
  name: string;
  address?: string | null;
}

export interface PedidoParaDejar {
  stage?: string | null;
  assigned_driver?: string | null;
  store?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  pickup_gps_at?: string | null;
}

export interface QuienDeja {
  role?: string | null;
  full_name?: string | null;
}

/**
 * ¿Se le ofrece a esta persona, en este pedido?
 *
 * Dos condiciones, y ningún permiso nuevo:
 *
 *  1. El pedido está **en el camión** (`picked_up`). Antes de eso no hay nada que descargar, y
 *     después de entregado no hay nada que devolver.
 *  2. Quien lo pide **ya puede mover esta etapa** — es el mismo `canDeliver` que enseña «Marcar
 *     entregado», y se recibe ya resuelto para no duplicar aquí la tabla de roles. Si además es
 *     chofer, tiene que ser **el suyo**: un chofer no descarga el camión de otro.
 *
 * Un pedido en `picked_up` **sin chofer asignado** sí lo puede dejar cualquiera que pueda mover la
 * etapa (almacén, admin): alguien lo tiene físicamente, y no poder soltarlo lo dejaría atascado.
 */
export function puedeDejarEnTienda(
  pedido: PedidoParaDejar,
  me: QuienDeja | null | undefined,
  puedeMoverEtapa: boolean,
): boolean {
  if (pedido.stage !== "picked_up") return false;
  if (!puedeMoverEtapa) return false;
  if (me?.role !== "driver") return true;
  return !!me.full_name && pedido.assigned_driver === me.full_name;
}

/**
 * Lo que se escribe. El pedido vuelve a `ready` (esa parte la pone `setStage`) y aquí va el resto.
 *
 * **El origen pasa a ser la tienda donde se dejó.** Es lo que hace que «vuelva a la lista» de
 * verdad: quien lo recoja sale de ahí, y las millas y la tarifa que se calculen **a partir de
 * ahora** salen de ahí. Sin esto quedaría un pedido fantasma que sigue diciendo que está en su
 * tienda de origen, y el siguiente chofer conduciría hasta un almacén donde no hay nada.
 *
 * **Cambiar el origen son DOS campos, no uno.** El origen de las millas es una cascada
 * (`OrderModal.tsx:564-565`): `pickup_address` si la hay, si no la dirección guardada de la tienda
 * `store`, y si no su nombre a secas. Así que poner solo `store` dejaría un pedido con
 * `pickup_address` explícita saliendo **del sitio viejo**, en silencio. Por eso `pickup_address` se
 * pone a `null`: la razón por la que alguien escribió esa dirección deja de aplicar en el momento
 * en que el pedido está físicamente en otra tienda. Y con `null`, la dirección la resuelve la
 * cascada desde Ajustes, o sea que sigue habiendo **una sola** copia de la dirección de cada
 * tienda: si la tienda se muda, el pedido la sigue.
 *
 * **`delivery_fee` no se toca**: es lo cotizado y cobrado, y cambiar de sitio el pedido no
 * reescribe un acuerdo. **`route_miles` y `route_duration` sí se borran**, y esa es la decisión
 * con más consecuencias de esta rama. Tres salidas, ninguna gratis:
 *
 *  1. *Recalcular* aquí mismo: gastaría cuota de Google Routes —API de pago— en cada descarga, y
 *     justo ahora se está trabajando en controlar ese gasto.
 *  2. *Dejarlas*: la ficha seguiría enseñando unas millas contadas desde donde el pedido ya no
 *     está. Un número que miente es peor que ninguno.
 *  3. *Borrarlas* (lo elegido): el pedido queda sin millas hasta que alguien pulse «Calcular».
 *     Honesto, y no gasta nada que nadie haya pedido.
 *
 * Consecuencia buscada, no efecto colateral: cuando alguien recalcule, la **tarifa sugerida**
 * saldrá del origen nuevo. Quien recoja en Brownsville no debe cobrar como si saliera de McAllen.
 *
 * **Se limpian los sellos del viaje que no llegó a su fin** —salida, llegada y GPS de la recogida—
 * y esto no es invención: es exactamente lo que ya hace el reparto de una orden parcial en
 * `OrderModal`, que descarta `pickup_lat`, `pickup_lng`, `pickup_gps_at` y `departed_at` al crear
 * el resto como `ready`. Tres razones medidas, además del precedente:
 *
 *  - `departed_at` puesto haría que el segundo chofer viera «En camino desde» una hora que no es
 *    suya y **no** le saliera el botón de «Iniciar viaje» (solo aparece si no hay sello).
 *  - `analytics.ts:283` cuenta el tiempo activo desde `departed_at` hasta la entrega y se lo apunta
 *    a `assigned_driver`, o sea **al segundo chofer**: dejarlo puesto le regalaría el viaje del
 *    primero.
 *  - El GPS de recogida se sobrescribe igualmente en cuanto alguien vuelva a recoger, así que
 *    conservarlo no guardaría ninguna historia; la historia va donde sí dura, en la nota del
 *    registro, que incluye dónde se recogió la primera vez.
 *
 * **Todo lo demás se conserva**: pallets confirmadas, fotos, notas, ventanas, el pin de la entrega
 * y su procedencia. Eso sí es historia del pedido y no del viaje.
 */
export function escrituraDejarEnTienda(input: {
  pedido: PedidoParaDejar;
  tienda: TiendaDestino;
  me: QuienDeja | null | undefined;
  t: (en: string, es: string) => string;
}): { patch: Record<string, unknown>; note: string } {
  const { pedido, tienda, me, t } = input;
  const quien = me?.full_name || pedido.assigned_driver || t("someone", "alguien");
  const desde = pedido.pickup_lat != null && pedido.pickup_lng != null
    ? ` (${t("first pickup at", "primera recogida en")} ${pedido.pickup_lat.toFixed(5)}, ${pedido.pickup_lng.toFixed(5)})`
    : "";
  const cambioDeOrigen = (pedido.store ?? "") !== tienda.name
    ? t(` · origin changed from ${pedido.store || "(none)"}`, ` · origen cambiado desde ${pedido.store || "(ninguna)"}`)
    : "";
  return {
    patch: {
      store: tienda.name,
      // `pickup_name` es lo que lee el chofer; `pickup_address` a `null` para que el origen lo
      // resuelva la cascada desde la tienda. Cambiar uno sin el otro dejaría el pedido diciendo
      // una tienda y llevando a otra — el fallo silencioso que esto evita.
      pickup_name: tienda.name,
      pickup_address: null,
      // Contadas desde donde el pedido ya no está. Se borran en vez de recalcularse (cuota) o
      // dejarse (un número que miente). Ver arriba.
      route_miles: null,
      route_duration: null,
      // Vuelve a estar disponible: sin chofer, como cualquier otro `ready`.
      assigned_driver: null,
      // Los sellos del viaje abandonado. Ver la explicación de arriba.
      departed_at: null,
      arrived_at: null,
      pickup_lat: null,
      pickup_lng: null,
      pickup_gps_at: null,
    },
    note: t(
      `Left at ${tienda.name} by ${quien}${desde}${cambioDeOrigen} — back on the board for another driver`,
      `Dejado en ${tienda.name} por ${quien}${desde}${cambioDeOrigen} — vuelve a la lista para otro chofer`,
    ),
  };
}

/**
 * El tipo de evento. Propio, no una edición: un pedido que cambia de sitio sin rastro se pierde.
 *
 * En inglés y en la misma familia que los que ya existen (`created`, `edited`, `geocode_failed`).
 * `kind` es texto libre en `order_events`, así que no hace falta migración — pero se queda en el
 * historial de esos pedidos **para siempre**, así que el nombre se elige una vez.
 */
export const EVENTO_DEJADO = "dropped_at_store";
