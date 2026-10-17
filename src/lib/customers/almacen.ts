import type { SupabaseClient } from "@supabase/supabase-js";
import { clienteDeLaBase, type Cliente, type Parche } from "./reglas";

/**
 * Dónde viven los clientes: `erp.customers` (migración 180). Una interfaz con dos implementaciones —la base y el
 * demo— para que la pantalla sea la misma en las dos.
 *
 * **Se lee y se escribe con la sesión de quien mira**, con el cliente del ERP (esquema `erp`): la política decide
 * (`has_customers_access()` para leer, `erp.customers_can_write()` para escribir). Un UPDATE que la política no deja
 * pasar NO es un error para PostgREST: vuelve con cero filas. Por eso cada escritura pide la fila de vuelta
 * (`.select()`), y «cero filas» se cuenta como «no se guardó» y se dice.
 *
 * Sin la 180 aplicada (el código llega antes que la migración) se devuelve `sinTabla` y la pantalla lo dice.
 */
export type Res<T> = { ok: true; valor: T } | { ok: false; sinTabla: boolean; sinPermiso: boolean; duplicado: boolean; error: string };

export interface AlmacenDeClientes {
  leer(): Promise<Res<Cliente[]>>;
  guardar(id: number, parche: Parche): Promise<Res<Cliente>>;
  crear(fila: Parche): Promise<Res<Cliente>>;
}

/** ¿Es «la 180 no está aplicada»? PGRST205 (tabla) de PostgREST; 42P01 de Postgres. Solo esos. */
export function faltaLaTabla(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "PGRST205" || code === "42P01";
}

/** ¿La base dijo que no por permisos? 42501 es insufficient_privilege (también lo que lanza una política RLS al escribir). */
export function esSinPermiso(error: { code?: string | null; message?: string } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "42501" || /row-level security|permission denied/i.test(error?.message ?? "");
}

/** Las columnas que la pantalla usa. */
export const COLUMNAS =
  "id, store, account, unified_account, house_no, added_batch, qb_status, activity_status, status_store, status_group, " +
  "history_store, history_group, rep_history, rep_qb, rep_store, contact_name, contact_title, address, phone, email, " +
  "credit_limit, euler_limit, terms, account_no, notes, updated_at, updated_by, archived_at, archived_reason";

/** PostgREST corta en 1.000 filas por petición: se pagina hasta que una página venga corta. */
export const PAGINA = 1000;
export const MAX_PAGINAS = 20;

/** La clave natural (tienda + cuenta) ya existe: 23505 es unique_violation. */
export function esDuplicado(error: { code?: string | null } | null | undefined): boolean {
  return (error?.code ?? "") === "23505";
}

const fallo = (error: { code?: string | null; message: string }): Res<never> =>
  ({ ok: false, sinTabla: faltaLaTabla(error), sinPermiso: esSinPermiso(error), duplicado: esDuplicado(error), error: error.message });

/** Cero filas de vuelta: la política no dejó pasar la escritura (o la fila ya no existe). PostgREST no lo cuenta como error. */
const sinFila = (): Res<never> => ({ ok: false, sinTabla: false, sinPermiso: true, duplicado: false, error: "not saved: no row came back" });

// El cliente del ERP (esquema `erp`): su tipo lleva el esquema, y el de Entregas no vale.
export function almacenDeLaBase(sb: SupabaseClient<any, "erp", "erp">): AlmacenDeClientes {
  return {
    async leer() {
      const todos: Cliente[] = [];
      for (let p = 0; p < MAX_PAGINAS; p++) {
        const { data, error } = await sb.from("customers").select(COLUMNAS).order("account").order("id").range(p * PAGINA, (p + 1) * PAGINA - 1);
        if (error) return fallo(error);
        for (const f of data ?? []) todos.push(clienteDeLaBase(f as unknown as Record<string, unknown>));
        if ((data ?? []).length < PAGINA) break;
      }
      return { ok: true, valor: todos };
    },
    async guardar(id, parche) {
      const { data, error } = await sb.from("customers").update(parche).eq("id", id).select(COLUMNAS).maybeSingle();
      if (error) return fallo(error);
      if (!data) return sinFila();
      return { ok: true, valor: clienteDeLaBase(data as unknown as Record<string, unknown>) };
    },
    async crear(fila) {
      const { data, error } = await sb.from("customers").insert(fila).select(COLUMNAS).maybeSingle();
      if (error) return fallo(error);
      if (!data) return sinFila();
      return { ok: true, valor: clienteDeLaBase(data as unknown as Record<string, unknown>) };
    },
  };
}
