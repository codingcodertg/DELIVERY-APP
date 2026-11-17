import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fcmConfigured, sendPush } from "@/lib/fcm";
import { claseDelAviso } from "@/lib/clase-del-aviso";

// ============================================================
// Push one already-created in-app notification to its recipient's phones.
//
// The caller passes only an id. The message, and crucially WHO it goes to, are
// read back from the database with the service role — a caller cannot choose a
// recipient or invent a message, so this can't become a way to buzz the whole
// company. A session is still required, so it isn't open to the world either.
//
// The bell row is written first and is the record; this is best-effort on top.
// It never reports failure upward: a push that didn't go out must not make a
// dispatcher believe the assignment itself failed.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Roles que dan la mano en todo el hub: pueden avisar a cualquiera (son quienes publican rutas y asignan). */
const ROLES_QUE_AVISAN_A_CUALQUIERA = ["admin", "manager", "logistics"];

/**
 * ¿Puede quien llama empujar este aviso? Sí si:
 *  · el aviso es para él mismo;
 *  · es admin, gerente o logística (publican rutas y asignan a los choferes);
 *  · el aviso va de una entrega que ya puede leer con su sesión (RLS): quien asigna o toma una orden, o el chofer
 *    que cierra una parada y avisa a ventas. Si la RLS no le deja ver la entrega, no le deja avisar de ella.
 * Un aviso sin entrega y de otra persona (p. ej. ayuda de otro usuario) solo lo empuja un admin, arriba.
 */
async function puedeEmpujarAviso(
  supabase: Awaited<ReturnType<typeof createClient>>,
  yoId: string,
  notif: { user_id: string; delivery_id: string | null },
): Promise<boolean> {
  if (notif.user_id === yoId) return true;
  const { data: yo } = await supabase.from("profiles").select("role").eq("id", yoId).maybeSingle();
  if (yo?.role && ROLES_QUE_AVISAN_A_CUALQUIERA.includes(yo.role as string)) return true;
  if (!notif.delivery_id) return false;
  const { data: entrega } = await supabase.from("deliveries").select("id").eq("id", notif.delivery_id).maybeSingle();
  return !!entrega;
}

export async function POST(req: Request) {
  if (!fcmConfigured()) return NextResponse.json({ skipped: "push not configured" });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { notification_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad body" }, { status: 400 }); }
  const id = typeof body.notification_id === "string" ? body.notification_id : "";
  if (!id) return NextResponse.json({ error: "notification_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: notif } = await admin
    .from("notifications")
    .select("id, user_id, message, kind, delivery_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!notif) return NextResponse.json({ error: "No such notification" }, { status: 404 });

  // Solo se empuja un aviso que el que llama PUEDE mandar: el suyo, o uno de una entrega que ve (quien asigna, el
  // chofer que toma una orden, la ayuda del admin…). Sin esto, cualquier sesión podía hacer sonar el teléfono de otra
  // persona con un aviso recién creado. Ver `puedeEmpujarAviso`.
  if (!(await puedeEmpujarAviso(supabase, user.id, notif))) {
    return NextResponse.json({ error: "You can't send this notification." }, { status: 403 });
  }

  // D-880: solo los avisos importantes suenan en el teléfono. Los secundarios llegan igual a la campana, en silencio.
  if (claseDelAviso(notif.kind) !== "importante") return NextResponse.json({ skipped: "secondary" });

  // Only ever pushes something just created, so an old id can't be replayed to
  // buzz someone at midnight about last week's route.
  if (Date.now() - new Date(notif.created_at).getTime() > 5 * 60_000) {
    return NextResponse.json({ skipped: "too old" });
  }

  const { data: rows } = await admin.from("device_tokens").select("token").eq("user_id", notif.user_id);
  const tokens = (rows ?? []).map((r) => r.token as string);
  if (!tokens.length) return NextResponse.json({ sent: 0, reason: "no devices" });

  const res = await sendPush(tokens, {
    title: "RTG Hub",
    body: notif.message,
    data: { kind: notif.kind ?? "", delivery_id: notif.delivery_id ?? "" },
  });

  // Tokens Firebase says are gone stay gone; otherwise every future send pays
  // for a delivery to a phone that no longer exists.
  if (res.dead.length) await admin.from("device_tokens").delete().in("token", res.dead);

  return NextResponse.json({ sent: res.sent, dropped: res.dead.length, error: res.error });
}
