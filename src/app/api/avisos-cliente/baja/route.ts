import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { darDeBaja } from "@/lib/avisos-cliente-envio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * La baja de los avisos al cliente (D-416, 150). Pública, sin sesión: la pide la página /unsubscribe/<token> al
 * pulsar el botón. Es POST y no GET a propósito: los antivirus de correo y las vistas previas de los mensajes abren
 * los enlaces solos, y un GET que da de baja daría de baja a quien no lo pidió.
 *
 * El token (16 caracteres, 96 bits aleatorios) es la única llave: dice qué aviso fue, y de ahí su teléfono y su
 * correo, que pasan a «no avisar» para todas las órdenes.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  let db;
  try { db = createAdminClient(); } catch { return NextResponse.json({ ok: false, motivo: "error" }, { status: 500 }); }
  const r = await darDeBaja(db, token);
  if (r.ok) return NextResponse.json(r);
  return NextResponse.json({ ok: false, motivo: r.motivo }, { status: r.motivo === "error" ? 502 : r.motivo === "token" ? 400 : 404 });
}
