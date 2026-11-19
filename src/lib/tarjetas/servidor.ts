import "server-only";
import { createClient } from "@supabase/supabase-js";
import { filaDemoPorSlug, filaDemoPorToken } from "@/lib/tarjetas/demo";
import { tarjetaPublicaDesdeFila, type FilaPublica, type TarjetaPublica } from "@/lib/tarjetas/tarjeta";
import { validaSlug } from "@/lib/tarjetas/slug";
import { tokenValido } from "@/lib/tarjetas/token";

/**
 * Lectura de las tarjetas desde el servidor, SIN sesión: la página pública y el editor por enlace usan solo las
 * funciones `business_card_public` y `business_card_by_token` con la llave anónima. Nada de aquí lee la tabla.
 * En el demo (`NEXT_PUBLIC_LOCAL_MODE`) no hay base: se usan las tarjetas inventadas.
 */

export const DEMO = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export function clienteAnonimo() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function baseSupabase(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

/** La tarjeta pública de un slug, o null si no existe, está inactiva o el slug no es válido. */
export async function tarjetaPublicaPorSlug(slug: string): Promise<TarjetaPublica | null> {
  if (!validaSlug(slug).ok) return null;
  if (DEMO) {
    const f = filaDemoPorSlug(slug);
    return f ? tarjetaPublicaDesdeFila(f, baseSupabase()) : null;
  }
  const { data, error } = await clienteAnonimo().rpc("business_card_public", { p_slug: slug });
  if (error) throw new Error(`business_card_public: ${error.message}`);
  const fila = (data as FilaPublica[] | null)?.[0];
  return fila ? tarjetaPublicaDesdeFila(fila, baseSupabase()) : null;
}

/** La tarjeta de un token de edición, o null si el token no es de una tarjeta activa. */
export async function tarjetaPorToken(token: string): Promise<TarjetaPublica | null> {
  if (!tokenValido(token)) return null;
  if (DEMO) {
    const f = filaDemoPorToken(token);
    return f ? tarjetaPublicaDesdeFila(f, baseSupabase()) : null;
  }
  const { data, error } = await clienteAnonimo().rpc("business_card_by_token", { p_token: token });
  if (error) throw new Error(`business_card_by_token: ${error.message}`);
  const fila = (data as FilaPublica[] | null)?.[0];
  return fila ? tarjetaPublicaDesdeFila(fila, baseSupabase()) : null;
}

