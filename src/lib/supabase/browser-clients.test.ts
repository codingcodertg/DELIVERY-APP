import { describe, it, expect, vi, beforeEach } from "vitest";

// createBrowserClient (@supabase/ssr) keeps ONE client in a module-level cache
// (`cachedBrowserClient`) and, in the browser, every call that does not pass
// `isSingleton` goes through that cache: the first module to run wins and the
// rest silently receive a client bound to the WRONG schema. It bit the ERP
// ("Could not find the table 'public.app_products'") and then HR/Time Tracker
// ("Could not find the table 'timetracker.questions'" on /recruiting) because
// the lesson lived in a comment nobody re-read. This suite is the lesson:
// any browser client that sets its own db.schema must pass isSingleton: false.
// The deliveries client (default `public` schema) is the ONLY one allowed on
// the cache — being alone there, it cannot collide with anyone. See D-NEXT.

const createBrowserClient = vi.fn((..._args: unknown[]) => ({}));
vi.mock("@supabase/ssr", () => ({ createBrowserClient }));

const BROWSER_CLIENTS = [
  { module: "@/lib/supabase/client", schema: undefined },
  { module: "@/lib/recruiting/supabase/client", schema: "recruiting" },
  { module: "@/lib/timetracker/supabase/client", schema: "timetracker" },
  { module: "@/lib/erp/supabase/client", schema: "erp" },
  { module: "@/lib/clockin/supabase/client", schema: "clockin" },
] as const;

type Options = { db?: { schema?: string }; isSingleton?: boolean } | undefined;

async function optionsPassedBy(module: string): Promise<Options> {
  createBrowserClient.mockClear();
  const mod = (await import(/* @vite-ignore */ module)) as { createClient: () => unknown };
  mod.createClient();
  expect(createBrowserClient).toHaveBeenCalledTimes(1);
  return createBrowserClient.mock.calls[0][2] as Options;
}

describe("browser Supabase clients vs. @supabase/ssr singleton cache", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });

  for (const { module, schema } of BROWSER_CLIENTS) {
    it(`${module} → schema ${schema ?? "(public, default)"}`, async () => {
      const opts = await optionsPassedBy(module);
      expect(opts?.db?.schema).toBe(schema);
      if (schema !== undefined) {
        // Own schema ⇒ must NOT touch the cache, or another module's client comes back.
        expect(opts?.isSingleton).toBe(false);
      } else {
        // The only client on the cache. If a second one ever wants to share it, that is the
        // collision this suite exists to prevent: opt out instead.
        expect(opts?.isSingleton).not.toBe(false);
      }
    });
  }

  it("exactly one browser client uses the shared cache", () => {
    const onCache = BROWSER_CLIENTS.filter((c) => c.schema === undefined);
    expect(onCache.map((c) => c.module)).toEqual(["@/lib/supabase/client"]);
  });
});
