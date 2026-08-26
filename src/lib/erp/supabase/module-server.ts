import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client bound to ONE of the merged module schemas
 * (`deliveries` | `recruiting` | `timetracker`, ADR 0010 Phase 3).
 *
 * Same contract as `lib/supabase/server.ts`: anon key + the signed-in user's JWT, so RLS applies.
 * Never the service role — the merged schemas carry their own row-level rules (v4_74) and a
 * service-role read would bypass every one of them, exactly as decision #29 forbids for the catalog.
 *
 * Separate from `createClient()` rather than a parameter on it because the default client is the
 * catalog's, used in ~40 places; making its schema configurable would put a footgun in every one of
 * them for the benefit of the few pages that need a module schema.
 *
 * NOTE: these schemas must be listed in the project's PostgREST `db_schema` setting
 * (Dashboard → Settings → API → Exposed schemas) or every query here returns
 * "Invalid schema". The data and policies exist without it; only API access needs the setting.
 */
export type ModuleSchema = "deliveries" | "recruiting" | "timetracker";

export async function createModuleClient(schema: ModuleSchema) {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema },
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
            // Server Component: cookies are read-only there. Middleware refreshes the session.
          }
        },
      },
    }
  );
}
