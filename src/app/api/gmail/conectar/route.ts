import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { limita, respuesta429 } from "@/lib/rate-limit";
import { requireAdminOutlook } from "@/lib/outlook/acceso";
import { respuestaSinAcceso } from "@/lib/outlook/acceso-respuesta";
import { conectarGmail } from "@/lib/gmail/revision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** «Guardar y probar»: entra por IMAP con la contraseña de aplicación y, si entra, la guarda cifrada. Solo admin. */
export async function POST(req: Request) {
  const acceso = await requireAdminOutlook();
  if (!acceso.ok) return respuestaSinAcceso(acceso);
  const lim = await limita(req, { clave: "gmail-conectar", max: 10, ventanaSeg: 60 });
  if (!lim.ok) return respuesta429(lim.reset);

  let cuerpo: { email?: unknown; password?: unknown };
  try {
    cuerpo = (await req.json()) as typeof cuerpo;
  } catch {
    return NextResponse.json({ error: "Cuerpo no válido." }, { status: 400 });
  }
  const email = typeof cuerpo.email === "string" ? cuerpo.email.trim().toLowerCase() : "";
  const password = typeof cuerpo.password === "string" ? cuerpo.password : "";
  if (!/^[^\s@]+@gmail\.com$/.test(email)) {
    return NextResponse.json({ error: "Escribe la dirección de Gmail (termina en @gmail.com)." }, { status: 400 });
  }
  if (password.replace(/\s+/g, "").length < 8 || password.length > 100) {
    return NextResponse.json({ error: "Escribe la contraseña de aplicación de Google." }, { status: 400 });
  }

  const r = await conectarGmail(
    { db: createAdminClient(), env: process.env, ahora: new Date() },
    { email, password, userId: acceso.userId },
  );
  if (!r.ok) return NextResponse.json({ error: r.motivo }, { status: 400 });
  return NextResponse.json({ ok: true, visibles: r.visibles });
}
