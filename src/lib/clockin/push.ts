import webpush from "web-push";

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@cadence.app";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export type PushSub = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/**
 * Send one Web Push notification. Returns { ok, gone } — `gone` is true when the
 * subscription is expired/invalid (404/410) and should be deleted.
 */
export async function sendPush(sub: PushSub, payload: PushPayload) {
  if (!ensureConfigured()) return { ok: false, gone: false };
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return { ok: true, gone: false };
  } catch (e: unknown) {
    const code = (e as { statusCode?: number })?.statusCode;
    return { ok: false, gone: code === 404 || code === 410 };
  }
}
