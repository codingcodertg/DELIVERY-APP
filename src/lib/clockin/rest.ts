/**
 * Headers every raw PostgREST call in clock-in must carry.
 *
 * The cron routes and the push sender talk to PostgREST with plain `fetch`, not through the
 * Supabase client — so they never get the `db: { schema: "clockin" }` that src/lib/clockin/
 * supabase/client.ts sets. Without a profile header PostgREST answers from `public`, and in this
 * container that is a different app's database:
 *
 *   notifications        exists in BOTH  -> clock-in's rows would land in deliveries' table
 *   profiles             exists in BOTH  -> reads deliveries' row, which has no company_id,
 *                                           language or active; the filters silently match nothing
 *   scheduled_shifts     public: 404     -> q() returns [] on !r.ok, so the cron no-ops in silence
 *   shift_cancellations  public: 404     -> same
 *   push_subscriptions   public: 404     -> same
 *
 * None of that raises anything. That is the reason this is a shared constant and not a header
 * added at each call site: a call site that forgets it does not break, it quietly reads or writes
 * the wrong app's data.
 *
 * Both profiles are sent on every request. PostgREST reads Accept-Profile for GET and
 * Content-Profile for writes, and ignores the other — sending both costs nothing and removes the
 * "which verb is this?" question from every call.
 */
export const CLOCKIN_REST_HEADERS = {
  "Accept-Profile": "clockin",
  "Content-Profile": "clockin",
} as const;

/** Service-role headers for a raw call, with the schema already on them. */
export function clockinRestHeaders(key: string, extra?: Record<string, string>) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...CLOCKIN_REST_HEADERS,
    ...(extra ?? {}),
  };
}
