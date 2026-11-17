import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { limita, respuesta429 } from "@/lib/rate-limit";
import { requireAdminOutlook } from "@/lib/outlook/acceso";
import { respuestaSinAcceso } from "@/lib/outlook/acceso-respuesta";
import type { FaseBackfill } from "@/lib/outlook/sincronizar";
import { importarLoteGmail } from "@/lib/gmail/revision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * «Importar anteriores» de Gmail: UN lote de 50 correos de Indeed de la bandeja (toda la lista, sin mirar el cursor), para
 * una fase («solicitud» y luego «mensaje»). El cliente repite con `siguiente`. Volver a llamarlo no duplica nada.
 */
export async function POST(req: Request) {
  const acceso = await requireAdminOutlook();
  if (!acceso.ok) return respuestaSinAcceso(acceso);
  const lim = await limita(req, { clave: "gmail-anteriores", max: 300, ventanaSeg: 60 });
  if (!lim.ok) return respuesta429(lim.reset);

  let cuerpo: { fase?: unknown; saltar?: unknown };
  try {
    cuerpo = (await req.json()) as typeof cuerpo;
  } catch {
    return NextResponse.json({ error: "Cuerpo no válido." }, { status: 400 });
  }
  const fase = cuerpo.fase === "solicitud" || cuerpo.fase === "mensaje" ? (cuerpo.fase as FaseBackfill) : null;
  if (!fase) return NextResponse.json({ error: "Fase no válida." }, { status: 400 });
  const saltar =
    typeof cuerpo.saltar === "number" && Number.isInteger(cuerpo.saltar) && cuerpo.saltar >= 0 && cuerpo.saltar <= 100_000 ? cuerpo.saltar : null;
  if (saltar === null) return NextResponse.json({ error: "Posición no válida." }, { status: 400 });

  const r = await importarLoteGmail({ db: createAdminClient(), env: process.env, ahora: new Date() }, { fase, saltar });
  if (r.motivo === "no conectado") return NextResponse.json({ error: "Gmail no está conectado." }, { status: 400 });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
