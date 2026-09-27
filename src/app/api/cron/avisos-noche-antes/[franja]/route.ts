import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/clockin/cronAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ejecutarNocheAntes, origenPublico } from "@/lib/avisos-cliente-envio";
import { proveedorDelEntorno } from "@/lib/mensajeria";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron: el aviso al cliente de la NOCHE ANTES (D-416, migración 150).
 *
 * `vercel.json` la programa una vez al día por cada hora UTC de 17 a 02 (`/api/cron/avisos-noche-antes/17` …
 * `/02`): Vercel Hobby solo admite crons diarios, así que «a la hora que elija el dueño» se consigue con una entrada
 * diaria por hora y la hora se decide AQUÍ, contra Ajustes (`tocaNocheAntes`). `[franja]` no decide nada: solo hace
 * distinta cada ruta y sale en el log. Con el aviso apagado cada llamada lee una fila de settings y vuelve.
 *
 * - Autorización: `cronAuthorized` (`Authorization: Bearer <CRON_SECRET>`, que manda Vercel Cron, o `?key=`).
 * - `?verify=1`: confirma el secreto sin leer nada.
 * - `?ensayo=1`: lee y decide, NO reclama ni envía; devuelve a quién mandaría.
 * - En el demo (NEXT_PUBLIC_LOCAL_MODE) el proveedor es el stub (`proveedorDelEntorno`).
 */
export async function GET(req: Request, { params }: { params: Promise<{ franja: string }> }) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { franja } = await params;
  const url = new URL(req.url);
  if (url.searchParams.get("verify") === "1") return NextResponse.json({ ok: true, verify: true });
  const ensayo = url.searchParams.get("ensayo") === "1";
  let db;
  try { db = createAdminClient(); } catch { return NextResponse.json({ error: "not configured" }, { status: 500 }); }
  const informe = await ejecutarNocheAntes({ db, proveedor: proveedorDelEntorno(), origen: origenPublico(req.url) }, { ensayo });
  const cuenta = (informe.resultados ?? []).reduce<Record<string, number>>((m, r) => ({ ...m, [r.estado]: (m[r.estado] ?? 0) + 1 }), {});
  console.log("[avisos-noche-antes]", JSON.stringify({ franja, ensayo, ok: informe.ok, apagado: informe.apagado, fueraDeHora: informe.fueraDeHora, manana: informe.manana, revisadas: informe.revisadas, cuenta, error: informe.error }));
  return NextResponse.json(informe, { status: informe.ok ? 200 : informe.error ? 502 : 207 });
}
