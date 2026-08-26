import { createBrowserClient } from "@supabase/ssr";

/**
 * Every .from() here defaults to the `erp` schema (D-090), the same way the
 * recruiting and timetracker clients bind to theirs. The shared `profiles` table
 * lives in `public` and needs `.schema("public")` on the calls that read it.
 */
/** Browser Supabase client (anon key + user session). Used by client components, e.g. login. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "erp" } }
  );
}
