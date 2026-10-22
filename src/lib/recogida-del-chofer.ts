import type { NotifSeed } from "@/lib/notifications";
import type { NamedLocation, OrderEvent, Stage } from "@/lib/types";
import { mismaTiendaOGrupo } from "@/lib/store-group";

// ============================================================
// La recogida del chofer en «Mi ruta» y en su ficha (D-527, 2026-10-11). Cuatro pedidos del dueño, literales:
//
//   «when i press the pickup in the driver view the order should also popo up as in the delivery part»
//   «the driver can undo an arrive or a pickup»
//   «have the driver be able to override a pickup even if the warheouse doesnt have it ready just put a note down for it»
//   «the driver view, arrived and pickuped up showuld be in the same row»
//
// Y uno más el mismo día: «when you pres deliverd it should open the camera so you can add the proof of delikvery for
// the driver».
//
// Aquí van las reglas puras —sin React ni red— que usan «Mi ruta» (`my-route/page.tsx`, `AccionesDeParada`) y la ficha
// (`OrderModal`, `acciones-de-la-ficha`): las dos pantallas preguntan lo mismo y no pueden contestar distinto.
// ============================================================

type Texto = { en: string; es: string };

// ---- Recoger aunque el almacén no la tenga lista -----------------------------

/** Las etapas desde las que el chofer recoge «de todos modos»: el almacén la aprobó pero no la marcó lista. */
export const ETAPAS_QUE_SE_RECOGEN_SIN_LISTO: readonly Stage[] = ["approved", "fulfilling"];

/**
 * ¿Ofrece la ficha «Recoger de todos modos» a esta persona en esta orden?
 *
 * **Espejo de la cláusula de la migración 168**: chofer, orden en `approved` o `fulfilling`, y la orden es SUYA
 * (`assigned_driver`, que en esta base es el NOMBRE del chofer, no su id). Una orden sin chofer no: «Mi ruta» solo pinta
 * las asignadas, y abrir la recogida forzada a cualquier orden sin dueño es otra decisión (ver D-527).
 */
export function puedeRecogerSinListo(
  yo: { role?: string | null; full_name?: string | null } | null | undefined,
  pedido: { stage?: string | null; assigned_driver?: string | null },
): boolean {
  if (yo?.role !== "driver" || !yo.full_name) return false;
  if (!ETAPAS_QUE_SE_RECOGEN_SIN_LISTO.includes(pedido.stage as Stage)) return false;
  return pedido.assigned_driver === yo.full_name;
}

/** Lo mínimo que se acepta como nota: tres letras, como la razón de un rechazo (D-487). */
export const MINIMO_NOTA_SIN_LISTO = 3;

/** La nota escrita, limpia, o `null` si no llega al mínimo (el botón de confirmar queda apagado). */
export function notaSinListoValida(texto: string | null | undefined): string | null {
  const limpio = (texto ?? "").trim().replace(/\s+/g, " ");
  return limpio.length >= MINIMO_NOTA_SIN_LISTO ? limpio : null;
}

const PREFIJO_SIN_LISTO = { en: "Picked up before it was ready", es: "Recogida sin estar lista" } as const;

/** La nota del evento `picked_up`: el prefijo que la hace legible en el historial, la nota del chofer y lo cargado. */
export function notaDeRecogidaSinListo(nota: string, cargada: string, lang: "en" | "es"): string {
  return `${PREFIJO_SIN_LISTO[lang]}: ${nota} · ${cargada}`;
}

/** ¿Esta nota de recogida es de una recogida sin estar lista? Mira los dos idiomas: la escribe quien recoge, en el suyo. */
export function esRecogidaSinListo(nota: string | null | undefined): boolean {
  const n = (nota ?? "").trim();
  return n.startsWith(`${PREFIJO_SIN_LISTO.en}:`) || n.startsWith(`${PREFIJO_SIN_LISTO.es}:`);
}

/** El evento y la campana: a quién se avisa en la app. */
export const KIND_RECOGIDA_SIN_LISTO = "picked_up_not_ready";

