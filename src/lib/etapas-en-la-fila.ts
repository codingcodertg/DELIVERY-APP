import {
  canApprove, canTransition, etapaAnterior, preparaEnLaFicha, puedeAnular, puedeDeshacer,
  puedeEntregarYa, STAGES,
} from "@/lib/constants";
import { pideConfirmarTarifa } from "@/lib/confirmar-tarifa";
import { motivoDeAnulacion } from "@/lib/cancel-reasons";
import type { Texto } from "@/lib/acciones-de-la-ficha";
import type { OrderTypeRules } from "@/lib/required";
import type { CancelReason, Delivery, Profile, Stage } from "@/lib/types";

// ============================================================
// La burbuja de «Etapa» como selector, en la fila de Almacén (D-573, sustituye en parte a D-551).
//
// El dueño (2026-10-16): «Remove next step column and have the stage column do that dropdown function. Dropdown should
// give all stage options not just the next one. Whatever stage they choose, if stages required an input it must still
// ask (like the # of pallets and delivery fee). Also want to keep the colored bubble design».
//
// Aquí se decide, sin pantalla:
//   1. QUÉ ETAPAS ofrece la burbuja a esta persona en esta orden: TODAS las que la base le va a aceptar y la fila sabe
//      pedir, no solo la siguiente. No se escribe una regla nueva: cada salto pregunta al espejo del guard que ya tenía
//      su botón en la ficha (`preparaEnLaFicha`, `puedeAnular`, `puedeEntregarYa`, `puedeDeshacer`, `canApprove`), y
//      antes de todo a `canTransition`, que es lo que `setStage` exige a quien no es admin. La prueba recorre
//      7 roles × 9 etapas contra la tabla sacada A MANO de `guard_delivery_stage` (migración 173, la última que lo
//      redefine).
//   2. QUÉ CONFIRMA cada salto antes de escribir —lo mismo que pediría la ficha—: la tarifa al comenzar (D-450),
//      los pallets al marcar listo (D-287), el motivo de anulación (D-291), el motivo al rechazar, y el motivo
//      obligatorio al entregar ya o al deshacer un paso (D-361/D-383). Sin confirmación, se escribe al elegir.
//
// Lo que la burbuja NO ofrece aunque la base lo acepte, a propósito, porque su diálogo es el del chofer:
//   - «Recoger» (`→ picked_up` hacia delante): parte cargas cortas, estampa GPS y reclama el chofer.
//   - «Marcar entregado» de almacén (`picked_up → delivered`): lleva firma y prueba de entrega. En Recepción ya tiene
//     «Recibir» en la fila (D-409); el gerente y oficina sí la tienen aquí, como «Entregar ya», con motivo.
//   - Lo de ventas: enviar un borrador o reenviar una rechazada (`→ pending`) y la auto-aprobación por tienda.
//   Esos siguen en la ficha. Volver atrás (`delivered → picked_up`) sí está: es «Deshacer etapa», con motivo.
// ============================================================

/** Qué confirma el salto antes de escribir. `null`: nada, se escribe al elegirlo. */
export type ConfirmacionDelSalto = "tarifa" | "pallets" | "anular" | "motivo_rechazo" | "motivo_entrega" | "motivo_deshacer" | null;

export interface SaltoDeEtapa {
  destino: Stage;
  confirmacion: ConfirmacionDelSalto;
}

/** Los roles a los que la burbuja ofrece algo. Logística tiene `approve` en el cliente, pero el guard no le da NINGÚN
 *  cambio de etapa («Not allowed», 173): ofrecérselo sería pintar una opción que la base rechaza. Ventas y chofer tienen
 *  sus flujos en la ficha y en «Mi ruta». */
const ROLES_CON_BURBUJA: readonly string[] = ["admin", "warehouse", "manager", "accounting"];

export type QuienElige = Pick<Profile, "id" | "role" | "full_name" | "permissions">;
export type OrdenDeLaFila = Pick<Delivery, "stage" | "order_type">;

/**
 * Los saltos de etapa que la burbuja ofrece a `yo` en `pedido`, en el orden de `STAGES`. Vacío si ninguno (la celda
 * pinta la burbuja de siempre, sin selector). `deMiTienda` es `ordenDeMisTiendas(...)`: lo que decide si almacén
 * deshace (D-383, migración 142).
 */
