import { NextResponse } from "next/server";
import { cronAutorizadoORBoleto } from "@/lib/cron-boleto-base";
import { createAdminClient } from "@/lib/supabase/admin";
import { revisarBuzonIndeed } from "@/lib/outlook/sincronizar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Cron cada 15 minutos (GitHub Actions, `.github/workflows/outlook-indeed.yml`: Vercel Hobby solo admite crons diarios): revisa el buzón conectado y crea candidatos o anota mensajes de Indeed.
 * - `cronAuthorized`: `Authorization: Bearer <CRON_SECRET>` (lo que manda Vercel Cron) o `?key=`.
 * - `?verify=1`: confirma el secreto sin revisar nada.
 * - Como mucho 50 correos por corrida.
 */
export async function GET(req: Request) {
  // D-1131: el CRON_SECRET de siempre o un boleto de la base para esta ruta.
  if (!(await cronAutorizadoORBoleto(req, "/api/cron/outlook-indeed"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (new URL(req.url).searchParams.get("verify") === "1") return NextResponse.json({ ok: true, verify: true });

  const r = await revisarBuzonIndeed({ db: createAdminClient(), env: process.env, ahora: new Date() });
  console.log(
    `[cron outlook-indeed] ok=${r.ok} motivo=${r.motivo ?? "-"} revisados=${r.revisados} creados=${r.creados} ` +
      `duplicados=${r.duplicados} notas=${r.notas} omitidos=${r.omitidos} fallidos=${r.fallidos}`,
  );
  return NextResponse.json(r, { status: r.ok || r.motivo === "no conectado" ? 200 : 502 });
}
