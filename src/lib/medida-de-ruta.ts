/**
 * Medir la ruta de un chofer en el Gestor de Rutas SIN reordenarla (D-437).
 *
 * Hasta D-437, elegir un chofer «dibujaba» su ruta llamando a «Optimizar» (`computeRoute` + `applyPlan`): pedía a Google
 * el MEJOR orden y lo escribía. Como la medida se borra tras cada cambio (`clearRouteFor`), una flecha con el chofer elegido
 * volvía a optimizar y deshacía la flecha. El dueño pidió quitar Optimizar (2026-09-28): el orden lo deciden «Armar las
 * rutas del día», «📍 Mejor lugar», el arrastre y las flechas. Esto solo mide y pinta: millas, horas por viaje, llegada
 * estimada de cada parada y el trazo del mapa, en el orden GUARDADO.
 */

export interface PuntoDeLaMedida { id: string; lat: number; lng: number }

/**
 * El cuerpo que se manda a `/api/optimize-route` para un viaje: la base (si hay) y las paradas EN SU ORDEN, con
 * `optimize: false` —el camino en ese orden, como «Mi ruta» y el trazo del plan publicado—. Con base, ida y vuelta.
 */
export function cuerpoDeLaMedida(paradas: readonly PuntoDeLaMedida[], base: readonly [number, number] | null, fecha: string | null) {
  return {
    stops: [...(base ? [{ id: "__depot__", lat: base[0], lng: base[1] }] : []), ...paradas.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }))],
    roundtrip: !!base,
    date: fecha,
    optimize: false as const,
  };
}

/**
 * ¿Se pinta en el mapa la línea del plan PUBLICADO de un chofer (D-352)? Solo si le quedan paradas pendientes y su ruta
 * de hoy SIGUE siendo la publicada (`fuente: "plan"`, la misma decisión que da las etiquetas P/D, D-335/D-433).
 *
 * El dueño, 2026-09-28, con captura: «julio esta vacio pero aun asi aparece». Julio tenía 0 paradas y el mapa seguía
 * dibujando la línea de su plan publicado —Pharr → … → Brownsville—, porque el trazo se pedía con las paradas DEL PLAN,
 * no con las suyas de ahora. Se decidió «nada» antes que «el plan recortado a lo que le queda»: recortado ya no es el plan
 * (sus recogidas y su orden eran para otra ruta), y la ruta de ahora ya tiene su propia línea, la medida (`mideLaRuta`).
 */
export const pintaElTrazoDelPlan = (pendientes: number, fuente: "plan" | "derivada"): boolean => pendientes > 0 && fuente === "plan";

/**
 * La forma de la ruta que se mide: qué paradas, en qué puesto, en qué viaje (histórico), dónde se recogen (D-443: la recogida
 * también es una parada medida) y dónde. La pantalla mide cada forma UNA vez:
 * si la medida falla (sin sesión, sin red), no se vuelve a pedir en bucle; si la ruta cambia, es otra forma y se mide.
 */
export function firmaDeLaMedida(
  fecha: string, clave: string,
  paradas: readonly { id: string; route_seq?: number | null; load_no?: number | null; pickup_seq?: number | string | null; delivery_lat?: number | null; delivery_lng?: number | null }[],
): string {
  return [fecha, clave, ...paradas.map((p) => `${p.id}:${p.route_seq ?? ""}:${p.load_no ?? ""}:${p.pickup_seq ?? ""}:${p.delivery_lat ?? ""},${p.delivery_lng ?? ""}`)].join("|");
}

// ---------------------------------------------------------------------------------------------------------------------
// La llegada estimada, SIEMPRE (D-456).
//
// El dueño, 2026-10-01: «el eta estimado en el logistic manager, quiero que muestre el eta siempre que aveces no aparece».
// Tres causas, medidas en el código de antes:
//   1. Solo se medía la ruta de los choferes MARCADOS en el panel: las demás tarjetas decían «—» en toda la columna.
//   2. Volver a una forma de la ruta que ya se había medido —deshacer, subir y bajar la misma parada, pasar una orden y
//      traerla de vuelta— dejaba la columna en «—» hasta recargar: lo pintado se tira con cada cambio, y la forma ya estaba
//      apuntada como pedida, así que no se volvía a pedir.
//   3. Una medida que fallaba (sin red, el proveedor caído) tampoco se reintentaba, y la celda decía «—» sin decir por qué.
// Ahora se miden todas las rutas con paradas que están en pantalla; cada forma se pide UNA vez y su medida se guarda mientras
// la pantalla esté abierta (volver a ella la repinta sin llamar a nadie); y la celda dice qué pasa: «calculando…», por qué
// no hay hora, o «sin medida» con un botón para reintentar (una llamada por pulsación, nunca en bucle).

