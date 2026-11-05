import type { SupabaseClient } from "@supabase/supabase-js";
import { nombraLaColumna } from "@/lib/columnas-opcionales";
import { COLUMNAS_DE_COTIZACION, COLUMNAS_DE_ORDEN, patronExacto, tratoDeCotizacion, tratoDeOrden, type Trato } from "./tratos";

/**
 * Lee el historial principal (D-874, 245) con la sesión de quien mira: la RLS de `public.deliveries` y de
 * `public.estimator_quotes` decide qué filas llegan. Cada fuente va por su lado: si una falla (sin permiso, sin tabla),
 * la otra se enseña igual y se dice cuál faltó.
 *
 * Sin la 245 (`customer_id` no existe: 42703 / PGRST204 nombrándola) se cae al nombre: `account` de la orden, o la
 * empresa del cliente de la cotización, igual a la cuenta (sin mayúsculas). `unidos` dice cuál de los dos caminos se usó.
 */
export interface TratosLeidos { tratos: Trato[]; unidos: boolean; fallan: ("orden" | "cotizacion")[] }

export const LIMITE_DE_TRATOS = 300;

type Lectura = { data: unknown; error: { code?: string; message: string } | null };
const faltaCustomerId = (e: Lectura["error"]) => !!e && (e.code === "42703" || e.code === "PGRST204") && nombraLaColumna(e.message, "customer_id");

export async function leeTratos(sb: SupabaseClient<any, any, any>, cliente: { id: number; account: string }): Promise<TratosLeidos> {
  const pub = sb.schema("public");
  // Sin la 245 se busca por el nombre; un nombre en blanco casaría con las órdenes sin cuenta: nada.
  const vacio: Lectura = { data: [], error: null };
  const conNombre = !!cliente.account.trim();
  const fallan: TratosLeidos["fallan"] = [];
  let unidos = true;

  let o: Lectura = await pub.from("deliveries").select(COLUMNAS_DE_ORDEN).eq("customer_id", cliente.id)
    .order("created_at", { ascending: false }).range(0, LIMITE_DE_TRATOS - 1);
  if (faltaCustomerId(o.error)) {
    unidos = false;
    o = !conNombre ? vacio : await pub.from("deliveries").select(COLUMNAS_DE_ORDEN).ilike("account", patronExacto(cliente.account))
      .order("created_at", { ascending: false }).range(0, LIMITE_DE_TRATOS - 1);
  }
  const ordenes = o.error ? (fallan.push("orden"), []) : ((o.data ?? []) as Record<string, unknown>[])
    .filter((f) => f.is_training !== true).map(tratoDeOrden);

  let q: Lectura = await pub.from("estimator_quotes").select(COLUMNAS_DE_COTIZACION).eq("customer_id", cliente.id)
    .order("created_at", { ascending: false }).range(0, LIMITE_DE_TRATOS - 1);
  if (faltaCustomerId(q.error)) {
    unidos = false;
    q = !conNombre ? vacio : await pub.from("estimator_quotes").select(COLUMNAS_DE_COTIZACION).ilike("customer->>company", patronExacto(cliente.account))
      .order("created_at", { ascending: false }).range(0, LIMITE_DE_TRATOS - 1);
  }
  const cotizaciones = q.error ? (fallan.push("cotizacion"), []) : ((q.data ?? []) as Record<string, unknown>[]).map(tratoDeCotizacion);

  return { tratos: [...ordenes, ...cotizaciones], unidos, fallan };
}
