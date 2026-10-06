import type { Delivery, UserRole } from "@/lib/types";
import { canEditFields } from "@/lib/constants";
import { orderOwner } from "@/lib/utils";

/**
 * Qué puede tocar cada persona en la ficha de una orden YA creada (D-NEXT).
 *
 * El dueño (2026-10-06): «sales people cna edit only the date of their orders». Hasta aquí ventas editaba el
 * formulario ENTERO mientras la orden estaba pendiente o rechazada (`canEditFields`, D-286), y la base lo deja
 * (medido el 2026-10-06: el guard, en su tramo de misma etapa, deja a ventas cualquier columna en `draft`,
 * `pending` y `rejected`, de cualquier orden, y la política de UPDATE de `deliveries` solo pide tener el
 * módulo). Lo que cambia es la PANTALLA y lo que manda al guardar; la base queda como estaba, a propósito:
 * cerrarla es otra decisión, del dueño.
 *
 * Tres respuestas, y una sola función que las da, para que la ficha, su botón «Editar» y lo que se guarda
 * no se pongan de acuerdo por casualidad:
 *   - `todo`: el formulario entero. Una orden nueva, cualquier rol que no sea ventas (si su etapa se lo
 *     permite, `canEditFields`), y ventas en un BORRADOR: D-286 lo pidió el dueño —«deja que cualquiera
 *     pueda volver y editarlo»— y un borrador que solo deja cambiar la fecha no se puede terminar.
 *   - `solo_fecha`: la fecha de entrega y nada más. Ventas, fuera del borrador, en las etapas donde ya
 *     podía editar (`pending`, `rejected`; en `approved` y después el guard rechaza cualquier escritura
 *     suya, medido), y SOLO en una orden suya: la creó o se la asignaron (`orderOwner`, la misma dueñez
 *     que decide qué ve, D-309).
 *   - `nada`: ni botón de editar. Ventas en una orden ajena o en una etapa cerrada; los demás roles,
 *     donde `canEditFields` ya decía que no.
 */
export type AlcanceDeEdicion = "todo" | "solo_fecha" | "nada";

export function alcanceDeEdicion(args: {
  rol: UserRole;
  /** El id de quien mira. */
  miId: string;
  /** `null` cuando la orden es nueva: todavía no es de nadie y se rellena entera. */
  orden: Pick<Delivery, "stage" | "created_by" | "assigned_sales_rep"> | null;
}): AlcanceDeEdicion {
  const { rol, miId, orden } = args;
  if (!orden) return "todo";
  if (!canEditFields(rol, orden.stage)) return "nada";
  if (rol !== "sales") return "todo";
  if (orden.stage === "draft") return "todo";
  return orderOwner(orden) === miId ? "solo_fecha" : "nada";
}

/**
 * Lo ÚNICO que viaja a la base cuando el alcance es `solo_fecha`. Se construye aparte del formulario a
 * propósito: la ficha guarda su copia entera de la orden (`d`) y mandarla con los campos deshabilitados
 * seguiría mandando todos los campos; la base no distingue «deshabilitado» de «cambiado».
 */
export function parcheSoloFecha(d: Partial<Pick<Delivery, "delivery_date">>): Pick<Delivery, "delivery_date"> {
  return { delivery_date: d.delivery_date ?? null };
}
