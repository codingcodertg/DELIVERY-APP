import type { SupabaseClient } from "@supabase/supabase-js";
import { sugerenciaDeLaBase, type Sugerencia } from "./empresas";
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
  /** Migración 189: la cola «Decidir si se juntan», solo las pendientes. Sin la 189, `sinTabla`. */
  sugerencias(): Promise<Res<Sugerencia[]>>;
  /** Juntar las empresas de dos filas (`erp.junta_clientes`): UNA llamada; la base hace todo o nada. Luego se relee. */
  juntar(aId: number, bId: number): Promise<Res<string>>;
  /** «No son la misma» (`erp.rechaza_sugerencia_de_clientes`): no se vuelve a proponer. */
  rechazar(sugerenciaId: number): Promise<Res<null>>;
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
  "history_store, history_group, crm_type_store, crm_type_group, associated_with, rep_history, rep_qb, rep_store, contact_name, contact_title, address, phone, email, " +
  "credit_limit, euler_limit, terms, account_no, notes, updated_at, updated_by, archived_at, archived_reason, company_id";

/** Las tres de la 182 (CRM). El código llega antes que la migración: si la base aún no las tiene, se lee sin ellas. */
export const COLUMNAS_DE_LA_182 = ["crm_type_store", "crm_type_group", "associated_with"] as const;
/** La de la 189 (la empresa). Igual: si la base aún no la tiene, se lee sin ella y cada fila es su propia empresa. */
export const COLUMNAS_DE_LA_189 = ["company_id"] as const;
const sin = (fuera: readonly string[]) => COLUMNAS.split(",").map((c) => c.trim()).filter((c) => !fuera.includes(c)).join(", ");
export const COLUMNAS_SIN_189 = sin(COLUMNAS_DE_LA_189);
export const COLUMNAS_SIN_182 = sin([...COLUMNAS_DE_LA_182, ...COLUMNAS_DE_LA_189]);

/** ¿«La 182 no está aplicada»? 42703 es undefined_column (Postgres); PGRST204 es lo mismo dicho por PostgREST. Solo esos. */
export function faltaLa182(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "42703" || code === "PGRST204";
}

/**
 * Una lectura con respaldo: con las columnas de hoy, y si la base dice que una no existe, otra vez sin la de la 189
 * (`company_id`: cada fila, su empresa), y si aún falta, también sin las tres de la 182 (llegan como null). Así la lista
 * no se queda en blanco el rato entre el deploy y la migración. Una escritura con `.select(cols)` falla ENTERA si una
 * columna pedida no existe (no escribe nada), así que también se puede repetir así.
 */
export async function leeConRespaldo<T>(consulta: (columnas: string) => PromiseLike<{ data: T; error: { code?: string | null; message: string } | null }>) {
  const r = await consulta(COLUMNAS);
  if (!(r.error && faltaLa182(r.error))) return r;
  const r2 = await consulta(COLUMNAS_SIN_189);
  if (r2.error && faltaLa182(r2.error)) return consulta(COLUMNAS_SIN_182);
  return r2;
}

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
        const { data, error } = await leeConRespaldo((cols) => sb.from("customers").select(cols).order("account").order("id").range(p * PAGINA, (p + 1) * PAGINA - 1));
        if (error) return fallo(error);
        for (const f of data ?? []) todos.push(clienteDeLaBase(f as unknown as Record<string, unknown>));
        if ((data ?? []).length < PAGINA) break;
      }
      return { ok: true, valor: todos };
    },
    async guardar(id, parche) {
      const { data, error } = await leeConRespaldo((cols) => sb.from("customers").update(parche).eq("id", id).select(cols).maybeSingle());
      if (error) return fallo(error);
      if (!data) return sinFila();
      return { ok: true, valor: clienteDeLaBase(data as unknown as Record<string, unknown>) };
    },
    async crear(fila) {
      const { data, error } = await leeConRespaldo((cols) => sb.from("customers").insert(fila).select(cols).maybeSingle());
      if (error) return fallo(error);
      if (!data) return sinFila();
      return { ok: true, valor: clienteDeLaBase(data as unknown as Record<string, unknown>) };
    },
    async sugerencias() {
      const { data, error } = await sb.from("customer_merge_suggestions")
        .select("id, a_id, b_id, reason, score, status, created_at").eq("status", "pending").order("id").range(0, 4999);
      if (error) return fallo(error);
      return { ok: true, valor: (data ?? []).map((f) => sugerenciaDeLaBase(f as Record<string, unknown>)) };
    },
    async juntar(aId, bId) {
      const { data, error } = await sb.rpc("junta_clientes", { p_a: aId, p_b: bId });
      if (error) return fallo(error);
      if (!data) return sinFila();
      return { ok: true, valor: String(data) };
    },
    async rechazar(sugerenciaId) {
      const { error } = await sb.rpc("rechaza_sugerencia_de_clientes", { p_id: sugerenciaId });
      if (error) return fallo(error);
      return { ok: true, valor: null };
    },
  };
}

/** Cuántas sugerencias pendientes hay (la pastilla de la barra). null = no se sabe (sin la 189, sin permiso, error). */
export async function cuentaPendientes(sb: SupabaseClient<any, "erp", "erp">): Promise<number | null> {
  const { count, error } = await sb.from("customer_merge_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending");
  return error ? null : count ?? 0;
}
