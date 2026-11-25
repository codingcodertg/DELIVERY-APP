/**
 * De qué día viene una orden ARRASTRADA: la que se movió de una fecha anterior a una posterior y sigue en esa fecha.
 * Su recogida sale en rojo claro en la tabla de paradas (el dueño, 2026-11: «if an order was moved from yesterday to
 * tomorrow then the pickup … will turn to light red»).
 *
 * Se lee del historial. Un cambio de fecha lo escribe la edición (`changedFieldsNote`, en `utils.ts`) como
 * «Delivery Date: AAAA-MM-DD → AAAA-MM-DD», dentro de «Changed: …», unido a otros cambios con « · ». Y la reprogramación
 * (`reprogramar_orden`, migración 173) escribe el mismo par en su evento «edited»: «Changed: Delivery Date: X → Y».
 * Un valor vacío se escribe «—», que aquí no es fecha.
 *
 * Aquí no hay React: se prueba con vitest, sin navegador.
 */
import type { Delivery, OrderEvent } from "@/lib/types";

/** La fecha AAAA-MM-DD de un valor de fecha, con o sin hora. `null` si no hay fecha («—», vacío). */
function diaDe(v: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec((v ?? "").trim());
  return m ? m[1] : null;
}

/** Los cambios de fecha de una nota, como pares {de, a} de días. Los que no tienen fecha de los dos lados se dejan fuera. */
function cambiosDeFecha(nota: string | null): { de: string; a: string }[] {
  const r: { de: string; a: string }[] = [];
  const re = /Delivery Date: (.+?) → (.+?)(?= · |$)/g;
  for (const m of (nota ?? "").matchAll(re)) {
    const de = diaDe(m[1]), a = diaDe(m[2]);
    if (de && a) r.push({ de, a });
  }
  return r;
}

/**
 * La fecha de la que viene una orden arrastrada, o `null`. Cuenta el ÚLTIMO cambio de fecha que llevó a la fecha de
 * entrega de hoy de la orden: si esa fecha es posterior a la de antes, la orden viene de ese día. Si la fecha se movió
 * hacia atrás, si se puso por primera vez («—» antes), o si un cambio posterior la devolvió al día original, no cuenta.
 * `eventos` puede traer las órdenes que quiera: solo se miran los de esta.
 */
export function arrastradaDesde(
  d: Pick<Delivery, "id" | "delivery_date">,
  eventos: readonly Pick<OrderEvent, "delivery_id" | "kind" | "note" | "created_at">[],
): string | null {
  const hoy = diaDe(d.delivery_date);
  if (!hoy) return null;
  const propios = eventos
    .filter((e) => e.delivery_id === d.id && e.kind === "edited")
    .sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at));
  let ultimo: { de: string; a: string } | null = null;
  for (const e of propios) {
    for (const c of cambiosDeFecha(e.note)) if (c.a === hoy) ultimo = c;
  }
  if (!ultimo) return null;
  return ultimo.de < ultimo.a ? ultimo.de : null;
}
