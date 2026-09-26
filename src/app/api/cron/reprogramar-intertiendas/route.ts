import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/clockin/cronAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ejecutarReprogramacion } from "@/lib/reprogramar-intertiendas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron: las Intertiendas que no se entregaron pasan solas a hoy (D-406).
 *
 * Programada en vercel.json a las 07:05 UTC (02:05 en Texas en verano, 01:05 en invierno). Vercel
 * Hobby la dispara dentro de esa hora, así que corre siempre ya pasada la medianoche de Texas.
 *
 * - Autorización: `cronAuthorized` — `Authorization: Bearer <CRON_SECRET>` (lo que manda Vercel Cron)
 *   o `?key=`. Sin secreto configurado, nadie pasa.
 * - `?verify=1`: confirma el secreto con 200 sin leer ni escribir nada (como las demás rutas de cron).
 * - `?ensayo=1`: lee y aplica la regla, NO escribe, y devuelve lo que haría.
 * - Llave de servicio: el cron no tiene sesión. Con `auth.uid()` nulo, `guard_delivery_stage` (145) y
 *   `guard_factura_obligatoria` (146) dejan pasar, y esta ruta solo cambia la fecha.
 *
 * La regla y la escritura (fecha + evento con el valor anterior) viven en lib/reprogramar-intertiendas.ts.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  if (url.searchParams.get("verify") === "1") {
    return NextResponse.json({ ok: true, verify: true });
  }
  const ensayo = url.searchParams.get("ensayo") === "1";
  const informe = await ejecutarReprogramacion(createAdminClient(), { ensayo });
  // Segunda copia de «de qué día venía cada una», en los logs de Vercel, por si el historial no basta.
  console.log("[reprogramar-intertiendas]", JSON.stringify({ ensayo, hoy: informe.hoy, movidas: informe.movidas, ordenes: informe.ordenes, fallos: informe.fallos }));
  return NextResponse.json(informe, { status: informe.ok ? 200 : informe.error ? 502 : 207 });
}
