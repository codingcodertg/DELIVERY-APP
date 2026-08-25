// Shared Sentry init options + the beforeSend gate. Imported by every runtime
// config (client / server / edge) so the policy is defined once.
//
//   - errors only: tracesSampleRate 0 (the free 5k/mo is shared with transactions)
//   - sendDefaultPii false: no IP / cookies / headers by default
//   - only sends in production + preview (never local dev)
//   - beforeSend DROPS expected/handled events (role-denied 401/403, auth
//     redirects, validation) and SCRUBS everything else before it leaves
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { scrubEvent, type ScrubbableEvent } from "./scrub";

// Vercel sets VERCEL_ENV (server) + NEXT_PUBLIC_VERCEL_ENV (client) to
// production | preview | development. Fall back to NODE_ENV, then development.
export const SENTRY_ENV: string =
  process.env.NEXT_PUBLIC_VERCEL_ENV ||
  process.env.VERCEL_ENV ||
  process.env.NODE_ENV ||
  "development";

const SEND_IN: ReadonlySet<string> = new Set(["production", "preview"]);

export function isSentryEnabled(dsn: string | undefined): boolean {
  return !!dsn && SEND_IN.has(SENTRY_ENV);
}

// Is this a normal, expected outcome we should NOT report (protect the quota)?
function isExpected(event: ErrorEvent, hint: EventHint): boolean {
  const err = hint?.originalException as
    | (Error & { expected?: boolean; status?: number; statusCode?: number; code?: string; digest?: unknown })
    | undefined;

  if (err && typeof err === "object" && err.expected === true) return true;

  const status =
    err?.status ??
    err?.statusCode ??
    (event.contexts?.response as { status_code?: number } | undefined)?.status_code;
  if (status === 401 || status === 403 || status === 404 || status === 429) return true;

  const msg = String(err?.message ?? event.exception?.values?.[0]?.value ?? "");
  if (/not authoriz|unauthorized|forbidden|permission denied|only admin|42501/i.test(msg)) return true;
  if (err?.code === "NOT_AUTHORIZED" || err?.code === "VALIDATION") return true;

  // Next.js control-flow "errors": redirect() / notFound() / route HTTP fallbacks.
  const digest = String(err?.digest ?? "");
  if (digest.startsWith("NEXT_REDIRECT") || digest.includes("NEXT_NOT_FOUND") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) {
    return true;
  }
  return false;
}

export function beforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
  if (!SEND_IN.has(SENTRY_ENV)) return null; // belt-and-suspenders: never local dev
  if (isExpected(event, hint)) return null; // drop handled/expected
  return scrubEvent(event as ScrubbableEvent) as ErrorEvent; // privacy scrub before it leaves
}

// Options every runtime shares. The per-runtime config adds { dsn, enabled }.
export const baseInitOptions = {
  tracesSampleRate: 0,
  sendDefaultPii: false,
  environment: SENTRY_ENV,
  beforeSend,
};
