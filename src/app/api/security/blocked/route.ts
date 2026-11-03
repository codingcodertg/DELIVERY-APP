import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { dispositivoDeLaPeticion } from "@/lib/security/reglas";

export const runtime = "nodejs";

/**
 * La pantalla «La web app ya no está disponible» (D-816) anota aquí que se le cerró la web a esta persona (D-818, 232):
 * quién (la sesión), desde qué dispositivo, con qué navegador y adónde iba. El admin lo ve en Security.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const d = dispositivoDeLaPeticion({ cabecera: req.headers.get("x-rtg-device"), cookie: req.headers.get("cookie") });
  let path = "";
  try { const b = await req.json(); if (typeof b?.path === "string") path = b.path; } catch { /* sin ruta */ }
  const { data, error } = await auth.supabase.rpc("security_note_web_block", { p_device: d?.id ?? null, p_path: path, p_user_agent: req.headers.get("user-agent") ?? "" });
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 200 });
  return NextResponse.json({ ok: data === true });
}
