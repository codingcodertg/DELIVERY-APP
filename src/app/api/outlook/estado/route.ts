import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { estadoOutlook } from "@/lib/outlook/sincronizar";
import { requireAdminOutlook } from "@/lib/outlook/acceso";
import { respuestaSinAcceso } from "@/lib/outlook/acceso-respuesta";

export const dynamic = "force-dynamic";

/** Lo que muestra la tarjeta de Ajustes. No devuelve tokens ni la llave: solo el buzón, fechas, errores y resultados. */
export async function GET() {
  const acceso = await requireAdminOutlook();
  if (!acceso.ok) return respuestaSinAcceso(acceso);
  const estado = await estadoOutlook(createAdminClient(), process.env, new Date());
  return NextResponse.json(estado);
}
