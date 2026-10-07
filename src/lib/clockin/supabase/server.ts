import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { COOKIE_CAPACITACION, fetchConCorte, valorDeCapacitacion } from "@/lib/timetracker/capacitacion";

/**
 * Server-side Supabase client, bound to the request's cookies so RLS sees the
 * logged-in user. Use this in Server Components and Server Actions.
 */
export async function createClient() {
  const cookieStore = await cookies();
  // Modo capacitación (D-490): con la cookie de práctica en la petición, este cliente no deja salir
  // ninguna escritura. Es la red de debajo: las acciones que escriben ya contestan antes, con
  // `corteDeCapacitacion()`; esto cubre la que se escape a esa guarda.
  const practica = valorDeCapacitacion(cookieStore.get(COOKIE_CAPACITACION)?.value);

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "clockin" },
      ...(practica ? { global: { fetch: fetchConCorte((i, o) => fetch(i, o), () => practica) } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore; middleware refreshes.
          }
        },
      },
    },
  );
}

export const isSupabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
