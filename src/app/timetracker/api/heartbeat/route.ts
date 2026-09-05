import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El último latido antes de descargar la página (D-195).
 *
 * Cuando el banner de actualización recarga, o la pestaña se cierra, o el escritorio hace F5,
 * el tick de diez segundos ya no llega a escribir. `navigator.sendBeacon` es lo único que el
 * navegador garantiza que sale durante `pagehide`, y no acepta cabeceras ni espera respuesta:
 * por eso esto es una ruta propia y no una llamada más al cliente de Supabase.
 *
 * Quién puede escribir qué: el usuario de la cookie de sesión (mismo `createClient` de servidor
 * que las puertas de página), y solo SU sesión viva (`employee_uid = user.id`, `is_live = true`).
 * Con eso, aunque el cuerpo lo fabrique cualquiera, no puede tocar la fila de otro ni reabrir
 * una cerrada. Los campos aceptados son exactamente los que escribe el tick; nada más pasa.
 *
 * El cuerpo viaja como `text/plain` a propósito: un Blob JSON en `sendBeacon` fuerza CORS
 * preflight en algunos navegadores y el beacon se pierde en silencio.
 */
const NUM = ["endMs", "durationSeconds", "activeSeconds", "idleSeconds", "keystrokes", "clicks", "lunchSeconds", "breakSeconds"] as const;
const SNAKE: Record<(typeof NUM)[number], string> = {
  endMs: "end_ms", durationSeconds: "duration_seconds", activeSeconds: "active_seconds", idleSeconds: "idle_seconds",
  keystrokes: "keystrokes", clicks: "clicks", lunchSeconds: "lunch_seconds", breakSeconds: "break_seconds",
};

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = JSON.parse(await req.text()); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const row: Record<string, unknown> = {};
  for (const k of NUM) {
    const v = body[k];
    if (typeof v === "number" && Number.isFinite(v)) row[SNAKE[k]] = v;
  }
  if (typeof body.liveNote === "string" || body.liveNote === null) row.live_note = body.liveNote;
  if (Array.isArray(body.breakEvents)) row.break_events = body.breakEvents;
  if (typeof row.end_ms !== "number") return NextResponse.json({ error: "missing_end_ms" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .schema("timetracker")
    .from("sessions")
    .update(row)
    .eq("id", id)
    .eq("employee_uid", user.id)
    .eq("is_live", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
