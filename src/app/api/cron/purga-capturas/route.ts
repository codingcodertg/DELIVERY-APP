import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/clockin/cronAuth";
import { purgaCapturas } from "@/lib/timetracker/purga-capturas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron diario (vercel.json, 03:00 UTC): borra las capturas del Time Tracker de más de 14 días (ver
 * `lib/timetracker/purga-capturas.ts`). Sustituye a la purga de pg_cron, que fallaba cada noche al borrar
 * `storage.objects` con SQL.
 *
 * - `cronAuthorized`: `Authorization: Bearer <CRON_SECRET>` (lo que manda Vercel Cron) o `?key=`.
 * - `?verify=1`: confirma el secreto sin borrar nada.
 * - Como mucho 500 capturas por corrida; el resto se queda para la siguiente.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (new URL(req.url).searchParams.get("verify") === "1") return NextResponse.json({ ok: true, verify: true });

  const out = await purgaCapturas({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  });
  console.log(
    `[cron purga-capturas] encontradas=${out.encontradas} archivos=${out.archivosBorrados} filas=${out.filasBorradas} ` +
      `sinArchivo=${out.sinArchivo} rechazadas=${out.rechazadas} recientes=${out.recientes} fallidas=${out.fallidas} ok=${out.ok}`,
  );
  return NextResponse.json(out, { status: out.ok ? 200 : 502 });
}
