import { createAdminClient } from "@/lib/supabase/admin";
import { estaVigente, TTL_DISTANCIA_MS, TTL_PLACES_MS, TTL_RUTA_OPT_MS } from "@/lib/cache-google";

// ============================================================
// Lectura y escritura de las cachés de Google (migración 312): geocode_cache, places_cache,
// route_opt_cache y distance_cache. Solo servidor: usa la clave de servicio, que salta el RLS
// (esas tablas no tienen políticas a propósito).
//
// Si la migración no está aplicada —o la base no responde— cada función devuelve null o no
// hace nada: la ruta se comporta como antes, sin caché. Se avisa UNA vez en el log.
// ============================================================

let yaAvisado = false;
function sinCache(donde: string, e: unknown) {
  if (yaAvisado) return;
  yaAvisado = true;
  const motivo = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  console.warn(`[cache-google] ${donde}: sin caché (¿aplicada la migración 312?). ${motivo}`);
}

/** Lee la fila de una caché con `payload` y `created_at`, y la devuelve solo si sigue dentro del TTL. */
async function leeFresca<T>(tabla: string, columna: string, clave: string, ttlMs: number): Promise<T | null> {
  try {
    const { data, error } = await createAdminClient()
      .from(tabla)
      .select("payload, created_at")
      .eq(columna, clave)
      .maybeSingle();
    if (error) { sinCache(`leer ${tabla}`, error); return null; }
    if (!data || !estaVigente(data.created_at as string, ttlMs)) return null;
    return data.payload as T;
  } catch (e) {
    sinCache(`leer ${tabla}`, e);
    return null;
  }
}

/** Guarda (o reemplaza) una fila con `payload`. Si falla, no pasa nada: la respuesta ya está calculada. */
async function guardaFila(tabla: string, columna: string, clave: string, payload: unknown): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from(tabla)
      .upsert({ [columna]: clave, payload, created_at: new Date().toISOString() }, { onConflict: columna });
    if (error) sinCache(`guardar ${tabla}`, error);
  } catch (e) {
    sinCache(`guardar ${tabla}`, e);
  }
}

// ---- Geocodificación (sin TTL: una dirección no cambia de sitio) ----

export interface PuntoGuardado { lat: number; lng: number; formatted: string | null }

/** Lee una dirección ya geocodificada (la clave es la dirección normalizada). */
export async function leeGeocode(clave: string): Promise<PuntoGuardado | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("geocode_cache")
      .select("lat, lng, formatted")
      .eq("address_key", clave)
      .maybeSingle();
    if (error) { sinCache("leer geocode_cache", error); return null; }
    if (!data) return null;
    return { lat: Number(data.lat), lng: Number(data.lng), formatted: (data.formatted as string | null) ?? null };
  } catch (e) {
    sinCache("leer geocode_cache", e);
    return null;
  }
}

/** Guarda una dirección geocodificada por Google. */
export async function guardaGeocode(clave: string, punto: PuntoGuardado): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("geocode_cache")
      .upsert({ address_key: clave, lat: punto.lat, lng: punto.lng, formatted: punto.formatted }, { onConflict: "address_key" });
    if (error) sinCache("guardar geocode_cache", error);
  } catch (e) {
    sinCache("guardar geocode_cache", e);
  }
}

// ---- Lugares del mercado (7 días) ----

export function leePlaces<T>(clave: string): Promise<T | null> {
  return leeFresca<T>("places_cache", "cache_key", clave, TTL_PLACES_MS);
}
export function guardaPlaces(clave: string, places: unknown): Promise<void> {
  return guardaFila("places_cache", "cache_key", clave, places);
}

// ---- Optimización de rutas (60 minutos) ----

export function leeRutaOptimizada<T>(clave: string): Promise<T | null> {
  return leeFresca<T>("route_opt_cache", "cache_key", clave, TTL_RUTA_OPT_MS);
}
export function guardaRutaOptimizada(clave: string, payload: unknown): Promise<void> {
  return guardaFila("route_opt_cache", "cache_key", clave, payload);
}

// ---- Distancia entre dos direcciones (30 días) ----

export function leeDistancia<T>(clave: string): Promise<T | null> {
  return leeFresca<T>("distance_cache", "pair_key", clave, TTL_DISTANCIA_MS);
}
export function guardaDistancia(clave: string, payload: unknown): Promise<void> {
  return guardaFila("distance_cache", "pair_key", clave, payload);
}
