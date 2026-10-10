import { NextResponse } from "next/server";
import { emailConfigured } from "@/lib/email";
import { proveedorReal } from "@/lib/mensajeria";

import { requireDeliveries } from "@/lib/api-auth";

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
  // Y sin el módulo de Entregas tampoco (D-NEXT): quién puede mandar, y qué proveedor hay puesto,
  // es cosa de Entregas — la pantalla que lo pregunta solo existe dentro de una ficha de orden.
  const auth = await requireDeliveries();
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
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet. Y sin el módulo de
  // Entregas tampoco (D-NEXT): esto manda un SMS o un correo DE VERDAD, desde el número y el
  // dominio de la empresa, y hasta ahora valía cualquier sesión — la de quien solo ficha incluida.
  const auth = await requireDeliveries();
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

  // El envío vive en lib/mensajeria.ts (D-416): el mismo que usan los avisos automáticos al cliente.
  if (body.channel !== "email" && body.channel !== "sms") {
    return NextResponse.json({ error: "Unknown channel" }, { status: 400 });
  }
  try {
    const r = body.channel === "email"
      ? await proveedorReal.correo(body.to, body.subject || "Delivery update", body.message)
      : await proveedorReal.sms(body.to, body.message);
    if (r.ok) return NextResponse.json(body.channel === "email" ? { ok: true, channel: "email" } : { ok: true, channel: "sms", provider: r.proveedor });
    if (r.dryRun) return NextResponse.json({ ok: false, dryRun: true, reason: r.motivo });
    return NextResponse.json({ error: r.error }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
