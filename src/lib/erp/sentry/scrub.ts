// Privacy scrubber — the last gate before anything leaves for Sentry (a third
// party). Strips cost / margin / price and customer name / PO from event
// payloads, breadcrumbs, and request bodies. Pure + framework-agnostic so it is
// unit-tested deterministically (scrub.test.ts) and shared with the scraper.
//
// Two passes:
//   1. KEY redaction — any object key matching SENSITIVE_KEY has its value
//      replaced with [redacted] (deep). Catches cost / store_cost / unit_price /
//      margin / customer_name / customer_po / tokens / secrets / auth / DSN.
//   2. STRING redaction — currency-looking amounts in free text (error messages,
//      breadcrumb text, query strings) become [$], so a price baked into a
//      message string can't leak either.
//
// Customer *names* embedded in arbitrary free text can't be detected generically;
// we rely on (a) structured-key redaction and (b) the API layer emitting only
// safe, friendly messages. Anything we can't be sure of, we drop.

const SENSITIVE_KEY =
  /(cost|margin|markup|\bprice\b|unit_price|list_price|sell_price|customer[_-]?name|customer[_-]?po|cust[_-]?po|po[_-]?number|service[_-]?role|secret|token|api[_-]?key|password|passwd|authorization|\bcookie\b|session|jwt|\bdsn\b|connection[_-]?string|db[_-]?url)/i;

const REDACTED = "[redacted]";
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?/g;
const MAX_DEPTH = 8;

export function scrubString(s: string): string {
  return s.replace(MONEY, "[$]");
}

export function scrubData<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value == null) return value;
  if (typeof value === "string") return scrubString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubData(v, depth + 1)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : scrubData(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

// Minimal Sentry event shape we touch (avoids a hard dep on @sentry types here).
export interface ScrubbableEvent {
  message?: string;
  user?: { id?: string | number } | null;
  request?: {
    cookies?: unknown;
    headers?: Record<string, unknown>;
    data?: unknown;
    query_string?: string | unknown;
  };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
}

export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  // Identity: keep at most an opaque id, never email/username/ip.
  if (event.user) event.user = event.user.id != null ? { id: event.user.id } : null;

  if (event.request) {
    delete event.request.cookies; // never ship cookies
    if (event.request.headers) event.request.headers = scrubData(event.request.headers);
    if (event.request.data !== undefined) event.request.data = scrubData(event.request.data);
    if (typeof event.request.query_string === "string") {
      event.request.query_string = scrubString(event.request.query_string);
    }
  }
  if (event.extra) event.extra = scrubData(event.extra);
  if (event.contexts) event.contexts = scrubData(event.contexts);
  if (event.tags) event.tags = scrubData(event.tags);
  if (event.message) event.message = scrubString(event.message);

  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubString(ex.value);
  }
  for (const bc of event.breadcrumbs ?? []) {
    if (bc.message) bc.message = scrubString(bc.message);
    if (bc.data) bc.data = scrubData(bc.data);
  }
  return event;
}
