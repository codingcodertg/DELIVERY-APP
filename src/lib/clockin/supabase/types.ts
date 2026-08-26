import type { SupabaseClient as SupabaseClientBase } from "@supabase/supabase-js";

/**
 * A Supabase client bound to the `clockin` schema.
 *
 * Bare `SupabaseClient` defaults its schema generics to "public", so helpers typed that way reject
 * the module's own client now that it defaults to `clockin` (072). Widening says what these helpers
 * actually need: any client, whatever schema it points at. The queries inside them are unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySupabase = SupabaseClientBase<any, any, any, any, any>;
