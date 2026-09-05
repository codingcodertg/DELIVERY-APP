import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/clockin/cronAuth";
import { cerrarSesionesHuerfanas } from "@/lib/timetracker/live-session-cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron: cerrar las sesiones huérfanas del cronómetro (D-NEXT, parte B).
 *
 * Mismo patrón que `clock-in/api/cron`: `cronAuthorized` (Bearer CRON_SECRET o `?key=`), y
 * `?verify=1` que confirma el secreto con 200 SIN ejecutar nada — regla de CLAUDE.md, una
 * prueba no dispara efectos reales. La regla de cierre vive en lib/timetracker/live-session.ts,
 * compartida con la pantalla y probada con datos sintéticos.
 *
 * Programación: Vercel Hobby tiene sus dos crons ocupados (notion-summary y roll-schedules),
 * así que esta ruta NO está en vercel.json: la llama `roll-schedules` al final de su pasada
 * diaria (08:00 UTC, mismo secreto), que es donde de verdad corre. Esta ruta queda como entrada
 * propia para ejecutarla a mano o desde un job aparte si algún día hace falta más frecuencia.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (new URL(req.url).searchParams.get("verify") === "1") {
    return NextResponse.json({ ok: true, verify: true });
  }
  const out = await cerrarSesionesHuerfanas({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  });
  return NextResponse.json(out, { status: out.ok ? 200 : 502 });
}
