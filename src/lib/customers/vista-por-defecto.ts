import { claveDeFiltro, type FiltrosPorColumna } from "@/lib/orden-y-filtro";
import type { TamanoDeTabla } from "@/lib/mostrar-n";
import { estaArchivado, valorDeColumna, type Cliente } from "./reglas";

/**
 * Cómo ABRE la lista de Clientes. El dueño, 2026-11-05: «in Customers, for users the default should be that they see
 * THEIR customers, sorted ascending, and the default view will be 10».
 *
 * - Quien no es admin entra viendo SUS clientes (los que lo tienen de vendedor de comisión, `rep_id`). Es el filtro de
 *   la columna «Vendedor de comisión» de siempre, ya puesto: se ve en «Filtrado por», en el ▾ de la columna, y se quita
 *   con «Quitar filtros». No es un permiso: lo que deja ver la base (RLS) no cambia.
 * - El admin (también el admin solo de Clientes, `customers_role`) entra viendo todos.
 * - Quien no tiene ningún cliente asignado entra viendo todos: un filtro que lo esconde todo de entrada no ayuda.
 * - El orden de entrada ya era Cuenta ↑ (`ORDEN_INICIAL`), y la tabla enseña 10 filas hasta que la persona elige otro tamaño.
 *
 * Puro, sin navegador: lo prueba `vista-por-defecto.test.ts`.
 */
export const TAMANO_INICIAL_DE_CLIENTES: TamanoDeTabla = 10;

/** El filtro de columna con que entra quien mira: «Vendedor de comisión = yo» si no es admin y tiene clientes vivos; si no, ninguno. */
export function filtrosDeEntrada(lista: readonly Cliente[], yo: string, esAdmin: boolean): FiltrosPorColumna {
  if (esAdmin || !yo) return {};
  // El valor es el que filtra la columna (el nombre del vendedor, D-683), sacado de sus propias filas.
  const mios = new Set(lista.filter((c) => c.rep_id === yo && !estaArchivado(c)).map((c) => claveDeFiltro(valorDeColumna(c, "rep_id"))));
  return mios.size ? { rep_id: mios } : {};
}

/** ¿Está puesto el filtro de vendedor? Con la tabla vacía, se ofrece «Ver todos» a un clic. */
export function filtraPorVendedor(filtros: FiltrosPorColumna): boolean {
  return (filtros.rep_id?.size ?? 0) > 0;
}
