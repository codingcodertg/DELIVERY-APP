// Server error → (1) full detail to Sentry (scrubbed, faults only) and (2) a SAFE
// client shape: { error: { code, message, ref } }. No stack / file / source ever
// reaches the client in production.
import "server-only";
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { AppError, toClientError, type ClientError, type ErrorCode } from "@/lib/erp/error-codes";

interface Classified {
  code: ErrorCode;
  status: number;
  expected: boolean;
  message: string;
}

export function classifyError(err: unknown): Classified {
  if (err instanceof AppError) {
    return { code: err.code, status: err.status, expected: err.expected, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/not authoriz|unauthorized|forbidden|permission denied|only admin|42501/i.test(message)) {
    return { code: "NOT_AUTHORIZED", status: 403, expected: true, message };
  }
  if (/timeout|timed out|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|connection|pooler/i.test(message)) {
    return { code: "DB_UNAVAILABLE", status: 503, expected: false, message };
  }
  return { code: "UNKNOWN", status: 500, expected: false, message };
}

/**
 * Build the JSON error response. Genuine faults are captured to Sentry (the SDK's
 * beforeSend scrubs the payload); expected outcomes (auth denials, validation) are
 * NOT reported, to protect the free quota. Returns only the safe client shape.
 */
export function errorResponse(err: unknown, fallback?: ErrorCode): NextResponse {
  const c = classifyError(err);
  const code: ErrorCode = c.code === "UNKNOWN" && fallback ? fallback : c.code;
  const ref = c.expected ? null : Sentry.captureException(err) || null;
  const error: ClientError & { detail?: string } = toClientError(code, ref);
  // Dev-only debugging aid — never serialized in production.
  if (process.env.NODE_ENV !== "production") error.detail = c.message;
  return NextResponse.json({ error }, { status: c.status });
}

export { AppError } from "@/lib/erp/error-codes";
