import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { limita, respuesta429 } from "@/lib/rate-limit";
import { MAX_CUERPO_INGESTA_BYTES, procesaElementoDeBot, tokenAutorizado, validaIngesta } from "@/lib/outlook/indeed-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Lo que manda el bot local de Indeed (`tools/indeed-bot`): hasta 25 elementos por envío, solicitudes o mensajes.
 * - `Authorization: Bearer <INDEED_BOT_TOKEN>`. Sin la variable en el servidor → 503 (nadie entra). Token ausente o
 *   distinto → 401. La comparación es de tiempo constante (`tokenAutorizado`).
 * - Límite por IP (60 por minuto): el bot manda uno o dos envíos por corrida.
 * - Cada elemento se procesa con la misma lógica que el buzón de Outlook (`procesaElementoDeBot`). Reenviar el mismo
 *   `externalId` no crea nada: vuelve como `skipped`.
 */
export async function POST(req: Request) {
  const esperado = process.env.INDEED_BOT_TOKEN?.trim();
  if (!esperado) return NextResponse.json({ error: "Indeed bot no configurado (falta INDEED_BOT_TOKEN)." }, { status: 503 });

  const lim = await limita(req, { clave: "indeed-bot-ingest", max: 60, ventanaSeg: 60 });
  if (!lim.ok) return respuesta429(lim.reset);

  if (!tokenAutorizado(req.headers.get("authorization"), esperado)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const crudo = await req.text();
  if (Buffer.byteLength(crudo, "utf8") > MAX_CUERPO_INGESTA_BYTES) {
    return NextResponse.json({ error: "El envío pasa de 4 MB: manda menos elementos o CV más pequeños." }, { status: 413 });
  }
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ error: "Cuerpo no válido." }, { status: 400 });
  }
  const v = validaIngesta(cuerpo);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const db = createAdminClient();
  const results = [];
  for (const it of v.items) results.push(await procesaElementoDeBot(db, it, new Date()));
  console.log(`[indeed-bot] envio=${results.length} ${results.map((r) => r.result).join(",")}`);
  return NextResponse.json({ ok: true, results });
}
