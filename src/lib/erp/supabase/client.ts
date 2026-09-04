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
    {
      db: { schema: "erp" },
      // createBrowserClient CACHES A MODULE-LEVEL SINGLETON in the browser unless this is false
      // (see @supabase/ssr createBrowserClient.js: `cachedBrowserClient`). Every module here calls
      // it with the same URL and anon key, so whichever runs first wins and the others silently get
      // a client bound to the WRONG schema. That is what produced
      // "Could not find the table 'public.app_products'" — the ERP was handed deliveries'
      // public-schema client.
      //
      // History: this comment used to say "only this client opts out, not the other three: they
      // work today, and a second GoTrue instance per module is a cost worth paying once, not four
      // times." That was already inaccurate when written (clockin opted out too, D-091) and the
      // bet lost in production: HR and Time Tracker, still sharing the cache, stole each other's
      // client ("Could not find the table 'timetracker.questions'" on /recruiting). Today every
      // browser client with its own db.schema opts out, and only the deliveries client
      // (src/lib/supabase/client.ts, default `public` schema) keeps using the cache — alone, so
      // it cannot collide with anyone. src/lib/supabase/browser-clients.test.ts enforces this;
      // the extra GoTrue instance per module is the price accepted in D-185.
      isSingleton: false,
    }
  );
}
