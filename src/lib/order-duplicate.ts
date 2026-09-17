import type { Delivery } from "./types";

/**
 * Duplicar una orden (D-NEXT).
 *
 * El dueño: «duplicar no está funcionando tan bien», sin decir qué. Medido de punta a punta, lo que
 * hacía la copia era perder cuatro cosas que nadie ve hasta que hacen falta:
 *
 *   · **la tarifa** (`delivery_fee`), que en una orden de cliente es obligatoria: la copia nacía «sin
 *     cobrar» (D-147/D-148) y podía enviarse así;
 *   · **el pin exacto** (`delivery_lat/lng` y su procedencia): copiaba la dirección, así que el chofer
 *     acababa en el punto geocodificado y no donde alguien marcó (D-220/D-221);
 *   · **el nombre del destino** (`delivery_name`), que en una Intertienda es la tienda que recibe y
 *     solo se seguía viendo porque el desplegable la deduce de la dirección (D-276);
 *   · **a quién pertenece** (`assigned_sales_rep`): la copia pasaba a ser de quien pulsaba, y al
 *     vendedor le desaparecía de su lista, que solo enseña lo suyo.
 *
 * Lo que **no** se copia, y es a propósito:
 *
 *   · **la factura**, que es única por entrega (ya era así);
 *   · **las notas**, ni las viejas (`delivery_notes`, un campo que el formulario ya no enseña) ni las
 *     de rol (`role_notes`): una copia empieza sin la historia de la otra;
 *   · **todo lo del flujo y del almacén**: etapa, pallets reales, chofer, fotos, firmas, horas, la
 *     división de carga y el enlace de re-entrega. La copia nace `draft`.
 */
export function borradorDuplicado(src: Delivery, hoy: string): Partial<Delivery> {
  return {
    // Qué se vende y a quién
    order_type: src.order_type, store: src.store, account: src.account,
    contact: src.contact, delivery_phone: src.delivery_phone,
    // A quién pertenece: sigue siendo del mismo vendedor, no de quien duplica.
    assigned_sales_rep: src.assigned_sales_rep,
    // Papeles: el PO y el SO se repiten a propósito —suele ser el mismo pedido—, la factura no.
    po2: src.po2, so_num: src.so_num, invoice_num: null, estimate_num: src.estimate_num,
    // Qué se mueve y por cuánto
    est_pallets: src.est_pallets, delivery_fee: src.delivery_fee,
    // De dónde y a dónde, con el punto exacto si lo tenía
    pickup_name: src.pickup_name, pickup_address: src.pickup_address, pickup_duration: src.pickup_duration,
    delivery_name: src.delivery_name, delivery_address: src.delivery_address, delivery_duration: src.delivery_duration,
    delivery_lat: src.delivery_lat, delivery_lng: src.delivery_lng, delivery_pin_source: src.delivery_pin_source,
    route_miles: src.route_miles, route_duration: src.route_duration,
    route_provider: src.route_provider, route_traffic: src.route_traffic,
    // Cuándo: hoy, con la misma ventana
    delivery_date: hoy, delivery_windows: src.delivery_windows,
    stage: "draft",
  };
}
