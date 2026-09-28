import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstimadoHallado, AprobacionEstado } from "./validar";
import {
  DEFAULT_DISPLAY_LEVEL, DEFAULT_SALUTATION, DISPLAY_LEVELS, SALUTATIONS, hoyLocal,
  type Customer, type Delivery, type DisplayLevel, type QuoteDraft, type QuoteLine,
} from "./modelo";

/**
 * Dónde se guardan las cotizaciones: `public.estimator_quotes` y `public.estimator_approvals`
 * (migración 148). Una interfaz con dos implementaciones —la base y el demo— para que la pantalla
 * sea la misma en las dos.
 *
 * **La pantalla tiene que funcionar sin la tabla**, igual que la prioridad funcionaba sin la 147: el
 * código llega a producción antes de que se aplique la migración. Si la tabla no está, buscar
 * devuelve `sinTabla` y la pantalla se queda en «se puede armar e imprimir, pero no guardar», y lo
 * dice. Cualquier OTRO error se enseña como error: confundir «no hay tabla» con «falló la red»
 * escondería una avería detrás de un aviso tranquilo.
 */

export type Resultado<T> = { ok: true; valor: T } | { ok: false; sinTabla: boolean; error: string; duplicado?: boolean };

export interface CotizacionGuardada {
  id: string;
  owner_id: string | null;
  owner_name: string | null;
  print_count: number;
  draft: QuoteDraft;
}

export interface AprobacionPendiente {
  approval_id: string;
  quote_id: string;
  estimate_num: string;
  requester_name: string | null;
  requested_at: string;
}

export interface AlmacenDeCotizaciones {
  buscar(num: string): Promise<Resultado<EstimadoHallado | null>>;
  cargar(quoteId: string): Promise<Resultado<CotizacionGuardada>>;
  /** Nuevo si `quoteId` es null. Devuelve el id: sin id de vuelta, «guardado» sería una suposición. */
  guardar(quoteId: string | null, draft: QuoteDraft): Promise<Resultado<string>>;
  pedirAprobacion(quoteId: string, approvalId: string | null): Promise<Resultado<AprobacionEstado>>;
  pendientes(): Promise<Resultado<AprobacionPendiente[]>>;
  decidir(approvalId: string, estado: "approved" | "denied"): Promise<Resultado<null>>;
  marcarImpresa(quoteId: string, printCount: number): Promise<Resultado<null>>;
}

/**
 * ¿Este error es «la 148 no está aplicada»? PostgREST dice PGRST205 (tabla) o PGRST202 (función)
 * cuando no la encuentra en su caché; Postgres, 42P01 / 42883. Solo esos.
 */
export function faltaLaTabla(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  return code === "PGRST205" || code === "PGRST202" || code === "42P01" || code === "42883";
}

type ErrorPg = { code?: string | null; message?: string | null } | null;
function fallo<T>(error: ErrorPg): Resultado<T> {
  return {
    ok: false,
    sinTabla: faltaLaTabla(error),
    duplicado: error?.code === "23505",
    error: error?.message ?? "error",
  };
}

// ---- de la fila al borrador y de vuelta ------------------------------------------------------

