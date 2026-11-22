import { NextResponse } from "next/server";
import { cronAutorizadoORBoleto } from "@/lib/cron-boleto-base";
import { createAdminClient } from "@/lib/supabase/admin";
import { revisarGmail } from "@/lib/gmail/revision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron cada 15 minutos (mismo workflow que Outlook, `.github/workflows/outlook-indeed.yml`): revisa el Gmail conectado.
 * - `cronAuthorized`: `Authorization: Bearer <CRON_SECRET>` o `?key=`, igual que el cron de Outlook.
 * - `?verify=1`: confirma el secreto sin revisar nada.
 * - Sin Gmail conectado sale enseguida con 200 y `motivo: "no conectado"`: no falla antes de conectar.
 * - Como mucho 50 correos por corrida, y se corta a los 45 s.
 */
export async function GET(req: Request) {
  // D-1132: el CRON_SECRET de siempre o un boleto de la base para esta ruta (migración 344).
  if (!(await cronAutorizadoORBoleto(req, "/api/cron/gmail-indeed"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (new URL(req.url).searchParams.get("verify") === "1") return NextResponse.json({ ok: true, verify: true });

  const r = await revisarGmail({ db: createAdminClient(), env: process.env, ahora: new Date() });
  console.log(
    `[cron gmail-indeed] ok=${r.ok} motivo=${r.motivo ?? "-"} revisados=${r.revisados} creados=${r.creados} ` +
      `duplicados=${r.duplicados} notas=${r.notas} omitidos=${r.omitidos} fallidos=${r.fallidos}`,
  );
  return NextResponse.json(r, { status: r.ok || r.motivo === "no conectado" ? 200 : 502 });
}
