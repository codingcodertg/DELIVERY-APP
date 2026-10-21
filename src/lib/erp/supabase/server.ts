import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { COOKIE_ENSENANZA, valorDeEnsenanza } from "@/lib/ensenanza-general";
import { fetchDeEnsenanzaConValor } from "@/lib/ensenanza-servidor";

/**
 * Server-side Supabase client bound to the user's session cookies.
 * Uses the ANON key + the signed-in user's JWT, so RLS and the cost-masking
 * views apply (decision #29). NEVER use the service role for staff-facing reads.
 */
export async function createClient() {
  const cookieStore = await cookies();
  // Modo enseñanza (D-626): con la cookie puesta, lo que escribe no llega a la base.
  const ensenanza = valorDeEnsenanza(cookieStore.get(COOKIE_ENSENANZA)?.value);
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "erp" },
      ...(ensenanza ? { global: { fetch: fetchDeEnsenanzaConValor(ensenanza) } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component (cookies are read-only there).
            // Safe to ignore — middleware refreshes the session.
          }
        },
      },
    }
  );
}