const texto = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Lee un `jsonb` que viene de la base sin fiarse de su forma: una fila vieja o tocada a mano no revienta la pantalla. */
export function borradorDeFila(fila: Record<string, unknown>): QuoteDraft {
  const c = (fila.customer ?? {}) as Record<string, unknown>;
  const d = (fila.delivery ?? {}) as Record<string, unknown>;
  const customer: Customer = {
    salutation: (SALUTATIONS as readonly string[]).includes(texto(c.salutation)) ? (c.salutation as Customer["salutation"]) : DEFAULT_SALUTATION,
    full_name: texto(c.full_name),
    // `last_name` / `last_name_edited` de las filas guardadas antes de D-432 se ignoran a propósito: el apellido que se
    // imprime sale del nombre completo, que sí se ve y se corrige en pantalla.
    company: texto(c.company),
    phone: texto(c.phone),
    address: texto(c.address),
  };
  const delivery: Delivery = {
    mode: d.mode === "delivery" ? "delivery" : "pickup",
    street: texto(d.street), city: texto(d.city), state: texto(d.state), zip: texto(d.zip),
    charge: num(d.charge),
  };
  const crudas = Array.isArray(fila.lines) ? (fila.lines as Record<string, unknown>[]) : [];
  const lines: QuoteLine[] = crudas.map((l, i) => {
    const comun = {
      id: texto(l.id) || `f${i}`,
      item_code: texto(l.item_code),
      internal_description: texto(l.internal_description),
      customer_category: texto(l.customer_category),
      customer_note: texto(l.customer_note),
    };
    if (l.kind === "unit") {
      return { kind: "unit", ...comun, quantity: num(l.quantity), unit: texto(l.unit) || "Lot", unit_price: num(l.unit_price) };
    }
    return {
      kind: "sf", ...comun,
      requested_sf: num(l.requested_sf), boxes: num(l.boxes), sf_per_box: num(l.sf_per_box), price_per_sf: num(l.price_per_sf),
    };
  });
  const nivel = texto(fila.display_level);
  return {
    estimate_num: texto(fila.estimate_num),
    sales_ext: texto(fila.sales_ext),
    customer,
    delivery,
    lines,
    display_level: (DISPLAY_LEVELS as readonly string[]).includes(nivel) ? (nivel as DisplayLevel) : DEFAULT_DISPLAY_LEVEL,
    valid_through: texto(fila.valid_through) || hoyLocal(),
    project_summary: texto(fila.project_summary),
  };
}

/**
 * Las columnas que el cliente escribe. **No** van `owner_id`, `prepared_by`, `store` ni las fechas:
 * esas las pone el disparador de la 148 con `auth.uid()`, y mandarlas sería invitar a la base a
 * creerse un dueño que dice el navegador.
 */
export function filaDeBorrador(d: QuoteDraft) {
  return {
    estimate_num: d.estimate_num.trim(),
    sales_ext: d.sales_ext.trim(),
    customer: d.customer,
    delivery: d.delivery,
    lines: d.lines,
    display_level: d.display_level,
    valid_through: d.valid_through,
    project_summary: d.project_summary,
  };
}

// ---- la base -----------------------------------------------------------------------------------

export function almacenDeLaBase(supabase: SupabaseClient): AlmacenDeCotizaciones {
  return {
    async buscar(numero) {
      const { data, error } = await supabase.rpc("estimator_find_estimate", { p_num: numero.trim() });
      if (error) return fallo(error);
      const filas = (data ?? []) as EstimadoHallado[];
      return { ok: true, valor: filas[0] ?? null };
    },

    async cargar(quoteId) {
      const { data, error } = await supabase
        .from("estimator_quotes")
        .select("id, owner_id, print_count, estimate_num, sales_ext, customer, delivery, lines, display_level, valid_through, project_summary")
        .eq("id", quoteId)
        .maybeSingle();
      if (error) return fallo(error);
      if (!data) return { ok: false, sinTabla: false, error: "not visible" };
      const fila = data as Record<string, unknown>;
      return {
        ok: true,
        valor: {
          id: String(fila.id),
          owner_id: (fila.owner_id as string | null) ?? null,
          owner_name: null,
          print_count: num(fila.print_count) ?? 0,
          draft: borradorDeFila(fila),
        },
      };
    },

    async guardar(quoteId, draft) {
      const fila = filaDeBorrador(draft);
      const q = quoteId
        ? supabase.from("estimator_quotes").update(fila).eq("id", quoteId).select("id")
        : supabase.from("estimator_quotes").insert(fila).select("id");
      const { data, error } = await q;
      if (error) return fallo(error);
      // Un UPDATE que la RLS no deja pasar vuelve limpio con cero filas: eso NO es guardado.
      const id = (data as { id: string }[] | null)?.[0]?.id;
      if (!id) return { ok: false, sinTabla: false, error: "0 rows" };
      return { ok: true, valor: id };
    },

    async pedirAprobacion(quoteId, approvalId) {
      const q = approvalId
        ? supabase.from("estimator_approvals").update({ status: "pending" }).eq("id", approvalId).select("status")
        : supabase.from("estimator_approvals").insert({ quote_id: quoteId }).select("status");
      const { data, error } = await q;
      if (error) return fallo(error);
      const st = (data as { status: AprobacionEstado }[] | null)?.[0]?.status;
      if (!st) return { ok: false, sinTabla: false, error: "0 rows" };
      return { ok: true, valor: st };
    },

    async pendientes() {
      const { data, error } = await supabase.rpc("estimator_pending_approvals");
      if (error) return fallo(error);
      return { ok: true, valor: (data ?? []) as AprobacionPendiente[] };
    },

    async decidir(approvalId, estado) {
      const { data, error } = await supabase
        .from("estimator_approvals").update({ status: estado }).eq("id", approvalId).select("id");
      if (error) return fallo(error);
      if (!(data as unknown[] | null)?.length) return { ok: false, sinTabla: false, error: "0 rows" };
      return { ok: true, valor: null };
    },

    async marcarImpresa(quoteId, printCount) {
      const { data, error } = await supabase
        .from("estimator_quotes")
        .update({ print_count: printCount, printed_at: new Date().toISOString(), policy_ack_at: new Date().toISOString() })
        .eq("id", quoteId)
        .select("id");
      if (error) return fallo(error);
      if (!(data as unknown[] | null)?.length) return { ok: false, sinTabla: false, error: "0 rows" };
      return { ok: true, valor: null };
    },
  };
}

