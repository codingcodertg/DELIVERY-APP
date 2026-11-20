import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/clockin/cronAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { agendasExtraDesde } from "@/lib/recruiting/agendas-ringcentral";
import { elegirAgenda } from "@/lib/recruiting/rc-comms";
import { sincronizarRcComms } from "@/lib/recruiting/rc-comms-sync";
import { sincronizarLlamadasDeLeads } from "@/lib/leads/llamadas-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron cada 10 minutos (GitHub Actions, `.github/workflows/rc-comms.yml`: Vercel Hobby solo admite crons diarios).
 * Copia los SMS y las llamadas (con grabacion) de la linea de RingCentral del dueno a la ficha del candidato con el
 * mismo telefono. Las credenciales son las de una entrada de `RINGCENTRAL_AGENDAS_EXTRA` (la primera, o la que diga
 * `RINGCENTRAL_COMMS_AGENDA`). Sin credenciales sale con 200 y `omitido`, para no fallar antes de configurarlo.
 * - `cronAuthorized`: `Authorization: Bearer <CRON_SECRET>`, igual que los demas crons.
 * - `?verify=1`: confirma el secreto sin sincronizar nada.
 * Nunca devuelve el detalle de RingCentral ni de la base: solo el motivo generico y los contadores.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (new URL(req.url).searchParams.get("verify") === "1") return NextResponse.json({ ok: true, verify: true });

  const agenda = elegirAgenda(agendasExtraDesde(process.env.RINGCENTRAL_AGENDAS_EXTRA), process.env.RINGCENTRAL_COMMS_AGENDA);
  if (!agenda) return NextResponse.json({ ok: true, omitido: "sin credenciales" });

  let r;
  try {
    r = await sincronizarRcComms({ db: createAdminClient(), credenciales: agenda, ahora: new Date() });
  } catch {
    console.error("[cron rc-comms] no se pudo iniciar la sincronizacion");
    return NextResponse.json({ ok: false, motivo: "base" }, { status: 502 });
  }
  console.log(
    `[cron rc-comms] ok=${r.ok} motivo=${r.motivo ?? "-"} llamadas=${r.llamadas} textos=${r.textos} ` +
      `grabaciones=${r.grabaciones} pendientes=${r.pendientes}`,
  );
  // Las llamadas de los leads (337) van con la misma corrida y las mismas credenciales; solo barren cada 2 horas. Si
  // fallan, no tapan el resultado de las comunicaciones de candidatos.
  let leads = null;
  try {
    leads = await sincronizarLlamadasDeLeads({ db: createAdminClient(), credenciales: agenda, ahora: new Date() });
  } catch {
    console.error("[cron rc-comms] llamadas de leads: no se pudo iniciar");
  }
  if (leads) console.log(`[cron rc-comms] leads ok=${leads.ok} motivo=${leads.motivo ?? "-"} llamadas=${leads.llamadas} grabaciones=${leads.grabaciones}`);
  return NextResponse.json({ ...r, leads }, { status: r.ok || r.motivo === "limite" ? 200 : 502 });
}
