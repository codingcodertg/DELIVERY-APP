import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client (anon key + user session). Used by client components, e.g. login. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