// ---- el catálogo del ERP, para autocompletar ---------------------------------------------------

export interface ProductoDelCatalogo {
  sku: string;
  name: string;
  size_in: string | null;
  sf_per_box: number | null;
  /** $/SF para la línea, o null si el precio del ERP no es por SF y no se puede convertir. */
  price_per_sf: number | null;
}

/**
 * Del precio del ERP a $/SF. `erp.products.price` va en la unidad de venta (`sell_unit`): por SF se
 * usa tal cual; por caja, entre los SF de la caja. Por pieza, bolsa o cubeta **no se inventa**: el
 * vendedor lo escribe.
 */
export function precioPorSf(price: number | null, sellUnit: string | null, sfPorCaja: number | null): number | null {
  if (price === null || !Number.isFinite(price)) return null;
  if (sellUnit === "sqft") return price;
  if (sellUnit === "box" && sfPorCaja !== null && sfPorCaja > 0) return Math.round((price / sfPorCaja) * 100) / 100;
  return null;
}

/** Escapa `%` y `_` para un `ilike` por prefijo: un código con guion bajo no debe ser comodín. */
export function prefijoIlike(codigo: string): string {
  return codigo.trim().replace(/[\\%_]/g, (c) => `\\${c}`) + "%";
}

/**
 * Busca por código en `erp.app_products` con el cliente del ERP. **Quien no tiene el módulo ERP
 * recibe cero filas** (la puerta restrictiva de la 066): no es un fallo, es que se escribe a mano.
 */
// El cliente del ERP va atado al esquema `erp` y el tipo lo lleva; aquí da igual cuál sea.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buscarEnCatalogo(erp: SupabaseClient<any, any, any>, codigo: string): Promise<ProductoDelCatalogo[]> {
  if (!codigo.trim()) return [];
  const { data, error } = await erp
    .from("app_products")
    .select("sku, name, size_in, sf_per_box, price, sell_unit")
    .ilike("sku", prefijoIlike(codigo))
    .limit(8);
  if (error || !data) return [];
  return (data as { sku: string; name: string; size_in: string | null; sf_per_box: number | null; price: number | null; sell_unit: string | null }[])
    .map((p) => ({
      sku: p.sku, name: p.name, size_in: p.size_in, sf_per_box: p.sf_per_box,
      price_per_sf: precioPorSf(p.price, p.sell_unit, p.sf_per_box),
    }));
}
