import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { COOKIE_ENSENANZA, valorDeEnsenanza } from "@/lib/ensenanza-general";
import { fetchDeEnsenanzaConValor } from "@/lib/ensenanza-servidor";

/** Supabase client for use in Server Components, Route Handlers, and Server
 * Actions. Defaults to the `recruiting` schema — see client.ts. */
export async function createClient() {
  const cookieStore = await cookies();
  // Modo enseñanza (D-626): con la cookie puesta, lo que escribe no llega a la base.
  const ensenanza = valorDeEnsenanza(cookieStore.get(COOKIE_ENSENANZA)?.value);
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "recruiting" },
      ...(ensenanza ? { global: { fetch: fetchDeEnsenanzaConValor(ensenanza) } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` was called from a Server Component — safe to ignore
            // when middleware is refreshing the session.
          }
        },
      },
    },
  );
}
