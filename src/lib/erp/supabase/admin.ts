import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for TRUSTED server-only operations that the session client can't do —
 * here: uploading to and signing URLs for the PRIVATE `po-docs` bucket. It bypasses RLS and cost
 * masking (#29), so it must NEVER be used for staff-facing reads. Every caller MUST gate to
 * manager/admin first (the /purchasing area + the actions here already do).
 *
 * On the key: this project's LEGACY API keys — the `eyJ…` JWT that `SUPABASE_SERVICE_ROLE_KEY`
 * historically held — are disabled. They now return 401 on every call, which used to surface far
 * from here as an empty document list or a PDF that quietly wasn't saved. `SUPABASE_SECRET_KEY`
 * (the `sb_secret_…` format) replaces it. The legacy name is still read as a fallback so an
 * environment nobody has updated keeps working if its key is still live elsewhere.
 */
let warnedLegacy = false;

/** Exported for tests; the `server-only` import keeps it off every client bundle. */
export function adminKey(): string {
  const modern = process.env.SUPABASE_SECRET_KEY?.trim();
  if (modern) return modern;

  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!legacy) {
    throw new Error(
      "No Supabase service key in this environment. Set SUPABASE_SECRET_KEY to the project's " +
        "`sb_secret_…` key (SUPABASE_SERVICE_ROLE_KEY is still read as a fallback)."
    );
  }
  // A JWT-shaped value is a legacy key. Say so once, at the source, instead of letting a 401
  // reappear as a missing PDF three layers up.
  if (legacy.startsWith("eyJ") && !warnedLegacy) {
    warnedLegacy = true;
    console.warn(
      "[supabase/admin] Using the legacy SUPABASE_SERVICE_ROLE_KEY. It still works on this " +
        "project, but Supabase is retiring the format — prefer SUPABASE_SECRET_KEY (sb_secret_…)."
    );
  }
  return legacy;
}

export function createAdminClient() {
  // Bound to the `erp` schema like the other two clients (D-090) — the tables this
  // reaches (products, vendors) live there, not in public.
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, adminKey(), {
    db: { schema: "erp" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
