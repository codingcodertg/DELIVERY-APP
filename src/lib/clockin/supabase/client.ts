import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client (uses the public anon key + the user's session). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Clock-in's tables were in `public` upstream; here they live in the `clockin` schema
      // (072), so every .from() has to default there. The shared `profiles` table stays in
      // public and needs .schema("public") on the calls that read it.
      db: { schema: "clockin" },
      // createBrowserClient caches a MODULE-LEVEL SINGLETON in the browser unless this is
      // false. Every module calls it with the same URL and anon key, so whichever runs first
      // wins and the rest silently get a client bound to the WRONG schema. That produced
      // "Could not find the table 'public.app_products'" when the ERP landed; not repeating it.
      isSingleton: false,
    },
  );
}

/** True only when the public Supabase env vars are present. */
export const isSupabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
