import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// createBrowserClient (@supabase/ssr) keeps ONE client in a module-level cache
// (`cachedBrowserClient`) and, in the browser, every call that does not pass
// `isSingleton` goes through that cache: the first module to run wins and the
// rest silently receive a client bound to the WRONG schema. It bit the ERP
// ("Could not find the table 'public.app_products'") and then HR/Time Tracker
// ("Could not find the table 'timetracker.questions'" on /recruiting) because
// the lesson lived in a comment nobody re-read. This suite is the lesson, and it
// does NOT rely on anyone remembering to register a new client here: it walks
// src/lib on disk, picks up every file that imports createBrowserClient from
// @supabase/ssr, and checks each one. A sixth module that copies the pattern
// without opting out fails this suite the moment its file exists. See D-NEXT.
//
// The rule: any browser client that sets its own db.schema must pass
// isSingleton: false. At most ONE client (deliveries, default `public` schema)
// may stay on the cache — alone there, it cannot collide with anyone.

const createBrowserClient = vi.fn((..._args: unknown[]) => ({}));
vi.mock("@supabase/ssr", () => ({ createBrowserClient }));

const SRC_LIB = join(process.cwd(), "src", "lib");

/** Every non-test .ts/.tsx under src/lib that imports createBrowserClient from @supabase/ssr. */
function discoverBrowserClientFiles(dir = SRC_LIB, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      discoverBrowserClientFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
    const src = readFileSync(full, "utf8");
    if (/import\s*\{[^}]*\bcreateBrowserClient\b[^}]*\}\s*from\s*["']@supabase\/ssr["']/.test(src)) {
      out.push(full);
    }
  }
  return out.sort();
}

/** "@/lib/erp/supabase/client" for C:\...\src\lib\erp\supabase\client.ts */
function toModuleId(file: string): string {
  const rel = relative(SRC_LIB, file).split(sep).join("/").replace(/\.tsx?$/, "");
  return `@/lib/${rel}`;
}

// What we EXPECT to find on disk today. Not the source of truth — the walk above
// is — but the suite fails if disk and this table differ in either direction, so
// a new client cannot slip in unnoticed and a deleted one cannot linger here.
const EXPECTED: Record<string, string | undefined> = {
  "@/lib/supabase/client": undefined, // deliveries: default `public`, the one on the cache
  "@/lib/recruiting/supabase/client": "recruiting",
  "@/lib/timetracker/supabase/client": "timetracker",
  "@/lib/erp/supabase/client": "erp",
  "@/lib/clockin/supabase/client": "clockin",
};

type Options = { db?: { schema?: string }; isSingleton?: boolean } | undefined;

async function optionsPassedBy(moduleId: string): Promise<Options> {
  createBrowserClient.mockClear();
  const mod = (await import(/* @vite-ignore */ moduleId)) as { createClient: () => unknown };
  expect(typeof mod.createClient, `${moduleId} must export createClient()`).toBe("function");
  mod.createClient();
  expect(createBrowserClient).toHaveBeenCalledTimes(1);
  return createBrowserClient.mock.calls[0][2] as Options;
}

const discovered = discoverBrowserClientFiles().map(toModuleId);

describe("browser Supabase clients vs. @supabase/ssr singleton cache", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });

  it("the clients found on disk are exactly the ones this suite expects", () => {
    // Fails in BOTH directions: a new importer of createBrowserClient not listed
    // here, or a listed one that no longer exists on disk.
    expect(discovered).toEqual(Object.keys(EXPECTED).sort());
  });

  it("every discovered client with its own db.schema opts out of the cache", async () => {
    expect(discovered.length).toBeGreaterThan(0);
    const onCache: string[] = [];
    for (const moduleId of discovered) {
      const opts = await optionsPassedBy(moduleId);
      const schema = opts?.db?.schema;
      if (moduleId in EXPECTED) {
        expect(schema, `${moduleId} schema`).toBe(EXPECTED[moduleId]);
      }
      if (schema !== undefined) {
        // Own schema ⇒ must NOT touch the cache, or another module's client comes back.
        expect(opts?.isSingleton, `${moduleId} binds db.schema "${schema}" and must pass isSingleton: false`).toBe(false);
      } else if (opts?.isSingleton !== false) {
        onCache.push(moduleId);
      }
    }
    // At most one client may live on the shared cache. Two there is the collision
    // this suite exists to prevent: opt out instead.
    expect(onCache, "clients sharing the @supabase/ssr cache").toEqual(["@/lib/supabase/client"]);
  });
});
