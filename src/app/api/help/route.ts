import { NextResponse } from "next/server";
import { DEFAULT_HELP_EMAIL } from "@/lib/constants";
import { resendFrom } from "@/lib/email";

import { requireUser } from "@/lib/api-auth";

// ============================================================
// In-app Help button (#help) — emails a support request to the address an
// admin configures in Settings (Settings.help_email, default DEFAULT_HELP_EMAIL).
//
// The client sends the user's message plus lightweight context (who they are,
// which page they were on, the app version). We compose a readable support
// email and deliver it through Resend — the same provider the customer-
// notification path uses. With RESEND_API_KEY / NOTIFY_FROM_EMAIL unset it
// runs in dry-run mode (ok:false, dryRun:true) so the button still "works"
// in local/demo without a mail account.
//
// replyTo is set to the requester's email so hitting reply reaches them.
// ============================================================

export const runtime = "nodejs";

interface HelpBody {
  message: string;
  to?: string;          // help recipient (Settings.help_email); server clamps to a default
  page?: string;        // where the user was when they tapped Help
  senderName?: string;
  senderEmail?: string;
  role?: string;
  appVersion?: string;
  lang?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: Request) {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: HelpBody;
  try {
    body = (await req.json()) as HelpBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = (body.message || "").trim();
  if (!message) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

  const to = EMAIL_RE.test((body.to || "").trim()) ? body.to!.trim() : DEFAULT_HELP_EMAIL;
  const senderEmail = (body.senderEmail || "").trim();
  const who = body.senderName?.trim() || senderEmail || "A user";
  const roleLabel = body.role ? ` (${body.role})` : "";

  const subject = `Help request from ${who}${roleLabel}`;
  const text = [
    message,
    "",
    "———",
    `From: ${who}${senderEmail ? ` <${senderEmail}>` : ""}${roleLabel}`,
    body.page ? `Page: ${body.page}` : null,
    body.appVersion ? `App version: ${body.appVersion}` : null,
    body.lang ? `Language: ${body.lang}` : null,
    `Sent: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n");

  const key = process.env.RESEND_API_KEY;
  const from = resendFrom();
  if (!key || !from) {
    // No mail provider yet — don't fail the button; report dry-run so the UI
    // can tell the user their request was recorded but email isn't live.
    return NextResponse.json({ ok: false, dryRun: true, reason: "email provider not configured", to });
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject,
        text,
        ...(EMAIL_RE.test(senderEmail) ? { reply_to: senderEmail } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ error: `email send failed (${res.status})`, detail }, { status: 502 });
    }
    return NextResponse.json({ ok: true, to });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
