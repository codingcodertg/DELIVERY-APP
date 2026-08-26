// The single place a Supabase / PostgREST result stops being "maybe null" and
// becomes data (audit ARC-02, and its live instance ARC-01).
//
// What was wrong: 32 of 51 `{ data }` destructures bound no `error`, so a
// permission / RLS / network failure fell through as `null` and rendered as an
// EMPTY screen instead of an error. The live case was /review/daltile, which read
// the base table `products` (no SELECT grant for `authenticated`) and therefore
// listed all 172 pending matches as anonymous `#<id>` rows — while its Confirm
// button wrote products.mpn into the golden record.
//
// unwrap() throws instead. In a Server Component that surfaces the app error
// boundary (app/error.tsx) with a Sentry ref, so a failed read is visible and no
// destructive action is offered against data we could not read. A legitimately
// absent row (`.maybeSingle()` → data null, error null) is NOT an error and is
// returned as null, unchanged.
//
// Sentry policy mirrors lib/api-error.ts: genuine faults are captured (the SDK's
// beforeSend scrubs the payload); EXPECTED outcomes — an authorization denial is a
// normal operating result of a role-gated read — are classified but not reported,
// to protect the free quota. This module is deliberately isomorphic (no
// "server-only"): client components hit the same PostgREST failures.
import * as Sentry from "@sentry/nextjs";
import { AppError, EXPECTED_CODES, type ErrorCode } from "@/lib/erp/error-codes";

/** Structural shape of a PostgrestError — kept loose so plain literals also satisfy it. */
export interface DbError {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * What every supabase-js query / rpc settles into: a discriminated union of a success
 * row-set and a failure. Exported for tests and for hand-rolled results.
 */
export type DbResult<T> = { data: T; error: null } | { data: null; error: DbError };

/** The `data` of the SUCCESS half of a settled result — i.e. what unwrap() returns. */
type Unwrapped<R> = Exclude<R, { error: DbError }> extends { data: infer D } ? D : never;

/** Map a PostgREST/Postgres failure onto the shared error-code registry. */
export function classifyDbError(error: DbError): ErrorCode {
  const code = error.code ?? "";
  const message = error.message ?? "";
  // 42501 = insufficient_privilege; PGRST301/302 = missing/expired JWT.
  if (
    code === "42501" ||
    code === "PGRST301" ||
    code === "PGRST302" ||
    /permission denied|not authoriz|unauthorized|forbidden|only admin|row-level security|jwt/i.test(message)
  ) {
    return "NOT_AUTHORIZED";
  }
  if (code === "PGRST116") return "NOT_FOUND"; // .single() matched no row
  // Class 08 = connection exception; 57014 = query canceled (statement timeout).
  if (
    code.startsWith("08") ||
    code === "57014" ||
    /timeout|timed out|fetch failed|network|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|connection/i.test(message)
  ) {
    return "DB_UNAVAILABLE";
  }
  return "UNKNOWN";
}

/**
 * Return the rows, or throw an AppError describing the failure.
 *
 * `context` names the call site (e.g. "review/daltile: app_products lookup"); it
 * travels to Sentry and into the thrown message, never to the browser in
 * production (Next.js replaces a Server Component error with its digest).
 *
 * The result type is inferred (rather than declared `DbResult<T>`) so the caller keeps
 * whatever row type supabase-js gave it: dropping the failure half of the union yields
 * exactly the success `data`, including `T | null` for `.maybeSingle()`.
 */
export function unwrap<R extends { data: unknown; error: DbError | null }>(
  result: R,
  context: string,
): Unwrapped<R> {
  if (result.error) {
    const code = classifyDbError(result.error);
    const pgCode = result.error.code ?? "";
    const err = new AppError(code, {
      message: `${context}: ${result.error.message}${pgCode ? ` [${pgCode}]` : ""}`,
      cause: result.error,
    });
    if (!EXPECTED_CODES.has(code)) {
      Sentry.captureException(err, { tags: { db_context: context, pg_code: pgCode } });
    }
    throw err;
  }
  return result.data as Unwrapped<R>;
}

/**
 * Display text for something unwrap() threw. Client components catch it and put this
 * in their existing inline error slot — a throw inside an effect / event handler is
 * NOT caught by a React error boundary, so the visible state has to be local.
 */
export function dbErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
