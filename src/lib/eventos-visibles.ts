import type { OrderEvent } from "@/lib/types";

/**
 * Los eventos de órdenes que ve la app (D-540).
 *
 * En modo enseñanza lo que se hace (una nota, un «📍 Llegué») NO va a la base: se guarda en la capa local
 * (`overlay.events`). `eventsFor` —el historial de una orden— ya juntaba las dos capas, pero la lista `events`
 * que el proveedor da a todas las pantallas solo llevaba la real. «Mi ruta» saca las llegadas de esa lista
 * (`llegadasDeParadas(events, …)`), así que en enseñanza el chofer pulsaba «Llegué», salía «Llegaste a la
 * tienda» y el botón nunca pasaba a «Recogido». El dueño, 2026-10-13, como Ernesto y en enseñanza: *«cuando
 * apreto arrived en el driver view solo dice arrived at the store pero no cambia»*.
 *
 * Lo local va primero (es lo más nuevo), como en `eventsFor`. Fuera de enseñanza, la real tal cual: la misma
 * referencia, para no despertar a nadie que dependa de ella.
 */
export function eventosVisibles(reales: OrderEvent[], locales: OrderEvent[], ensenanza: boolean): OrderEvent[] {
  if (!ensenanza || locales.length === 0) return reales;
  return [...locales, ...reales];
}
