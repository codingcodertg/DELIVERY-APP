import type { SupabaseClient } from "@supabase/supabase-js";
import { COLUMNAS, type RespuestaEncuesta } from "./resumen";

/**
 * Dónde viven las respuestas: `public.survey_responses` (migración 155). Una interfaz con dos implementaciones
 * —la base y el demo— para que la pantalla sea la misma en las dos.
 *
 * **Se lee con la sesión de quien mira**: la política de la 155 (`has_surveys_access()`) decide. Sin el
 * módulo, la base devuelve cero filas, no un error: por eso la puerta del layout lo comprueba antes.
 *
 * **Marcar contactado no es un UPDATE**: la tabla no tiene ninguna escritura por la API. Es la función
 * `mark_survey_contacted`, que pone la hora la base y devuelve la que quedó.
 *
 * Sin la 155 aplicada (el código llega antes que la migración) se devuelve `sinTabla` y la pantalla lo
 * dice, en vez de enseñar un error rojo o, peor, una lista vacía que parece «nadie ha contestado».
 */
export type Resultado<T> = { ok: true; valor: T } | { ok: false; sinTabla: boolean; error: string };

export interface AlmacenDeEncuestas {
  leer(): Promise<Resultado<RespuestaEncuesta[]>>;
  /** Devuelve la hora de contacto que quedó (null al desmarcar). */
  marcarContactado(id: string, valor: boolean): Promise<Resultado<string | null>>;
}

/** ¿Es «la 155 no está aplicada»? PGRST205 (tabla) / PGRST202 (función) de PostgREST; 42P01 / 42883 de Postgres. Solo esos. */
export function faltaLaTabla(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "PGRST205" || code === "PGRST202" || code === "42P01" || code === "42883";
}

/** Tamaño de página: PostgREST corta por defecto en 1000 filas; se pide por tramos para no perder las viejas. */
export const PAGINA = 1000;
/** Tope de tramos: 20 000 respuestas. Si algún día se pasa, se dice en vez de cortar callado. */
export const MAX_PAGINAS = 20;

/** Una fila de la base, con los tipos que la pantalla espera (jsonb y text[] pueden llegar nulos). */
export function filaDeLaBase(f: Record<string, unknown>): RespuestaEncuesta {
  const ratings: Record<string, number> = {};
  if (f.ratings && typeof f.ratings === "object" && !Array.isArray(f.ratings)) {
    for (const [k, v] of Object.entries(f.ratings as Record<string, unknown>)) {
      if (typeof v === "number") ratings[k] = v;
    }
  }
  const texto = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: String(f.id),
    created_at: String(f.created_at),
    nothing_to_improve: f.nothing_to_improve === true,
    selected_areas: Array.isArray(f.selected_areas) ? (f.selected_areas as unknown[]).filter((x): x is string => typeof x === "string") : [],
    other_text: texto(f.other_text),
    ratings,
    wants_contact: f.wants_contact === true,
    contact_name: texto(f.contact_name),
    contact_phone: texto(f.contact_phone),
    contact_email: texto(f.contact_email),
    contacted: f.contacted === true,
    contacted_at: texto(f.contacted_at),
  };
}

export function almacenDeLaBase(supabase: SupabaseClient): AlmacenDeEncuestas {
  return {
    async leer() {
      const todas: RespuestaEncuesta[] = [];
      for (let p = 0; p < MAX_PAGINAS; p++) {
        const { data, error } = await supabase
          .from("survey_responses")
          .select(COLUMNAS)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(p * PAGINA, (p + 1) * PAGINA - 1);
        if (error) return { ok: false, sinTabla: faltaLaTabla(error), error: error.message };
        const filas = (data ?? []) as unknown as Record<string, unknown>[];
        todas.push(...filas.map(filaDeLaBase));
        if (filas.length < PAGINA) return { ok: true, valor: todas };
      }
      return { ok: false, sinTabla: false, error: `more than ${PAGINA * MAX_PAGINAS} responses` };
    },
    async marcarContactado(id, valor) {
      const { data, error } = await supabase.rpc("mark_survey_contacted", { p_id: id, p_value: valor });
      if (error) return { ok: false, sinTabla: faltaLaTabla(error), error: error.message };
      return { ok: true, valor: typeof data === "string" ? data : null };
    },
  };
}
