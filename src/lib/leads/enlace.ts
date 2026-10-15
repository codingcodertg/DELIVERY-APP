import type { SupabaseClient } from "@supabase/supabase-js";
import { faltaLaColumnaDelLead } from "@/lib/estimator/almacen";
import { COLUMNAS, faltaLaTabla, leadDeLaBase } from "./almacen";
import { leadsDemo } from "./demo";
import type { CotizacionDeLead } from "./cotizar";
import type { Lead } from "./reglas";

/**
 * Las dos lecturas que cruzan de una app a la otra (D-558, Leads → Quote Builder). **Ninguna escribe**, y las dos van
 * con la sesión de quien mira: la RLS de cada tabla decide, no esta capa.
 *
 * - `leerLead`: el Quote Builder lee UN lead (para rellenar la cotización, o para decir «De lead: …»). Lo que la
 *   política de leads (163) no deja ver vuelve como `null`: es «no lo ves», no un error.
 * - `cotizacionesConLead`: Leads lee las cotizaciones que quien mira VE (148) y salieron de un lead. Sin la 175 (la
 *   columna no está) o sin la 148 (la tabla no está), no hay ninguna que contar: vacío, no error.
 */
export type ResEnlace<T> = { ok: true; valor: T } | { ok: false; error: string };

export interface AlmacenDelEnlace {
  leerLead(id: string): Promise<ResEnlace<Lead | null>>;
  cotizacionesConLead(): Promise<ResEnlace<CotizacionDeLead[]>>;
}

/** Un error de `cotizacionesConLead` que NO es avería: falta la columna de la 175, o la tabla de la 148. */
export function sinNadaQueContar(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return faltaLaColumnaDelLead(error) || faltaLaTabla(error);
}

/** Tope de cotizaciones con lead que se leen de una vez. Hoy son pocas; si se llega, se dice en vez de cortar callado. */
export const TOPE_COTIZACIONES_CON_LEAD = 1000;

export function enlaceDeLaBase(supabase: SupabaseClient): AlmacenDelEnlace {
  return {
    async leerLead(id) {
      const { data, error } = await supabase.from("leads").select(COLUMNAS).eq("id", id).maybeSingle();
      if (error) return faltaLaTabla(error) ? { ok: true, valor: null } : { ok: false, error: error.message };
      return { ok: true, valor: data ? leadDeLaBase(data as unknown as Record<string, unknown>) : null };
    },
    async cotizacionesConLead() {
      const { data, error } = await supabase
        .from("estimator_quotes")
        .select("id, estimate_num, lead_id, updated_at")
        .not("lead_id", "is", null)
        .order("updated_at", { ascending: false })
        .limit(TOPE_COTIZACIONES_CON_LEAD + 1);
      if (error) return sinNadaQueContar(error) ? { ok: true, valor: [] } : { ok: false, error: error.message };
      const filas = (data ?? []) as unknown as CotizacionDeLead[];
      if (filas.length > TOPE_COTIZACIONES_CON_LEAD) return { ok: false, error: `more than ${TOPE_COTIZACIONES_CON_LEAD} quotes with a lead` };
      return { ok: true, valor: filas };
    },
  };
}

/** El demo: los leads inventados de `leadsDemo`, y ninguna cotización (el demo de cada app vive en su pestaña). */
export function enlaceDemo(): AlmacenDelEnlace {
  const leads = leadsDemo();
  return {
    async leerLead(id) { return { ok: true, valor: leads.find((l) => l.id === id) ?? null }; },
    async cotizacionesConLead() { return { ok: true, valor: [] }; },
  };
}
