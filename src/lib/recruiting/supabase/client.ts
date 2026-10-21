"use client";

import { createBrowserClient } from "@supabase/ssr";
import { ensenanzaDelNavegador, fetchDeEnsenanza } from "@/lib/ensenanza-general";

/** Supabase client for use in Client Components (browser).
 * Defaults every .from() call to the `recruiting` schema (see D-050) — the
 * shared `profiles` table lives in `public` and needs `.schema('public')`
 * per call where it's queried; storage calls are unaffected either way. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "recruiting" },
      // Modo enseñanza (D-626): con la cookie puesta, lo que escribe no sale del navegador.
      global: { fetch: fetchDeEnsenanza((i, o) => fetch(i, o), ensenanzaDelNavegador) },
      // Without this, createBrowserClient returns ONE cached client per browser (the
      // `cachedBrowserClient` module variable in @supabase/ssr) and ignores the options of
      // every later caller. Whichever module ran first wins: with Time Tracker loaded first,
      // /recruiting was handed a client bound to the `timetracker` schema and failed with
      // "Could not find the table 'timetracker.questions' in the schema cache". Any browser
      // client with its own db.schema must opt out — src/lib/supabase/browser-clients.test.ts
      // enforces it. See D-185.
      isSingleton: false,
    },
  );
}
