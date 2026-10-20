import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fcmConfigured, sendPush } from "@/lib/fcm";
import { KIND_CHAT, cuerpoValido, llevaPush, textoDelAviso } from "@/lib/chat/chat";

// ============================================================
// POST /api/chat/send · { to, body } (D-NEXT, 2026-10-20; migración 184). Manda un mensaje del chat interno:
//   1. la fila en `chat_messages`, con la SESIÓN del remitente (la RLS exige from_user = auth.uid());
//   2. el aviso en la campana del destinatario (`notifications`, kind «chat»), como cualquier otro aviso;
//   3. si quien escribe es ADMIN, además el push al teléfono (FCM a sus `device_tokens`, lo mismo que `/api/push`).
//      El dueño: «si es un admin siempre son como que push messages, para que le caiga a la persona».
// Sin remitente con sesión no hay mensaje (`requireUser`). El rol se lee del perfil en la base, no del cuerpo.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => ({}));
  const to = typeof b?.to === "string" ? b.to : "";
  const body = cuerpoValido(typeof b?.body === "string" ? b.body : "");
  if (!to || !body) return NextResponse.json({ error: "to and body required" }, { status: 400 });
  if (to === auth.user.id) return NextResponse.json({ error: "cannot message yourself" }, { status: 400 });

  const { data: yo, error: e0 } = await auth.supabase.from("profiles").select("id, full_name, role").eq("id", auth.user.id).maybeSingle();
  if (e0 || !yo) return NextResponse.json({ error: e0?.message ?? "No profile" }, { status: 503 });

  const { data: msg, error } = await auth.supabase.from("chat_messages")
    .insert({ from_user: auth.user.id, to_user: to, body }).select("id, created_at").single();
  if (error || !msg) return NextResponse.json({ error: error?.message ?? "Not saved" }, { status: 400 });

  const admin = createAdminClient();
  const aviso = textoDelAviso(yo.full_name, body);
  const { data: notif } = await admin.from("notifications")
    .insert({ user_id: to, kind: KIND_CHAT, message: aviso }).select("id").single();

  let push: { sent: number; dropped: number } | null = null;
  if (llevaPush(yo.role) && fcmConfigured()) {
    const { data: rows } = await admin.from("device_tokens").select("token").eq("user_id", to);
    const tokens = (rows ?? []).map((r) => r.token as string);
    if (tokens.length) {
      const r = await sendPush(tokens, { title: "RTG Hub", body: aviso, data: { kind: KIND_CHAT, from: auth.user.id } });
      if (r.dead.length) await admin.from("device_tokens").delete().in("token", r.dead);
      push = { sent: r.sent, dropped: r.dead.length };
    } else push = { sent: 0, dropped: 0 };
  }
  return NextResponse.json({ id: msg.id, created_at: msg.created_at, notification_id: notif?.id ?? null, push });
}
