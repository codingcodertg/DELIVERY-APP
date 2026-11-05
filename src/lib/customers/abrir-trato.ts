/**
 * D-NEXT: una fila del historial del cliente (D-874) se abre AQUÍ, en una tarjeta, no saltando a otra app.
 *
 * El dueño: «when I clicked the order there, instead of taking me to Deliveries, I want the order form to open right there
 * as a card, like I always ask you». Regla del hub: un registro se abre en su sitio (tarjeta o modal); el enlace a su app
 * queda como acción SECUNDARIA dentro de la tarjeta.
 *
 * Lo puro de esa decisión vive aquí (con pruebas): qué tarjeta se abre según quién mira, qué consultas del proveedor de
 * Entregas hacen falta para UNA orden, y qué fila de la lista es la de la tarjeta.
 */
import { normalizeModules, tieneAccesoAEntregas } from "@/lib/constants";
import type { UserRole } from "@/lib/types";
import type { Trato } from "./tratos";

export interface QuienMira { role: UserRole; module_access?: string[] | null }

/** ¿Puede entrar en el Quote Builder? El espejo de la puerta de `estimator/layout.tsx`. */
export function tieneAccesoAlCotizador(u: QuienMira): boolean {
  return u.role === "admin" || normalizeModules(u.module_access).includes("estimator");
}

export type ModoDeLaTarjeta =
  /** La ficha de verdad de Entregas (OrderModal), con sus permisos y acciones. */
  | "orden"
  /** Sin el módulo de Entregas: un resumen de solo lectura con la explicación; nunca la ficha. */
  | "orden-solo-lectura"
  /** La hoja del cliente de la cotización, de solo lectura. */
  | "cotizacion";

export interface ComoSeAbre {
  modo: ModoDeLaTarjeta;
  /** El enlace secundario «Abrir en Entregas / Cotizador», o null si quien mira no puede entrar en esa app. */
  enlace: string | null;
}

/** Cómo se abre una fila del historial para esta persona. */
export function comoAbrirTrato(trato: Pick<Trato, "clase" | "href">, quien: QuienMira): ComoSeAbre {
  if (trato.clase === "cotizacion") return { modo: "cotizacion", enlace: tieneAccesoAlCotizador(quien) ? trato.href : null };
  return tieneAccesoAEntregas(quien) ? { modo: "orden", enlace: trato.href } : { modo: "orden-solo-lectura", enlace: null };
}

/**
 * Las consultas del `DataProvider` de Entregas que hacen falta para la ficha de UNA orden. El resto (avisos, turnos,
 * disponibilidad, incidentes, ubicaciones) no lo lee la ficha y no se baja: Clientes no carga el conjunto de Entregas.
 */
export const CONSULTAS_DE_UNA_ORDEN: readonly string[] = ["settings", "profiles", "deliveries", "order_events"];

export function pideEnUnaOrden(consulta: string): boolean {
  return CONSULTAS_DE_UNA_ORDEN.includes(consulta);
}

/** ¿Esta fila (orden o evento) es de la orden de la tarjeta? Lo que llegue por realtime y no lo sea, no entra. */
export function esDeLaOrden(soloOrden: string, fila: { id?: string; delivery_id?: string | null }): boolean {
  return fila.delivery_id !== undefined ? fila.delivery_id === soloOrden : fila.id === soloOrden;
}

/**
 * La orden de la tarjeta dentro de lo que cargó el proveedor. En el demo (sin base) las filas del historial son de muestra
 * (`demo-o-…`) y no existen en los datos locales de Entregas: se enseña la primera orden del demo, para ver la ficha.
 */
export function ordenDeLaTarjeta<D extends { id: string }>(ordenes: readonly D[], id: string, demo = false): D | null {
  const exacta = ordenes.find((o) => o.id === id);
  if (exacta) return exacta;
  return demo && id.startsWith("demo-o-") ? ordenes[0] ?? null : null;
}
