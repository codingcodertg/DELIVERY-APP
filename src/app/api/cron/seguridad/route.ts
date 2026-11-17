import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/clockin/cronAuth";
import { corrigeMonitor } from "@/lib/seguridad/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron del monitoreo de seguridad (320): cada 5 min pasa los detectores sobre `sec_events`, guarda las alertas nuevas,
 * bloquea IPs con fallos de login en ráfaga (30 min, con sus guardas) y avisa por correo (sev ≥4) y SMS (sev 5).
 *
 * Quién lo llama: `llama_cron_del_hub('/api/cron/seguridad')` por pg_cron, cuando la migración 319 esté aplicada (ver
 * supabase/migrations/320). Mientras tanto se puede llamar a mano con el secreto del cron.
 *
 * `?verify=1` confirma el secreto sin mirar nada. Si no puede leer el rastro, contesta 502 (y no toca nada).
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (new URL(req.url).searchParams.get("verify") === "1") return NextResponse.json({ ok: true, verify: true });
  try {
    const resumen = await corrigeMonitor();
    console.log(`[cron seguridad] eventos=${resumen.eventos} hallazgos=${resumen.hallazgos} nuevas=${resumen.nuevas} bloqueos=${resumen.bloqueos} avisos=${resumen.avisos}`);
    return NextResponse.json({ ok: true, ...resumen });
  } catch (e) {
    console.error("[cron seguridad] no corrió:", (e as Error).message);
    return NextResponse.json({ ok: false, error: "monitor no disponible" }, { status: 502 });
  }
}
