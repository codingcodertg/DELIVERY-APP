import type { Delivery } from "@/lib/types";

// ============================================================
// Qué pin se guarda con el pedido, y con qué procedencia (D-NEXT).
//
// Cierra el camino que dejó dos pedidos sin coordenadas: el usuario colocaba el pin, lo veía en el
// mapa, guardaba la orden sin pulsar «Save pin» y el punto se perdía, porque el borrador vivía solo
// en el estado de la ficha.
//
// Vive aquí y no dentro del componente porque lo que decide **no es presentación**: son las
// coordenadas y la procedencia que acaban en la base, y esa procedencia enciende el aviso que lee
// el chofer al navegar. Una regla así se prueba de verdad, no contra una copia.
//
// Puro: recibe el estado de la ficha como datos y devuelve qué escribir, o nada.
// ============================================================

/** De dónde salió el punto. Los únicos valores que acepta la base (`005_map_and_deadline_alerts.sql:22`). */
export type PinSource = "manual" | "geocoded";

/** Lo que se escribe en el pedido, o `null` si no hay nada que escribir. */
export type PinParaGuardar = Pick<Delivery, "delivery_lat" | "delivery_lng" | "delivery_pin_source">;

export interface EstadoPin {
  /** El selector de mapa está abierto: solo entonces hay un borrador «vivo» (D-220). */
  selectorAbierto: boolean;
  /** El punto en borrador, o null. */
  borrador: [number, number] | null;
  /** De dónde vino ese borrador. `null` cuando no se sabe: se trata como manual, que es la vía por defecto del selector. */
  fuente: PinSource | null;
  /** El punto que ya lleva el formulario del pedido. */
  pedido: { delivery_lat?: number | null; delivery_lng?: number | null };
}

/**
 * ¿Hay que guardar el borrador con el pedido?
 *
 * Tres condiciones, y cada una tapa una puerta distinta:
 *
 *  1. **Visible.** La misma noción que decide la zona en D-220: un borrador de un selector cerrado
 *     —cancelado, o ya aplicado con «Save pin»— no se escribe.
 *  2. **Distinto del que ya tiene el pedido.** Abrir el selector sincroniza el borrador con el pin
 *     guardado, así que «abrir para mirar» no debe escribir nada; si no, mirar un punto
 *     geocodificado lo reetiquetaría como manual sin que nadie moviera nada.
 *  3. **Con su procedencia real.** `"manual"` si el último gesto fue el clic derecho, `"geocoded"`
 *     si fue el buscador de direcciones. Etiquetar de manual un punto que propuso la búsqueda
 *     encendería el aviso del chofer («sin dirección formal — Navegar usa el pin») justo en el
 *     pedido cuya dirección se acaba de encontrar.
 *
 * **Se guarda también sobre un pin anterior, y es deliberado.** Se probó la regla contraria —no
 * pisar un punto previo con una propuesta del buscador— y producía algo peor: el usuario vería un
 * punto en el mapa y se guardaría otro, el viejo. Que lo que se ve y lo que se guarda sean cosas
 * distintas es el fallo que esto viene a cerrar. Quien solo quería comprobar una dirección, cancela.
 */
export function pinDraftParaGuardar(e: EstadoPin): PinParaGuardar | null {
  if (!e.selectorAbierto || !e.borrador) return null;
  const [lat, lng] = e.borrador;
  if (e.pedido.delivery_lat === lat && e.pedido.delivery_lng === lng) return null;
  return { delivery_lat: lat, delivery_lng: lng, delivery_pin_source: e.fuente ?? "manual" };
}

/**
 * La procedencia que se escribe al aplicar un punto desde el selector («Save pin»).
 *
 * Existe para que ese botón no vuelva a etiquetar de `"manual"` un borrador que puso el buscador,
 * que era la misma mentira por la puerta vieja.
 */
export function fuenteAlAplicar(fuente: PinSource | null): PinSource {
  return fuente ?? "manual";
}
