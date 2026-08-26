// Error-code registry. Framework-agnostic (no Next/Sentry imports) so it can be
// shared verbatim across the app + the competitor-catalog-scraper.
//
// Server code throws AppError(code) (or a plain Error we classify); the API layer
// logs full detail to Sentry and returns only the SAFE client shape — a friendly
// message, the code, and the Sentry event id (ref). No stack/file/source leaves
// the server in production.

export const ERROR_CODES = {
  DB_UNAVAILABLE: "The data service is temporarily unavailable. Please retry in a moment.",
  NOT_AUTHORIZED: "You don't have access to this. Ask an admin if you think that's wrong.",
  MATCH_FAILED: "We couldn't match this item automatically — a manager can resolve it.",
  VALIDATION: "Some of the submitted data was invalid. Check the highlighted fields and retry.",
  NOT_FOUND: "That record could not be found.",
  RATE_LIMITED: "Too many requests — please slow down and retry shortly.",
  UPSTREAM: "An upstream service failed. Please retry shortly.",
  UNKNOWN: "Something went wrong on our end. We've been notified.",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

// "expected" codes are normal operating outcomes (auth denials, validation, not-found,
// rate-limit, a match miss). They are NOT faults → the Sentry beforeSend drops them so
// they never eat the free quota. The rest are genuine faults worth a Sentry event.
export const EXPECTED_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "NOT_AUTHORIZED",
  "VALIDATION",
  "NOT_FOUND",
  "RATE_LIMITED",
  "MATCH_FAILED",
]);

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  DB_UNAVAILABLE: 503,
  NOT_AUTHORIZED: 403,
  MATCH_FAILED: 422,
  VALIDATION: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  UPSTREAM: 502,
  UNKNOWN: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly expected: boolean;
  constructor(code: ErrorCode, opts: { message?: string; status?: number; expected?: boolean; cause?: unknown } = {}) {
    super(opts.message ?? ERROR_CODES[code]);
    this.name = "AppError";
    this.code = code;
    this.status = opts.status ?? DEFAULT_STATUS[code];
    this.expected = opts.expected ?? EXPECTED_CODES.has(code);
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

// The only error shape that reaches the client in production.
export interface ClientError {
  code: ErrorCode;
  message: string;
  ref: string | null; // Sentry event id, when a fault was reported
}

export function toClientError(code: ErrorCode, ref: string | null, message?: string): ClientError {
  return { code, message: message ?? ERROR_CODES[code], ref };
}

export function statusFor(code: ErrorCode): number {
  return DEFAULT_STATUS[code];
}
