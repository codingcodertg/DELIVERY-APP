import type { Delivery, NamedLocation, OrderEvent, Stage, UserRole } from "@/lib/types";
import type { Lang } from "@/lib/prefs";
import { stageInfo, stageLabel } from "@/lib/constants";
import { esParaRecibir, tiendasDeAlmacen, type ReglaDeTipo } from "@/lib/almacen";

/**
 * **«Recibir»: almacén cierra la Intertienda que llega a su tienda** (D-409).
 *
 * El dueño, el 2026-09-26: *«warehouse puede darle delivery a una carga que vaya donde ellos, pero si
 * ellos lo hacen no aparecerá como delivered sino como received; y received es lo mismo que delivered,
 * solo que esto es para diferenciar si fue el driver o el warehouse»*.
 *
 * ### Es `delivered` en la base, a todos los efectos
 *
 * La etapa que se escribe es **`delivered`**, la de siempre: informes, cuentas, Outdated, factura
 * pendiente, el filtro por etapa y la 146 la ven igual que cualquier entregada. Lo único distinto es el
 * **evento** que deja en `order_events`: `kind = "received"` en vez de `"delivered"`. `kind` es texto
 * libre (no tiene `check` en ninguna migración; ver `schema.sql:130`), así que **no hace falta migración**.
 *
 * ### Por qué el evento y no una columna
 *
 * La lista **ya carga los eventos**: el proveedor baja los últimos `EVENTS_WINDOW` (1000) al abrir la app,
 * para todos los roles, y los recarga por tiempo real. Pintar «Received» cuesta un índice en memoria
 * (`idsRecibidasPorAlmacen`), **cero consultas nuevas**. Una columna pediría la migración 147, su
 * despliegue antes que el código, y otra escritura que limpiar al deshacer.
 *
 * El precio, y se dice: **una orden recibida hace más de 1000 eventos** se pinta «Delivered», porque su
 * evento ya no está en memoria. Solo afecta a cómo se pinta, nunca a la etapa ni a lo que cuenta; y lo que
 * se ve a diario —ayer, hoy y futuro— está siempre dentro.
 *
 * ### Qué se pinta como «Received»
 *
 * Una orden **en `delivered`** cuyo **último** paso a entregada (el evento más nuevo de tipo
 * `delivered` o `received`) fue un `received`. «El último» importa: si almacén la recibe, alguien la
 * deshace y luego el chofer la entrega con POD, es «Delivered». Office o gerente con «Marcar entregada
 * ya» siguen dejando `delivered`: el pedido es de almacén.
 */

/** El `kind` del evento que deja «Recibir» en `order_events`. */
export const KIND_RECIBIDA = "received";

/** Verde, de la familia de «Entregado» (`#1f9d61`), pero que se distingue a simple vista. */
export const RECIBIDO_COLOR = "#5f9a2a";

/**
 * ¿Le sale «Recibir» a esta persona en esta orden?
 *
 * - **Solo almacén.** Es el pedido literal; office y gerente tienen «Marcar entregada ya».
 * - **Solo en `picked_up`**: el chofer la trae. Desde `ready` no: la base (145) no le deja a almacén
 *   `ready → delivered`, y abrirlo sería migración. Si llegó sin que nadie marcara la recogida, almacén
 *   pulsa «Recoger» (que la base ya le deja en cualquier tienda) y después «Recibir».
 * - **Solo si va a SU tienda**: exactamente la lista de su Recepción (`esParaRecibir`, D-374), con su
 *   tienda y las de su grupo. Sin tienda, nada.
 */
export function puedeRecibir(
  me: { role: UserRole; store?: string | null } | null | undefined,
  d: Pick<Partial<Delivery>, "store" | "pickup_name" | "delivery_name"> & { stage: Stage },
  regla: ReglaDeTipo,
  tiendas: NamedLocation[],
): boolean {
  if (!me || me.role !== "warehouse") return false;
  if (d.stage !== "picked_up") return false;
  return esParaRecibir(d, regla, tiendasDeAlmacen(me.store, tiendas));
}

/**
 * Las órdenes cuyo último paso a entregada lo dio «Recibir». Se calcula una vez por lista de eventos;
 * pintar cada fila es mirar un `Set`.
 */
export function idsRecibidasPorAlmacen(events: readonly Pick<OrderEvent, "delivery_id" | "kind" | "created_at">[]): Set<string> {
  const ultimo = new Map<string, { kind: string; t: number }>();
  for (const e of events) {
    if (e.kind !== "delivered" && e.kind !== KIND_RECIBIDA) continue;
    const t = Date.parse(e.created_at);
    const prev = ultimo.get(e.delivery_id);
    if (!prev || t > prev.t) ultimo.set(e.delivery_id, { kind: e.kind, t });
  }
  const out = new Set<string>();
  for (const [id, u] of ultimo) if (u.kind === KIND_RECIBIDA) out.add(id);
  return out;
}

/** ¿Se pinta «Received»? Solo una entregada: si se deshizo, vuelve a pintarse su etapa. */
export function esRecibida(d: Pick<Delivery, "id" | "stage">, recibidas: ReadonlySet<string> | undefined): boolean {
  return d.stage === "delivered" && !!recibidas?.has(d.id);
}

/** Texto y color de la pastilla de etapa. Es la única diferencia entre «Received» y «Delivered». */
export function pastillaDeEtapa(
  d: Pick<Delivery, "id" | "stage">,
  recibidas: ReadonlySet<string> | undefined,
  lang: Lang,
): { texto: string; color: string } {
  if (esRecibida(d, recibidas)) return { texto: lang === "es" ? "Recibido" : "Received", color: RECIBIDO_COLOR };
  return { texto: stageLabel(d.stage, lang), color: stageInfo(d.stage).color };
}

/**
 * La escritura de «Recibir», una sola vez para la ficha y para Recepción: `delivered` con el evento
 * `received`. Nada más: sin firma, sin POD, sin GPS, como «Marcar entregada ya». Sin nota: el historial
 * ya lo dice con el nombre del evento («Recibida por almacén») y quién lo hizo.
 */
export function recibirOrden(
  setStage: (id: string, stage: Stage, note?: string, extra?: Partial<Delivery>, kind?: string) => Promise<boolean>,
  id: string,
): Promise<boolean> {
  return setStage(id, "delivered", undefined, undefined, KIND_RECIBIDA);
}
