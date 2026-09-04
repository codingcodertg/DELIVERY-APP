// ============================================================
// Outbound email configuration (server-only).
//
// Email goes through Resend. The API key comes from RESEND_API_KEY. The
// "from" address is resolved in priority order:
//   1. NOTIFY_FROM_EMAIL — an explicit override (e.g. "RDZ <hi@company.com>").
//   2. RESEND_EMAIL_DOMAIN — the domain the Vercel↔Resend marketplace
//      integration provisions; we send as notifications@<that domain>.
// With neither present there's no verified sender, so callers fall back to
// dry-run instead of attempting (and failing) a send.
// ============================================================

/** The RFC-5322 "from" address for outbound mail, or null if none is configured. */
export function resendFrom(): string | null {
  const explicit = process.env.NOTIFY_FROM_EMAIL?.trim();
  if (explicit) return explicit;
  const domain = process.env.RESEND_EMAIL_DOMAIN?.trim();
  if (domain) return `RTG Hub <notifications@${domain}>`;
  return null;
}

/** True when a real send can be attempted (key + a usable from address). */
export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && resendFrom());
}
