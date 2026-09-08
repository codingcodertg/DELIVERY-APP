// ============================================================
// «¿Este botón puede cerrar la parada de un toque?» (D-218)
//
// El botón verde de «Siguiente parada» en Mi ruta decía «Recoger» / «Entregar» y lo único que
// hacía era abrir la ficha: la etiqueta prometía una etapa y había que volver a pulsar dentro.
// Al arreglarlo aparece el riesgo de siempre —dos pantallas decidiendo lo mismo por su cuenta—,
// así que la regla vive aquí y la usan las dos: Mi ruta para saber qué hace el botón, y
// `OrderModal` para saber si tiene que abrir el formulario de comprobante.
//
// Puro: sin React, sin red, sin Supabase. Lo que decide sale de la etapa, de los ajustes y de
// las fotos que ya tiene el pedido; lo que se escribe lo construyen `extraRecogida` /
// `extraEntrega` a partir del GPS que capture quien llame.
// ============================================================

export type EtapaParada = string | null | undefined;

export type AccionParada =
  /** `ready` → marcar recogido de un toque. */
  | { kind: "pickup" }
  /** `picked_up` y sin nada que recoger en la puerta → marcar entregado de un toque. */
  | { kind: "deliver" }
  /** `picked_up` pero falta firma o foto: abrir la ficha, que es donde se piden. */
  | { kind: "pod" }
  /** Cualquier otra etapa (aún no está lista, o ya está entregada): solo abrir la ficha. */
  | { kind: "open" };

export interface AjustesProof {
  /** Firma en la entrega. Apagada salvo que un administrador la encienda. */
  pod_signature_enabled?: boolean | null;
  /** La oficina exige comprobante (firma o foto) antes de entregar. */
  require_pod?: boolean | null;
}

/**
 * ¿Queda algo que recoger en la puerta antes de poder entregar?
 *
 * Es la misma condición que `OrderModal` usaba con dos nombres (`signatureOn || podOwed`), y
 * ahora la importa de aquí: si un día se enciende la firma, las dos pantallas cambian a la vez.
 * Con la firma apagada y el comprobante ya cumplido —o porque la oficina no lo exige, o porque
 * las fotos ya están en el pedido— el formulario solo pediría un nombre que nadie hizo
 * obligatorio, y ahí el segundo toque es fricción, no una garantía.
 */
export function pruebaPendiente(ajustes: AjustesProof, fotos: unknown[] | null | undefined): boolean {
  return ajustes.pod_signature_enabled === true || podSinCumplir(ajustes, fotos, null);
}

/**
 * El comprobante que exige la oficina, ¿sigue sin cumplirse?
 *
 * La primitiva de la que sale todo lo de arriba, y la que usa el guardado del comprobante en
 * `OrderModal` justo antes de escribir. Son la misma regla mirada en dos momentos: al abrir la
 * ficha todavía no hay firma (`firma = null`), así que solo la puede cumplir una foto; al pulsar
 * «Confirmar entregado» la firma recién hecha también cuenta. Tenerlas separadas era lo que
 * permitía que una cambiara sin la otra.
 */
export function podSinCumplir(
  ajustes: AjustesProof,
  fotos: unknown[] | null | undefined,
  firma: string | null | undefined,
): boolean {
  return !!ajustes.require_pod && !firma && !(fotos?.length);
}

/**
 * Qué hace el botón de la parada, por etapa.
 *
 * Ojo con `open`, que es medido y no teórico: `next` en Mi ruta es «la primera parada que no
 * está entregada», y esa lista incluye lo asignado al chofer aunque siga en `approved` o
 * `fulfilling` (el almacén no la ha preparado). Antes el botón decía «Entregar» para una parada
 * que ni siquiera estaba lista; ahora esas etapas no ofrecen acción, solo abrir el pedido.
 */
export function accionParada(
  etapa: EtapaParada,
  ajustes: AjustesProof,
  fotos: unknown[] | null | undefined,
): AccionParada {
  if (etapa === "ready") return { kind: "pickup" };
  if (etapa === "picked_up") return pruebaPendiente(ajustes, fotos) ? { kind: "pod" } : { kind: "deliver" };
  return { kind: "open" };
}

export interface GpsRecogida { lat: number; lng: number; at: string }

