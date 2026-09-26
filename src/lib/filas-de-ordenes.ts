import type { Delivery } from "@/lib/types";
import type { OrderTypeRules } from "@/lib/required";
import { facturaPendiente, PESTANA_DOCUMENTO_PENDIENTE } from "@/lib/documento-pendiente";
import { PESTANA_ATRASADAS } from "@/lib/atrasadas";
import { PASTILLA_TODAS } from "@/lib/pastillas-de-ordenes";

/**
 * Las filas de la tabla de Órdenes y las cuentas de sus pastillas, **escritas una vez** (D-384).
 *
 * Vivían en dos `useMemo` de la pantalla, uno junto al otro, y cada pastilla con lista propia
 * («Factura pendiente», D-313/D-380; «Outdated», D-384) tenía que acordarse de contar sobre la misma
 * lista de la que luego listaba. Eso es exactamente lo que se rompió dos veces: «Programadas 9» con
 * una fila (D-357) y «Invoice pending 3» con una fila (D-380). Aquí la regla se puede probar con
 * datos —pulsar una pastilla enseña tantas filas como decía su número— en vez de solo leyendo el
 * fuente de la pantalla.
 *
 * Lo que decide **qué** entra en cada lista sigue en `ordenesVisibles`; esto solo elige la lista y
 * le aplica la pastilla y el chip de fecha (`pasaElPreset`), que llega de la pantalla.
 */

export type ListasDeOrdenes = {
  /** La lista normal: sin ninguna atrasada abierta (salvo buscando), D-384/D-NEXT. */
  visibles: readonly Delivery[];
  /**
   * La normal más lo que solo entra por tener factura pendiente (D-313), **cortada a las tiendas de
   * quien mira** (D-NEXT). Solo la usa la pestaña «Factura pendiente».
   */
  conPendientes: readonly Delivery[];
  /** Todas las atrasadas abiertas que la persona ve (`vaAAtrasadas`): ayer incluida. */
  atrasadas: readonly Delivery[];
};

/** Las filas que enseña la tabla con la pastilla `filtro` puesta. */
export function filasDeOrdenes(
  listas: ListasDeOrdenes,
  filtro: string,
  pasaElPreset: (d: Delivery) => boolean,
  reglas: OrderTypeRules,
): Delivery[] {
  // «Outdated» no es una etapa: enseña las atrasadas de TODAS las etapas abiertas.
  if (filtro === PESTANA_ATRASADAS) return listas.atrasadas.filter(pasaElPreset);
  // Tampoco la de factura pendiente: enseña lo pendiente de todas (casi todo está ya entregado).
  if (filtro === PESTANA_DOCUMENTO_PENDIENTE) {
    return listas.conPendientes.filter((d) => facturaPendiente(d, reglas) && pasaElPreset(d));
  }
  return listas.visibles.filter((d) => (filtro === PASTILLA_TODAS || d.stage === filtro) && pasaElPreset(d));
}

/**
 * El número de cada pastilla.
 *
 * «Todas» y las de etapa cuentan la lista normal pasada por el chip de fecha (D-357). Las dos con
 * lista propia cuentan esa lista, y el chip de fecha **solo cuando se está dentro** (D-380): fuera,
 * el número es el aviso de que hay trabajo que la lista normal no enseña; dentro, describe la lista
 * de debajo. Al entrar coinciden, porque entrar pone el chip en «Todas» (`presetAlElegirPastilla`).
 */
export function cuentasDeOrdenes(
  listas: ListasDeOrdenes,
  filtro: string,
  pasaElPreset: (d: Delivery) => boolean,
  reglas: OrderTypeRules,
): Record<string, number> {
  const enElPreset = listas.visibles.filter(pasaElPreset);
  const c: Record<string, number> = { [PASTILLA_TODAS]: enElPreset.length };
  for (const d of enElPreset) c[d.stage] = (c[d.stage] ?? 0) + 1;
  const pendientes = listas.conPendientes.filter((d) => facturaPendiente(d, reglas));
  c[PESTANA_DOCUMENTO_PENDIENTE] = (filtro === PESTANA_DOCUMENTO_PENDIENTE ? pendientes.filter(pasaElPreset) : pendientes).length;
  c[PESTANA_ATRASADAS] = (filtro === PESTANA_ATRASADAS ? listas.atrasadas.filter(pasaElPreset) : listas.atrasadas).length;
  return c;
}
