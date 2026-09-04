"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for use in Client Components (browser).
 * Defaults every .from() call to the `timetracker` schema (see D-064) — the
 * shared `profiles` table lives in `public` and needs `.schema('public')`
 * per call where it's queried; storage calls are unaffected either way.
 * Mirrors src/lib/recruiting/supabase/client.ts exactly. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "timetracker" },
      // Without this, createBrowserClient returns ONE cached client per browser (the
      // `cachedBrowserClient` module variable in @supabase/ssr) and ignores the options of
      // every later caller. Whichever module ran first wins: with HR loaded first this client
      // would come back bound to `recruiting`, and the other way round it broke /recruiting with
      // "Could not find the table 'timetracker.questions' in the schema cache". Any browser
      // client with its own db.schema must opt out — src/lib/supabase/browser-clients.test.ts
      // enforces it. See D-NEXT.
      isSingleton: false,
    },
  );
}
