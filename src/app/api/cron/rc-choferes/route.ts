import { NextResponse } from "next/server";
import { cronAutorizadoORBoleto } from "@/lib/cron-boleto-base";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialesDeLaSincronizacion } from "@/lib/ringcentral-choferes/credenciales";
import { sincronizarRcChoferes } from "@/lib/ringcentral-choferes/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron cada 10 minutos (GitHub Actions, `.github/workflows/rc-choferes.yml`: Vercel Hobby solo admite crons diarios).
 * Copia las llamadas (y sus grabaciones) de las extensiones marcadas como choferes en la app RingCentral.
 * - `cronAuthorized`: `Authorization: Bearer <CRON_SECRET>`, igual que los demás crons.
 * - `?verify=1`: confirma el secreto sin sincronizar nada.
 * - Sin credenciales configuradas sale con 200 y `omitido`, para no fallar antes de configurarlo.
 * Nunca devuelve el detalle de RingCentral ni de la base: solo el motivo genérico y los contadores.
 */
export async function GET(req: Request) {
  // D-1129: entra con el CRON_SECRET (Vercel, GitHub) o con un boleto de la base para esta ruta (migración 342).
  if (!(await cronAutorizadoORBoleto(req, "/api/cron/rc-choferes"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (new URL(req.url).searchParams.get("verify") === "1") return NextResponse.json({ ok: true, verify: true });

  const credenciales = credencialesDeLaSincronizacion();
  if (!credenciales) return NextResponse.json({ ok: true, omitido: "sin credenciales" });

  let r;
  try {
    r = await sincronizarRcChoferes({ db: createAdminClient(), credenciales, ahora: new Date() });
  } catch {
    console.error("[cron rc-choferes] no se pudo iniciar la sincronizacion");
    return NextResponse.json({ ok: false, motivo: "base" }, { status: 502 });
  }
  console.log(
    `[cron rc-choferes] ok=${r.ok} motivo=${r.motivo ?? "-"} extensiones=${r.extensiones} llamadas=${r.llamadas} ` +
      `grabaciones=${r.grabaciones} pendientes=${r.pendientes}`,
  );
  const esperado = r.ok || r.motivo === "limite" || r.motivo === "sin_permiso";
  return NextResponse.json(r, { status: esperado ? 200 : 502 });
}
