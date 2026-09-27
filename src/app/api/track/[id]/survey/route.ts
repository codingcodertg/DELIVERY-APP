import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esIdDeOrden, faltaLaTabla, sePuedeCalificar, validaRespuesta } from "@/lib/encuesta";

// ============================================================
// La encuesta de la página pública de seguimiento (D-418, migración 151). El cliente abre /track/<id> sin login y,
// con la orden ENTREGADA, puede dejar 1-5 estrellas y un comentario. Una respuesta por orden.
//
// POR QUÉ UNA RUTA DEL SERVIDOR y no un insert anónimo: `delivery_surveys` no tiene NINGUNA política de escritura
// (ni para `anon` ni para `authenticated`); solo escribe la llave de servicio, y solo aquí, después de comprobar:
//   1. que el id tiene forma de uuid (el de la orden, 122 bits al azar: quien no tiene el enlace no lo adivina);
//   2. que el cuerpo es pequeño y vale (estrellas enteras 1-5, comentario ≤ 500);
//   3. que la orden existe y está entregada;
// y la base vuelve a exigir (2) con sus `check`, (3) con su disparador, y «una por orden» con la clave primaria.
//
// NO devuelve nada de la orden: ni la cuenta, ni la dirección, ni la respuesta. Solo si se guardó.
// NO manda nada a nadie (ni SMS ni correo): el dueño pidió la encuesta EN la página.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Un cuerpo de más de esto no es una encuesta. */
const MAX_BYTES = 2048;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !esIdDeOrden(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const texto = await req.text().catch(() => "");
  if (texto.length > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let cuerpo: unknown = null;
  try { cuerpo = JSON.parse(texto); } catch { /* cae en la validación */ }
  const v = validaRespuesta(cuerpo);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Surveys are not configured." }, { status: 500 });
  }

  const { data: orden, error: alLeer } = await admin.from("deliveries").select("stage").eq("id", id).maybeSingle();
  if (alLeer) return NextResponse.json({ error: "Lookup failed" }, { status: 502 });
  if (!orden) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sePuedeCalificar(orden.stage)) return NextResponse.json({ error: "This delivery can be rated once it's delivered." }, { status: 409 });

  const { error } = await admin.from("delivery_surveys").insert({ delivery_id: id, rating: v.respuesta.rating, comment: v.respuesta.comment });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ ok: true, already: true }, { status: 409 });
    if (faltaLaTabla(error)) return NextResponse.json({ error: "Surveys are not available yet." }, { status: 503 });
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
