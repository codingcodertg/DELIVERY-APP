import { NextResponse } from "next/server";
import { ringcentralConfigured, ringcentralRingOut, ringcentralRingOutStatus, ringcentralRingOutCancel } from "@/lib/ringcentral";

import { requireUser } from "@/lib/api-auth";

// ============================================================
// Click-to-call via RingCentral RingOut (#driver "Call client" on desktop).
// RingOut first rings the AGENT's phone (`from`), and once they pick up it
// connects them to the customer (`to`). Works from a desktop — no dialer app.
//
// `from` defaults to RINGCENTRAL_RINGOUT_FROM (the phone that should ring, e.g.
// the dispatcher's / driver's line), falling back to RINGCENTRAL_FROM.
// ============================================================

export async function GET(req: Request) {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  // ?id=<callId> polls a live call's status; otherwise reports config readiness.
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    if (!ringcentralConfigured()) return NextResponse.json({ error: "RingCentral not configured" }, { status: 400 });
    try {
      return NextResponse.json({ ok: true, ...(await ringcentralRingOutStatus(id)) });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }
  return NextResponse.json({
    ready: ringcentralConfigured() && !!(process.env.RINGCENTRAL_RINGOUT_FROM || process.env.RINGCENTRAL_FROM),
    from: process.env.RINGCENTRAL_RINGOUT_FROM || process.env.RINGCENTRAL_FROM || null,
  });
}

export async function POST(req: Request) {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: { to?: string; from?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const to = body?.to?.trim();
  if (!to) return NextResponse.json({ error: "A destination number (to) is required" }, { status: 400 });

  if (!ringcentralConfigured()) {
    return NextResponse.json({ ok: false, dryRun: true, reason: "RingCentral not configured" });
  }
  const from = body?.from?.trim() || process.env.RINGCENTRAL_RINGOUT_FROM || process.env.RINGCENTRAL_FROM;
  if (!from) return NextResponse.json({ error: "No caller (from) number configured" }, { status: 400 });

  try {
    const { id, status } = await ringcentralRingOut(from, to);
    return NextResponse.json({ ok: true, id, status, from });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

// Hang up / cancel an in-progress call: DELETE /api/call?id=<callId>
export async function DELETE(req: Request) {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!ringcentralConfigured()) return NextResponse.json({ error: "RingCentral not configured" }, { status: 400 });
  try {
    await ringcentralRingOutCancel(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
