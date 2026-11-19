import { NextResponse } from "next/server";
import { errorAlCliente } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminDeRc } from "@/lib/recruiting/rc-comms-acceso";
import { credencialesDeLaSincronizacion } from "@/lib/ringcentral-choferes/credenciales";
import { ESPERA_SINCRONIZAR_SEG, esperaRestante } from "@/lib/ringcentral-choferes/choferes";
import { sincronizarRcChoferes } from "@/lib/ringcentral-choferes/sync";

// ============================================================
// POST /api/ringcentral/sincronizar (solo admin): el botón «Sincronizar ahora». Corre la misma sincronización que el cron,
// pero solo si pasó la espera mínima desde la última corrida (2 minutos): si no, 429 con los segundos que faltan.
// Una corrida con falta de permiso o con límite de RingCentral responde 200 con su motivo; la pantalla lo enseña.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const auth = await requireAdminDeRc();
  if (!auth.ok) return auth.response;

  const { data: ultima, error } = await auth.supabase.from("rc_driver_sync_state")
    .select("last_run_at").order("last_run_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return errorAlCliente("ringcentral-choferes-espera", error, 503);
  const ahora = new Date();
  const espera = esperaRestante(ultima?.last_run_at as string | null, ahora, ESPERA_SINCRONIZAR_SEG);
  if (espera > 0) return NextResponse.json({ error: "cooldown", esperaSeg: espera }, { status: 429 });

  const credenciales = credencialesDeLaSincronizacion();
  if (!credenciales) return NextResponse.json({ error: "RingCentral is not configured." }, { status: 503 });

  const r = await sincronizarRcChoferes({ db: createAdminClient(), credenciales, ahora });
  const esperado = r.ok || r.motivo === "limite" || r.motivo === "sin_permiso";
  return NextResponse.json(r, { status: esperado ? 200 : 502 });
}
