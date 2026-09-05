import type { SupabaseClient } from "@supabase/supabase-js";

/** Lo que las rutas de exportación cableaban antes de G-25: el defecto cuando no hay ajuste. */
export const DEFAULT_BUSINESS_TZ = "America/Chicago";

/**
 * La zona horaria del negocio, leída en SERVIDOR (G-25, D-NEXT).
 *
 * En el navegador la fuente es `APP_SETTINGS.timeZone` (helpers.ts), que el proveedor rellena
 * desde la fila `timetracker.settings` (`id = 'app'`, columna `data`) al cargar. Las rutas de
 * exportación de nómina (`clock-in/api/reports/{export,xlsx}`) corren en servidor, donde ese
 * objeto no existe (y su defecto sería la zona del servidor, UTC en Vercel), así que se lee la
 * misma fila directamente. Si no hay fila, o no trae zona, se usa `America/Chicago`: es lo que
 * esas rutas cableaban antes, así que sin ajuste no cambia nada.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function businessTimeZone(supabase: SupabaseClient<any, any, any>): Promise<string> {
  try {
    const { data } = await supabase.schema("timetracker").from("settings").select("data").eq("id", "app").maybeSingle();
    const tz = (data as { data?: { timeZone?: unknown } } | null)?.data?.timeZone;
    return typeof tz === "string" && tz.trim() ? tz : DEFAULT_BUSINESS_TZ;
  } catch {
    return DEFAULT_BUSINESS_TZ;
  }
}
