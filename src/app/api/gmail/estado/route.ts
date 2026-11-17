import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminOutlook } from "@/lib/outlook/acceso";
import { respuestaSinAcceso } from "@/lib/outlook/acceso-respuesta";
import { estadoGmail } from "@/lib/gmail/revision";

export const dynamic = "force-dynamic";

/** Lo que muestra la tarjeta de Gmail. Nunca devuelve la contraseña (ni cifrada): solo si hay una guardada. */
export async function GET() {
  const acceso = await requireAdminOutlook();
  if (!acceso.ok) return respuestaSinAcceso(acceso);
  const estado = await estadoGmail(createAdminClient(), process.env, new Date());
  return NextResponse.json(estado);
}
