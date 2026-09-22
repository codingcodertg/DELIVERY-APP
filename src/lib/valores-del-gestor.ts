/**
 * Lo que cada columna del Gestor de Rutas saca de una orden para ORDENAR y FILTRAR (D-NEXT).
 *
 * Las celdas de «Programadas» y «Sin asignar» se pintan en la página (`routes/page.tsx`) y ahí hay JSX, color y
 * títulos. Pero el menú de columna (el de Órdenes, D-275) no compara lo pintado: compara un valor crudo por fila
 * —un número o un texto, o nulo si la orden no lo tiene—. Ese valor se decide aquí, por clave de columna, para que
 * las dos tablas usen el mismo y se pueda probar sin navegador.
 *
 * Una columna cuyo valor depende del estado de la página (la carga y la parada, que salen de cómo quedó repartido
 * el día) lo recibe por el contexto; las demás lo leen de la orden.
 */

import { stageLabel } from "@/lib/constants";
import { fmtDate, orderLabel } from "@/lib/utils";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";
import type { Delivery } from "@/lib/types";

export type ContextoDelGestor = {
  lang: "en" | "es";
  /** El número de viaje de una programada, o nulo si es una ruta temporal (ahí la tabla pinta «—»). */
  cargaDe: (d: Delivery) => number | null;
  /** El puesto de la orden en la ruta de su chofer (1 = primera), o nulo si aún no tiene secuencia. */
  paradaDe: (d: Delivery) => number | null;
};

/** La clave de la columna fija del código de orden, la misma que usa Órdenes para su pseudo-columna. */
export const CLAVE_ID = "__id";

/**
 * El valor crudo de la columna `clave` para la orden `d`. Texto vacío cuenta como «sin valor» (lo decide
 * `claveDeFiltro`), así que aquí no hace falta convertir «» en nulo.
 */
export function valorDelGestor(clave: string, d: Delivery, ctx: ContextoDelGestor): ValorDeCelda {
  switch (clave) {
    case CLAVE_ID: return orderLabel(d);
    case "invoice": return d.invoice_num ?? null;
    case "account": return d.account ?? null;
    case "address": return d.delivery_address ?? null;
    // La celda pinta el nombre del punto de recogida y, si no lo hay, la dirección: se ordena por lo que se ve.
    case "pickup": return d.pickup_name || d.pickup_address || null;
    case "store": return d.store ?? null;
    case "driver": return d.assigned_driver ?? null;
    case "load": return ctx.cargaDe(d);
    case "stop": return ctx.paradaDe(d);
    // El real manda sobre el estimado, como en la celda y como en Órdenes.
    case "pallets": return d.actual_pallets ?? d.est_pallets ?? null;
    case "date": return d.delivery_date ?? null;
    case "windows": return d.delivery_windows ?? null;
    // La etapa se ordena y se filtra por su nombre en el idioma de quien mira, que es lo que lee en la lista.
    case "status": return stageLabel(d.stage, ctx.lang);
    default: return null;
  }
}

/** Cómo se enseña un valor en la lista del filtro: la fecha ISO, formateada; lo demás, tal cual. */
export function etiquetaDelGestor(clave: string): ((v: ValorDeCelda) => string) | undefined {
  return clave === "date" ? (v) => fmtDate(v == null ? null : String(v)) : undefined;
}