/**
 * El aviso en la campana (como el del rechazo, D-487): al **almacén de la tienda donde se recoge** —la suya o una de su
 * grupo, que es lo que ese almacén ve y prepara (D-293)— y a **logística**. Nunca a quien lo hizo. Nada de SMS ni correo.
 * Un almacenista sin tienda no es «el de esa tienda» y no se avisa.
 *
 * «La tienda donde se recoge» se mira en `pickup_name` Y en `store`: `pickup_name` no siempre es el nombre de una tienda
 * («RDZ McAllen Warehouse», un punto de recogida guardado), y `store` es la tienda que vende y despacha (D-312).
 */
export function avisosDeRecogidaSinListo(args: {
  users: readonly { id: string; role: string; store?: string | null }[];
  actorId: string | null | undefined;
  pedido: { id: string; order_no: number | null; store?: string | null; pickup_name?: string | null };
  tiendas: readonly NamedLocation[];
  etiqueta: string;
  nota: string;
  chofer: string | null | undefined;
}): NotifSeed[] {
  const { users, actorId, pedido, tiendas, etiqueta, nota, chofer } = args;
  const tienda = pedido.pickup_name || pedido.store || null;
  const esDeEsaTienda = (suya: string | null | undefined) =>
    [pedido.pickup_name, pedido.store].some((t) => !!t && mismaTiendaOGrupo(suya, t, tiendas));
  return users
    .filter((u) => u.id !== actorId)
    .filter((u) => u.role === "logistics" || (u.role === "warehouse" && esDeEsaTienda(u.store)))
    .map((u) => ({
      user_id: u.id, delivery_id: pedido.id, order_no: pedido.order_no, kind: KIND_RECOGIDA_SIN_LISTO,
      message: `Order ${etiqueta} was picked up before it was marked ready${chofer ? ` (${chofer})` : ""}${tienda ? ` at ${tienda}` : ""}: ${nota}`,
    }));
}

/**
 * El error del guard mientras la 168 no esté aplicada, dicho para el chofer. Sin la 168 la base contesta
 * «driver cannot move an order from approved to picked_up», que es verdad pero no le dice nada a quien está en la
 * tienda con el material delante. `null`: no es ese error, y se enseña el de siempre.
 */
export function mensajeDelGuard(mensaje: string | null | undefined, lang: "en" | "es"): string | null {
  if (!/cannot move an order from (approved|fulfilling) to picked_up/.test(mensaje ?? "")) return null;
  return lang === "es"
    ? "Aún no disponible: falta una actualización del sistema — avisa a la oficina"
    : "Not available yet: the system is missing an update — tell the office";
}

// ---- Deshacer «Recogido» -----------------------------------------------------

/** Por qué el chofer no puede deshacer una recogida desde su teléfono, y a quién pedírselo. */
export const BLOQUEOS_DE_DESHACER = {
  sinEvento: { en: "Can't find who picked it up — ask the office to undo it", es: "No se encuentra quién la recogió: pídele a la oficina que lo deshaga" },
  deOtro: { en: "Someone else marked this pickup — ask the office to undo it", es: "La recogida la marcó otra persona: pídele a la oficina que la deshaga" },
  partida: { en: "This load was split at pickup — ask the office to undo it", es: "Esta carga se partió al recogerla: pídele a la oficina que lo deshaga" },
  sinListo: { en: "It was picked up before it was ready; undoing it would mark it ready — ask the office", es: "Se recogió sin estar lista; deshacerla la dejaría «lista»: pídeselo a la oficina" },
} as const satisfies Record<string, Texto>;

/** La nota que deja la oficina al partir una carga al recoger (`confirmPickup` en la ficha), en los dos idiomas. */
const PARTIDA_AL_RECOGER = /^(Partial load|Carga parcial):/;

/** Deshacer, para la pantalla: `null` = no se ofrece (no es suya, o no está recogida); si no, encendido o apagado con su motivo. */
export type DeshacerRecogida = { bloqueo: Texto | null } | null;