/** Lo que se guarda de una forma cuya medida falló: no se vuelve a pedir sola. */
export const MEDIDA_FALLIDA = "fallo" as const;

/**
 * Qué hacer ahora con las rutas que hay que tener medidas, en orden de prioridad: cuáles se REPINTAN de lo ya medido (sin
 * llamar a nadie) y cuál —una sola— se PIDE. `pintadas`: la forma que cada ruta tiene pintada ahora. `conocidas`: las formas
 * ya medidas en esta visita (su medida, o `MEDIDA_FALLIDA`). Una forma fallida ni se repinta ni se vuelve a pedir.
 */
export function siguienteMedida<M>(
  rutas: readonly { clave: string; firma: string }[], pintadas: Readonly<Record<string, string | undefined>>,
  conocidas: { has(firma: string): boolean; get(firma: string): M | typeof MEDIDA_FALLIDA | undefined },
): { repinta: { clave: string; firma: string; medida: M }[]; pide: { clave: string; firma: string } | null } {
  const repinta: { clave: string; firma: string; medida: M }[] = [];
  let pide: { clave: string; firma: string } | null = null;
  for (const r of rutas) {
    if (pintadas[r.clave] === r.firma) continue;
    if (conocidas.has(r.firma)) {
      const m = conocidas.get(r.firma);
      if (m !== undefined && m !== MEDIDA_FALLIDA) repinta.push({ ...r, medida: m });
      continue;
    }
    if (!pide) pide = r;
  }
  return { repinta, pide };
}

/** «medida»: pintada y al día. «calculando»: se va a pedir o se está pidiendo. «fallo»: se pidió y no contestó. «sin_pedir»:
 *  esta ruta no se mide ahora (viendo todas las fechas, una ruta sin marcar). */
export type EstadoDeLaMedida = "medida" | "calculando" | "fallo" | "sin_pedir";
/** Por qué una parada no puede tener hora aunque la ruta se mida. */
export type MotivoSinLlegada = "sin_pin" | "sin_tienda" | "sin_base";

/**
 * Lo que dice la celda «Llegada» de una parada: su hora si la hay; si no, POR QUÉ no la hay. Una parada sin punto en el mapa
 * no tendrá hora por mucho que se mida, y eso manda sobre «calculando…».
 */
export function textoDeLaLlegada(eta: string | undefined, estado: EstadoDeLaMedida, motivo: MotivoSinLlegada | null, es: boolean): { texto: string; titulo?: string; falta: boolean } {
  if (eta) return { texto: eta, falta: false };
  if (motivo === "sin_pin") return { texto: es ? "sin pin" : "no pin", titulo: es ? "La entrega no tiene punto en el mapa: dele una dirección válida en Órdenes" : "The delivery has no map pin: give it a valid address in Orders", falta: true };
  if (motivo === "sin_tienda") return { texto: es ? "tienda sin punto" : "store has no pin", titulo: es ? "La tienda de recogida no tiene coordenadas en Ajustes → Tiendas" : "The pickup store has no coordinates in Settings → Stores", falta: true };
  if (estado === "calculando") return { texto: es ? "calculando…" : "calculating…", falta: true };
  if (estado === "fallo") return { texto: es ? "sin medida" : "not measured", titulo: es ? "No se pudo medir la ruta (sin red, o el servicio de rutas no contestó). Pulse ↻ en la tarjeta para reintentar." : "The route couldn't be measured (no network, or the routing service didn't answer). Press ↻ on the card to retry.", falta: true };
  if (estado === "medida" && motivo === "sin_base") return { texto: es ? "sin base" : "no base", titulo: es ? "Una sola parada y el chofer no tiene tienda: no hay de dónde salir para medir" : "A single stop and the driver has no store: there's nowhere to leave from", falta: true };
  return { texto: "—", falta: true };
}
