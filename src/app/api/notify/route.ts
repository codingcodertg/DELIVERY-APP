import { NextResponse } from "next/server";
import { ringcentralConfigured, ringcentralSms } from "@/lib/ringcentral";
import { emailConfigured, resendFrom } from "@/lib/email";

import { requireUser } from "@/lib/api-auth";

// ============================================================
// Outbound customer notifications (#21) — email / SMS at key delivery stages.
//
// This is a provider-agnostic scaffold. It validates the request and, when the
// matching credentials are present in the environment, sends via that provider.
// With no credentials set it runs in "dry-run" mode (logs + returns ok:false,
// dryRun:true) so the rest of the app works without a paid account.
//
// SMS goes through RingCentral (preferred) when configured, else Twilio.
//
// To go live, set:
//   RingCentral SMS: RINGCENTRAL_CLIENT_ID + RINGCENTRAL_CLIENT_SECRET
//                    + RINGCENTRAL_JWT + RINGCENTRAL_FROM  (+ optional RINGCENTRAL_SERVER)
//   Twilio SMS:      TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM
//   Email:           RESEND_API_KEY + a sender — either RESEND_EMAIL_DOMAIN
//                    (auto-set by the Vercel↔Resend integration) or an
//                    explicit NOTIFY_FROM_EMAIL override. See lib/email.ts.
// ============================================================

interface NotifyBody {
  channel: "email" | "sms";
  to: string;
  subject?: string;
  message: string;
}

// Report which providers are configured (no secrets) so the UI can pick the
// right send path and show accurate guidance.
export async function GET() {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const ringcentral = !!(process.env.RINGCENTRAL_CLIENT_ID && process.env.RINGCENTRAL_JWT && process.env.RINGCENTRAL_FROM);
  const twilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
  const email = emailConfigured();
  return NextResponse.json({
    sms: ringcentral ? "ringcentral" : twilio ? "twilio" : null,
    ringcentral, twilio, email,
  });
}

export async function POST(req: Request) {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: NotifyBody;
  try {
    body = (await req.json()) as NotifyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.to || !body?.message || !body?.channel) {
    return NextResponse.json({ error: "channel, to and message are required" }, { status: 400 });
  }

  try {
    if (body.channel === "email") {
      const key = process.env.RESEND_API_KEY;
      const from = resendFrom();
      if (!key || !from) return NextResponse.json({ ok: false, dryRun: true, reason: "email provider not configured" });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: body.to, subject: body.subject || "Delivery update", text: body.message }),
      });
      if (!res.ok) return NextResponse.json({ error: `email send failed (${res.status})` }, { status: 502 });
      return NextResponse.json({ ok: true, channel: "email" });
    }

    if (body.channel === "sms") {
      // Prefer RingCentral when configured.
      if (ringcentralConfigured() && process.env.RINGCENTRAL_FROM) {
        await ringcentralSms(body.to, body.message);
        return NextResponse.json({ ok: true, channel: "sms", provider: "ringcentral" });
      }
      // Fall back to Twilio.
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_FROM;
      if (!sid || !token || !from) return NextResponse.json({ ok: false, dryRun: true, reason: "sms provider not configured (set RingCentral or Twilio env vars)" });
      const form = new URLSearchParams({ To: body.to, From: from, Body: body.message });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      if (!res.ok) return NextResponse.json({ error: `sms send failed (${res.status})` }, { status: 502 });
      return NextResponse.json({ ok: true, channel: "sms", provider: "twilio" });
    }

    return NextResponse.json({ error: "Unknown channel" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
