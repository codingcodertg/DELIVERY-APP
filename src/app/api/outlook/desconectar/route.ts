import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminOutlook } from "@/lib/outlook/acceso";
import { respuestaSinAcceso } from "@/lib/outlook/acceso-respuesta";

export const dynamic = "force-dynamic";

/** Desconecta: borra la fila, con el refresh token cifrado. El historial de correos procesados se conserva. */
export async function POST() {
  const acceso = await requireAdminOutlook();
  if (!acceso.ok) return respuestaSinAcceso(acceso);
  const { error } = await createAdminClient().schema("recruiting").from("outlook_connection").delete().eq("id", 1);
  if (error) return NextResponse.json({ error: "No se pudo desconectar. Inténtalo de nuevo." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
