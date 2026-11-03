import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { dispositivoDeLaPeticion } from "@/lib/security/reglas";

export const runtime = "nodejs";

/**
 * «Solicitar autorización» desde la pantalla de bloqueo (D-811). Marca el dispositivo de ESTA petición con quién y qué
 * dijo; el admin lo ve arriba en Security y decide. No aprueba nada.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const d = dispositivoDeLaPeticion({ cabecera: req.headers.get("x-rtg-device"), cookie: req.headers.get("cookie") });
  if (!d) return NextResponse.json({ error: "No device id." }, { status: 400 });
  let nota = "";
  try { const b = await req.json(); if (typeof b?.nota === "string") nota = b.nota; } catch { /* sin nota */ }
  const { data, error } = await auth.supabase.rpc("security_request_access", { p_device: d.id, p_note: nota });
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 200 });
  return NextResponse.json({ ok: data === true });
}