export function saltosEnLaFila(yo: QuienElige, pedido: OrdenDeLaFila, reglas: OrderTypeRules, deMiTienda: boolean): SaltoDeEtapa[] {
  if (!ROLES_CON_BURBUJA.includes(yo.role)) return [];
  const desde = pedido.stage;
  const saltos: SaltoDeEtapa[] = [];
  for (const { key: destino } of STAGES) {
    // `canTransition` nunca acepta la etapa en la que ya está: no hace falta mirarlo aparte (un mutante lo midió).
    if (!canTransition(desde, destino)) continue;
    const c = confirmacionDelSalto(yo, pedido, reglas, deMiTienda, destino);
    if (c !== undefined) saltos.push({ destino, confirmacion: c });
  }
  return saltos;
}

/** `undefined`: el salto no se ofrece. Si se ofrece, qué confirma (o `null`). */
function confirmacionDelSalto(
  yo: QuienElige, pedido: OrdenDeLaFila, reglas: OrderTypeRules, deMiTienda: boolean, destino: Stage,
): ConfirmacionDelSalto | undefined {
  const desde = pedido.stage;
  // Un paso atrás (el inmediato, `PASO_ATRAS`): «Deshacer etapa», con motivo. Va antes que lo demás porque
  // `delivered → picked_up` y `approved → pending` son también destinos de otros botones.
  if (destino === etapaAnterior(desde)) {
    // `approved → pending` para quien aprueba es «Desbloquear (volver a pendiente)», sin motivo, el botón principal
    // que la ficha le da; «Deshacer etapa» con motivo queda para los demás pasos atrás.
    if (destino === "pending" && canApprove(yo)) return null;
    // Almacén devuelve una recogida a «Lista» en cualquier tienda: el guard lo acepta sin mirar la tienda (es la
    // vuelta de una carga que el chofer no se llevó), aunque `puedeDeshacer` —pensado para la ficha— no lo liste.
    if (yo.role === "warehouse" && desde === "picked_up") return "motivo_deshacer";
    return puedeDeshacer(yo.role, desde, deMiTienda) ? "motivo_deshacer" : undefined;
  }
  switch (destino) {
    case "fulfilling":
      if (desde === "approved" && preparaEnLaFicha(yo)) return pideConfirmarTarifa(pedido, reglas) ? "tarifa" : null;
      return undefined;
    case "ready":
      if (desde === "fulfilling" && preparaEnLaFicha(yo)) return "pallets";
      return undefined;
    case "canceled":
      return puedeAnular(yo.role, desde) ? "anular" : undefined;
    case "delivered":
      return puedeEntregarYa(yo.role, desde) ? "motivo_entrega" : undefined;
    case "approved":
      // Aprobar una pendiente. Un borrador o una rechazada los aprueba la base al gerente, pero en la ficha eso es
      // «Enviar» de ventas con sus comprobaciones: se queda allí.
      return desde === "pending" && canApprove(yo) ? null : undefined;
    case "rejected":
      return desde === "pending" && canApprove(yo) ? "motivo_rechazo" : undefined;
    default:
      // `picked_up` hacia delante («Recoger»), `pending` desde borrador/rechazada («Enviar»), `draft`: en la ficha.
      return undefined;
  }
}

/** La nota del evento de etapa cuando el salto lleva motivo libre; la ficha escribe las mismas. */
export function notaDelSalto(confirmacion: "motivo_entrega" | "motivo_deshacer", motivo: string): Texto {
  const m = motivo.trim();
  return confirmacion === "motivo_entrega"
    ? { en: `Delivered by office (no signature): ${m}`, es: `Entregada por oficina (sin firma): ${m}` }
    : { en: `Stage undone (was a mistake): ${m}`, es: `Etapa deshecha (fue un error): ${m}` };
}

export interface EscrituraAlAnular {
  /** Las columnas del motivo (122): la clave y el texto libre si lo hay. */
  extra: Pick<Delivery, "canceled_reason" | "canceled_reason_note">;
  /** La nota del evento: la etiqueta legible en el idioma de quien anula. */
  nota: string;
}

/** Lo que escribe «Cancelar orden» con el motivo elegido: la ficha y la fila llaman a esto. */
export function escrituraAlAnular(clave: string, textoLibre: string, motivos: CancelReason[], lang: "en" | "es"): EscrituraAlAnular {
  const nota = textoLibre.trim() || null;
  return {
    extra: { canceled_reason: clave, canceled_reason_note: nota },
    nota: motivoDeAnulacion({ canceled_reason: clave, canceled_reason_note: nota }, motivos, lang),
  };
}
