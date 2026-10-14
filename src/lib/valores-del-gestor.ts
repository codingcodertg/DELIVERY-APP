/**
 * Lo que cada columna del Gestor de Rutas saca de una orden para ORDENAR y FILTRAR (D-360).
 *
 * Las celdas de «Sin asignar» se pintan en la página (`routes/page.tsx`) y ahí hay JSX, color y títulos. Pero el menú
 * de columna (el de Órdenes, D-275) no compara lo pintado: compara un valor crudo por fila —un número o un texto, o
 * nulo si la orden no lo tiene—. Ese valor se decide aquí, por clave de columna, para poder probarlo sin navegador.
 *
 * Las columnas que el Gestor toma de Órdenes (D-376: tipo, SO, PO, costo, contacto, etapa) no tienen caso propio:
 * su valor es el de la columna de Órdenes, que la página pasa en `ordenes`. Así se ordena y se filtra igual que allí.
 *
 * D-376 también quitó la pestaña «Programadas», y con ella el chofer, la carga y la parada, que solo salían ahí.
 *
 * D-408 quitó la columna fija del ID (el código de orden): su valor (`__id`) ya no existe. La factura es la que abre la
 * orden (`textoQueAbreLaOrden`).
 */

import { fmtDate, orderLabel } from "@/lib/utils";
import { columnaDeOrdenes } from "@/lib/routes-columns";
import { ciudadDeEntrega } from "@/lib/ciudad-de-entrega";
import { horaReal } from "@/lib/hechas-del-gestor";
import { ETAPAS_HECHAS } from "@/lib/mover-parada";
import { zonaDeLaRecogida } from "@/lib/zonas";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";
import type { Delivery, NamedLocation } from "@/lib/types";

/** Lo que la página sabe de las columnas de Órdenes: su catálogo y el contexto con que se llaman. */
export interface DeOrdenes<C> {
  catalogo: readonly { key: string; value: (d: Delivery, ctx: C) => ValorDeCelda; filterLabel?: (v: ValorDeCelda) => string }[];
  ctx: C;
}

/**
 * Lo que se lee en el enlace que ABRE la orden en las dos tablas del Gestor (D-408): la factura. El dueño, el 2026-09-26:
 * «routes manager doesn't need to see id», y la columna del código de orden (`#1234`, antes `__id`) se quitó. Una orden sin
 * factura (una Intertienda, un borrador) enseña su código, en gris (`esFactura: false`): es la misma regla que el «#» de
 * Órdenes (`invoice_num || orderLabel`), y sin ella esa fila no tendría nada que pulsar para abrirla.
 */
export function textoQueAbreLaOrden(d: Pick<Delivery, "invoice_num" | "order_code" | "order_no" | "order_suffix">): { texto: string; esFactura: boolean } {
  const factura = (d.invoice_num ?? "").trim();
  return factura ? { texto: factura, esFactura: true } : { texto: `#${orderLabel(d)}`, esFactura: false };
}

/** Lo que dos columnas de paradas necesitan saber de la pantalla para dar su valor (D-548): las tiendas (la ciudad de
 *  recogida) y la llegada que pinta la celda (`llegadaEnLasOrdenes`). */
export interface ExtraDeParadas {
  tiendas?: readonly Pick<NamedLocation, "name" | "address" | "lat" | "lng">[];
  llegada?: (d: Delivery) => string | null;
}

/**
 * La «Llegada» (`p_eta`) de una orden en «Sin asignar» y en «Todas» (D-548), la misma columna que en la tabla de paradas.
 * `null` = la celda pinta «—».
 *
 *   · Ya entregada: «✓ 10:42» —la hora real, como su fila hecha en la tarjeta del chofer (D-459)—, o «✓ entregada» sin hora.
 *   · Recogida, en el camión: «🚚 en camino», como allí.
 *   · Sin chofer: nada. No está en ninguna ruta, así que no hay a qué hora llegue.
 *   · Con chofer y pendiente: la llegada que la medida de su ruta calculó para ella (`eta`), si la hay; nunca una inventada.
 */
export function llegadaEnLasOrdenes(
  d: Pick<Delivery, "assigned_driver" | "stage" | "pod_delivered_at"> & { pickup_gps_at?: string | null },
  eta: string | null | undefined,
  es: boolean,
): string | null {
  if (d.stage === "delivered") { const hora = horaReal(d, "D"); return `✓ ${hora ?? (es ? "entregada" : "delivered")}`; }
  if (ETAPAS_HECHAS.has(d.stage)) return `🚚 ${es ? "en camino" : "on its way"}`;
  if (!d.assigned_driver) return null;
  return eta || null;
}

/**
 * El valor crudo de la columna `clave` para la orden `d`. Texto vacío cuenta como «sin valor» (lo decide
 * `claveDeFiltro`), así que aquí no hace falta convertir «» en nulo.
 */
export function valorDelGestor<C>(clave: string, d: Delivery, ordenes?: DeOrdenes<C>, ciudadesConocidas: readonly string[] = [], extra?: ExtraDeParadas): ValorDeCelda {
  const deOrdenes = ordenes ? columnaDeOrdenes(clave, ordenes.catalogo) : undefined;
  if (deOrdenes) return deOrdenes.value(d, ordenes!.ctx);
  switch (clave) {
    // Las de la tabla de paradas (D-548), que desde ahora pintan también «Sin asignar» y «Todas». Ordenan y filtran por
    // lo que se ve en su celda: el tipo, la ciudad de la tienda donde se recoge, la ciudad de entrega, la llegada y las ventanas.
    case "p_type": return d.order_type ?? null;
    case "p_ciudad_recogida": return zonaDeLaRecogida(d, extra?.tiendas ?? [], ciudadesConocidas) || null;
    case "p_address": return ciudadDeEntrega(d.delivery_address, ciudadesConocidas) || null;
    case "p_eta": return extra?.llegada?.(d) ?? null;
    case "p_windows": return d.delivery_windows ?? null;
    case "invoice": return d.invoice_num ?? null;
    case "account": return d.account ?? null;
    // La columna enseña solo la CIUDAD desde D-408 («Ciudad de entrega»): ordena y filtra por ella, no por la calle.
    // Con las mismas ciudades conocidas que la celda (D-423): una dirección sin comas se ordena por la ciudad que se ve.
    case "address": return ciudadDeEntrega(d.delivery_address, ciudadesConocidas) || null;
    // La celda pinta el nombre del punto de recogida y, si no lo hay, la dirección: se ordena por lo que se ve.
    case "pickup": return d.pickup_name || d.pickup_address || null;
    case "store": return d.store ?? null;
    // El real manda sobre el estimado, como en la celda y como en Órdenes.
    case "pallets": return d.actual_pallets ?? d.est_pallets ?? null;
    case "date": return d.delivery_date ?? null;
    case "windows": return d.delivery_windows ?? null;
    default: return null;
  }
}

/** Cómo se enseña un valor en la lista del filtro: el de Órdenes para las que vienen de allí (el costo, como dinero);
 *  la fecha ISO, formateada; lo demás, tal cual. */
export function etiquetaDelGestor<C>(clave: string, ordenes?: DeOrdenes<C>): ((v: ValorDeCelda) => string) | undefined {
  const deOrdenes = ordenes ? columnaDeOrdenes(clave, ordenes.catalogo) : undefined;
  if (deOrdenes) return deOrdenes.filterLabel;
  return clave === "date" ? (v) => fmtDate(v == null ? null : String(v)) : undefined;
}
