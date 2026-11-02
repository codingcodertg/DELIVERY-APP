import type { UserRole } from "@/lib/types";
import { TIENDAS } from "./reglas";

/**
 * QUIÉN VE QUÉ CLIENTE: la regla de la app de Clientes, en un solo sitio (D-793, 2026-11-01).
 *
 * El dueño: «el quote builder la regla de customer debe ir totalmente ligada al customer app, y así en todas las apps».
 * La regla la decide la base —`erp.customers_ve_la_fila(rep_id, created_by, store)`, migración 217— con la sesión real.
 * Este fichero es su gemelo en TypeScript, para las pantallas que enseñan clientes con una sesión que NO es la de quien
 * mira (un admin que entra «como» un vendedor consulta con la sesión del admin) y para que ninguna app vuelva a escribir
 * su propia versión. Si la 217 cambia, cambia esto, y la prueba de al lado (que lee la 217) lo recuerda.
 *
 *   admin → todo
 *   los demás → los de SU tienda (el `store` del perfil, que es un nombre, contra el código de la fila)
 *   y el vendedor (`sales`), además, los suyos: por `rep_id` o por `created_by`
 *   sin tienda en el perfil → nada (salvo los suyos, si es vendedor)
 */
export type QuienMira = { id: string; role: UserRole | null | undefined; store: string | null | undefined };
export type FilaDeCliente = { store: string | null | undefined; rep_id: string | null | undefined; created_by: string | null | undefined };

/** El código (BRO, MCA…) de la tienda del perfil, que es un NOMBRE («RDZ Brownsville»): el mapa de `TIENDAS`, como
 *  `erp.customers_codigo_de_tienda`. Acepta ya el código. Vacío = sin tienda. */
export function codigoDeTiendaDelPerfil(store: string | null | undefined): string {
  const s = (store ?? "").trim().toLowerCase();
  if (!s) return "";
  return TIENDAS.find((t) => t.code.toLowerCase() === s || t.nombre.toLowerCase() === s)?.code ?? s.toUpperCase();
}

/** Gemelo de `erp.customers_ve_la_fila` (217). */
export function veLaFila(c: FilaDeCliente, yo: QuienMira): boolean {
  if (yo.role === "admin") return true;
  const mia = codigoDeTiendaDelPerfil(yo.store);
  if (mia && (c.store ?? "").trim().toUpperCase() === mia) return true;
  return yo.role === "sales" && ((!!c.rep_id && c.rep_id === yo.id) || (!!c.created_by && c.created_by === yo.id));
}

/** Las filas que esta persona ve, con la misma regla. */
export function filasQueVe<T extends FilaDeCliente>(filas: readonly T[], yo: QuienMira): T[] {
  return filas.filter((c) => veLaFila(c, yo));
}
