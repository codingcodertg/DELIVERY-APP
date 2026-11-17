import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminOutlook } from "@/lib/outlook/acceso";
import { respuestaSinAcceso } from "@/lib/outlook/acceso-respuesta";
import { desconectarGmail } from "@/lib/gmail/revision";

export const dynamic = "force-dynamic";

/** Desconecta Gmail: borra la fila (con la contraseña cifrada). El historial de correos procesados se conserva. */
export async function POST() {
  const acceso = await requireAdminOutlook();
  if (!acceso.ok) return respuestaSinAcceso(acceso);
  const ok = await desconectarGmail(createAdminClient());
  if (!ok) return NextResponse.json({ error: "No se pudo desconectar. Inténtalo de nuevo." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