/**
 * ¿Puede el chofer deshacer «Recogido» en esta orden?
 *
 * Se ofrece solo en SU orden (`assigned_driver` es su nombre) y mientras va en el camión (`picked_up`): entregada ya no.
 * Una rechazada por el cliente tampoco: lo suyo es «Dejar en tienda» (D-495), que además dice dónde queda el material.
 *
 * Y se apaga, con el motivo y a quién pedírselo, cuando deshacerla desde el teléfono sería un lío. La última recogida del
 * historial tiene que ser **suya** y **normal**:
 *  - si no está en el historial cargado, no se sabe qué se deshace;
 *  - si la marcó otra persona (la oficina, el almacén), no es el chofer quien la deshace;
 *  - si partió la carga (la oficina, `confirmPickup`), hay una orden hermana nacida de esa recogida;
 *  - si fue una recogida sin estar lista (168), volver a `ready` diría que el almacén la tiene lista, y no la tenía; la
 *    base solo le deja al chofer `picked_up → ready`, así que la vuelta a su etapa de antes es de la oficina.
 */
export function deshacerRecogida(args: {
  pedido: { id: string; stage?: string | null; assigned_driver?: string | null };
  yo: { id?: string | null; role?: string | null; full_name?: string | null } | null | undefined;
  eventos: readonly Pick<OrderEvent, "delivery_id" | "kind" | "note" | "created_by" | "created_at">[];
  rechazada?: boolean;
}): DeshacerRecogida {
  const { pedido, yo, eventos, rechazada } = args;
  if (yo?.role !== "driver" || !yo.full_name || !yo.id) return null;
  if (pedido.stage !== "picked_up" || pedido.assigned_driver !== yo.full_name || rechazada) return null;
  const ultima = eventos
    .filter((e) => e.delivery_id === pedido.id && e.kind === "picked_up")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!ultima) return { bloqueo: BLOQUEOS_DE_DESHACER.sinEvento };
  if (ultima.created_by !== yo.id) return { bloqueo: BLOQUEOS_DE_DESHACER.deOtro };
  if (PARTIDA_AL_RECOGER.test((ultima.note ?? "").trim())) return { bloqueo: BLOQUEOS_DE_DESHACER.partida };
  if (esRecogidaSinListo(ultima.note)) return { bloqueo: BLOQUEOS_DE_DESHACER.sinListo };
  return { bloqueo: null };
}

/**
 * Lo que se escribe al deshacer «Recogido»: la etapa vuelve a `ready` (la pone `setStage`) y se **borran los sellos de la
 * recogida** (`pickup_lat`, `pickup_lng`, `pickup_gps_at`), como hace «Dejar en tienda» (D-224): una recogida que no pasó
 * no puede seguir contando en los tiempos de recogida y tránsito, ni pintarse «📍 Recogido en…» en una orden lista, ni
 * hacer que `juntar_cargas` (157) crea que esa carga ya salió. La siguiente recogida los vuelve a poner.
 *
 * `actual_pallets` se queda: la recogida escribió el recuento que ya tenía la orden (`escrituraRecogida`), y no se sabe
 * si antes estaba vacío; borrarlo podría quitar un recuento que el almacén sí confirmó.
 */
export function escrituraDeshacerRecogida(t: (en: string, es: string) => string): { patch: Record<string, null>; note: string } {
  return {
    patch: { pickup_lat: null, pickup_lng: null, pickup_gps_at: null },
    note: t("Pickup undone by the driver — back to ready at the store", "Recogida deshecha por el chofer — vuelve a lista en la tienda"),
  };
}

// ---- Entregar con la cámara ---------------------------------------------------

/**
 * ¿«Entregado» abre la cámara? Para el chofer, siempre (el dueño: «when you pres deliverd it should open the camera»).
 * La oficina, el almacén y el admin siguen como estaban en su ficha.
 *
 * Nota D-NEXT: ya no abre ninguna cámara sola. Para el chofer, «Entregado» abre SIEMPRE la prueba de entrega (aunque la
 * oficina no la exija) con las fotos a la vista: «📸 Varias fotos», «📷 Una foto» y «🖼 Galería». El nombre se queda.
 */
export function entregaConCamara(rol: string | null | undefined): boolean {
  return rol === "driver";
}
