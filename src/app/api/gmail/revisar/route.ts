import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { limita, respuesta429 } from "@/lib/rate-limit";
import { requireAdminOutlook } from "@/lib/outlook/acceso";
import { respuestaSinAcceso } from "@/lib/outlook/acceso-respuesta";
import { revisarGmail } from "@/lib/gmail/revision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** «Revisar ahora» de Gmail: la misma revisión que el cron, para un admin. */
export async function POST(req: Request) {
  const acceso = await requireAdminOutlook();
  if (!acceso.ok) return respuestaSinAcceso(acceso);
  const lim = await limita(req, { clave: "gmail-revisar", max: 20, ventanaSeg: 60 });
  if (!lim.ok) return respuesta429(lim.reset);

  const r = await revisarGmail({ db: createAdminClient(), env: process.env, ahora: new Date() });
  if (r.motivo === "no conectado") return NextResponse.json({ error: "Gmail no está conectado." }, { status: 400 });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
