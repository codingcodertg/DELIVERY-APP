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
 */

import { fmtDate, orderLabel } from "@/lib/utils";
import { columnaDeOrdenes } from "@/lib/routes-columns";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";
import type { Delivery } from "@/lib/types";

/** Lo que la página sabe de las columnas de Órdenes: su catálogo y el contexto con que se llaman. */
export interface DeOrdenes<C> {
  catalogo: readonly { key: string; value: (d: Delivery, ctx: C) => ValorDeCelda; filterLabel?: (v: ValorDeCelda) => string }[];
  ctx: C;
}

/** La clave de la columna fija del código de orden, la misma que usa Órdenes para su pseudo-columna. */
export const CLAVE_ID = "__id";

/**
 * El valor crudo de la columna `clave` para la orden `d`. Texto vacío cuenta como «sin valor» (lo decide
 * `claveDeFiltro`), así que aquí no hace falta convertir «» en nulo.
 */
export function valorDelGestor<C>(clave: string, d: Delivery, ordenes?: DeOrdenes<C>): ValorDeCelda {
  const deOrdenes = ordenes ? columnaDeOrdenes(clave, ordenes.catalogo) : undefined;
  if (deOrdenes) return deOrdenes.value(d, ordenes!.ctx);
  switch (clave) {
    case CLAVE_ID: return orderLabel(d);
    case "invoice": return d.invoice_num ?? null;
    case "account": return d.account ?? null;
    case "address": return d.delivery_address ?? null;
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
