import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { limita, respuesta429 } from "@/lib/rate-limit";
import { instanteDePared } from "@/lib/recruiting/hora-de-brownsville";
import { requireAdminOutlook } from "@/lib/outlook/acceso";
import { respuestaSinAcceso } from "@/lib/outlook/acceso-respuesta";
import { procesarLoteAntiguo, type FaseBackfill } from "@/lib/outlook/sincronizar";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DIAS_MAXIMO = 180;

/**
 * «Procesar correos anteriores»: UN lote de 50 correos de la bandeja desde `desde`, para una fase. El cliente repite
 * con `siguiente` hasta que no haya más. Solo admin. Volver a llamarlo no duplica nada (lo reclamado se salta).
 */
export async function POST(req: Request) {
  const acceso = await requireAdminOutlook();
  if (!acceso.ok) return respuestaSinAcceso(acceso);
  const lim = await limita(req, { clave: "outlook-backfill", max: 300, ventanaSeg: 60 });
  if (!lim.ok) return respuesta429(lim.reset);

  let cuerpo: { desde?: unknown; fase?: unknown; saltar?: unknown };
  try {
    cuerpo = (await req.json()) as typeof cuerpo;
  } catch {
    return NextResponse.json({ error: "Cuerpo no válido." }, { status: 400 });
  }
  const desde = typeof cuerpo.desde === "string" ? cuerpo.desde : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return NextResponse.json({ error: "Fecha no válida." }, { status: 400 });
  const desdeIso = instanteDePared(`${desde}T00:00`)?.toISOString() ?? null;
  const dias = desdeIso ? (Date.now() - Date.parse(desdeIso)) / 86_400_000 : Number.NaN;
  if (!desdeIso || Number.isNaN(dias) || dias < 0 || dias > DIAS_MAXIMO) {
    return NextResponse.json({ error: `La fecha debe estar en los últimos ${DIAS_MAXIMO} días.` }, { status: 400 });
  }
  const fase = cuerpo.fase === "solicitud" || cuerpo.fase === "mensaje" ? (cuerpo.fase as FaseBackfill) : null;
  if (!fase) return NextResponse.json({ error: "Fase no válida." }, { status: 400 });
  const saltar = typeof cuerpo.saltar === "number" && Number.isInteger(cuerpo.saltar) && cuerpo.saltar >= 0 && cuerpo.saltar <= 100_000 ? cuerpo.saltar : null;
  if (saltar === null) return NextResponse.json({ error: "Posición no válida." }, { status: 400 });

  const r = await procesarLoteAntiguo({ db: createAdminClient(), env: process.env, ahora: new Date(), desdeIso, fase, saltar });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