export interface PedidoRecogida {
  actual_pallets?: number | null;
  est_pallets?: number | null;
  assigned_driver?: string | null;
  order_code?: string | null;
  order_no?: number | string | null;
}

/**
 * Cuántas pallets se lleva el camión cuando nadie las cuenta a mano: las confirmadas, o las
 * estimadas, o ninguna. Es el mismo número que ya usaba la vía rápida de la ficha.
 */
export function palletsDeRecogida(pedido: PedidoRecogida): number {
  return pedido.actual_pallets ?? pedido.est_pallets ?? 0;
}

/**
 * Todo lo que se escribe al marcar recogido de un toque: la nota y el `extra`. Lo usan las dos
 * vías —el botón de Mi ruta y la ficha—, así que no pueden escribir cosas distintas por el
 * mismo gesto. Un 0 NO se escribe encima de un blanco: un número que la oficina no puso no
 * debe convertirse en un número equivocado puesto por el camión.
 */
export function escrituraRecogida(input: {
  pedido: PedidoRecogida;
  me: { role?: string | null; full_name?: string | null } | null | undefined;
  gps: GpsRecogida | null;
  t: (en: string, es: string) => string;
  /** El recuento ya decidido por quien llama. Sin él se usa el del pedido. */
  pallets?: number;
}): { pallets: number; note: string; extra: Record<string, unknown> } {
  // `pallets` explícito y no «cuélalo por el pedido»: `??` no cae con 0, así que un cero que
  // viajara dentro del pedido se convertiría en el estimado y escribiría un recuento que nadie
  // contó. Quien ya tiene el número lo pasa; quien no, lo saca del pedido.
  const n = input.pallets ?? palletsDeRecogida(input.pedido);
  return {
    pallets: n,
    note: n > 0 ? input.t(`Loaded: ${n} pallets`, `Cargadas: ${n} pallets`) : input.t("Loaded", "Cargada"),
    extra: {
      ...extraRecogida(input.gps),
      ...claimDelChofer(input.me, input.pedido.assigned_driver),
      ...(n > 0 ? { actual_pallets: n } : {}),
    },
  };
}

/**
 * Lo que se escribe al recoger. Si el GPS no llegó a tiempo se guarda solo la hora: la posición
 * la parchea después quien capture el arreglo tardío. Nunca bloquea la recogida.
 */
export function extraRecogida(gps: GpsRecogida | null): Record<string, unknown> {
  return gps
    ? { pickup_lat: gps.lat, pickup_lng: gps.lng, pickup_gps_at: gps.at }
    : { pickup_gps_at: new Date().toISOString() };
}

/**
 * Un chofer que carga físicamente un pedido que no era de nadie se queda con él. Si no, sale
 * «en reparto» sin dueño: desaparece de la cola de todos los choferes —cada uno ve solo la
 * suya— y nadie responde por él.
 */
export function claimDelChofer(
  me: { role?: string | null; full_name?: string | null } | null | undefined,
  asignado: string | null | undefined,
): Record<string, unknown> {
  return me?.role === "driver" && !asignado ? { assigned_driver: me.full_name } : {};
}

export interface GpsEntrega { lat: number; lng: number; accuracy?: number | null }

/**
 * Lo que se escribe al entregar de un toque. Sin nombre de quien recibe y sin firma: esta vía
 * solo existe cuando no había nada que pedir (`pruebaPendiente` = false), y escribir un nombre
 * vacío sería inventarlo. La hora y la posición sí, que son lo que prueba dónde se estuvo.
 *
 * `delivered_address: null` va aquí a propósito, y no es relleno: la ficha lo escribe siempre al
 * entregar —`altAddr || null`, que por esta vía sería siempre null— y sin la clave las dos vías
 * escribirían cosas distintas por el mismo gesto: la ficha BORRA una dirección alternativa vieja
 * y esto la habría conservado. Hoy no hay ninguna que borrar (solo se escribe al entregar, y de
 * `delivered` no se vuelve), pero el objetivo del módulo es justo que no puedan discrepar.
 */
export function extraEntrega(gps: GpsEntrega | null): Record<string, unknown> {
  return {
    pod_received_by: null,
    pod_signature: null,
    pod_delivered_at: new Date().toISOString(),
    pod_lat: gps?.lat ?? null,
    pod_lng: gps?.lng ?? null,
    pod_accuracy: gps?.accuracy ?? null,
    delivered_address: null,
  };
}
