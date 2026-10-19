import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { leerTokenDelCv, secretoDelCv } from "@/lib/recruiting/enlace-corto-del-cv";

// ============================================================
// GET /api/cv/<token> (D-593): el enlace corto del CV que RR. HH. pega al gerente. Pública a propósito —el gerente no
// tiene cuenta— y por eso la llave es el token firmado (`leerTokenDelCv`): sin firma válida o caducado, 404 sin decir
// cuál de las dos. Con token bueno: busca el CV del candidato con el cliente de servicio (RLS no aplica: no hay sesión)
// y redirige a un enlace firmado de Storage de un minuto, que es lo que el navegador abre.
// ============================================================

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const leido = leerTokenDelCv(token, secretoDelCv());
  if (!leido.ok) return new NextResponse("Not found", { status: 404 });
  const admin = createAdminClient();
  const { data: c } = await admin.schema("recruiting").from("candidates").select("resume_path").eq("id", leido.candidateId).maybeSingle();
  if (!c?.resume_path) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await admin.storage.from("resumes").createSignedUrl(c.resume_path, 60);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl, 302);
}
