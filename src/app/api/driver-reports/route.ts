import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { BUSINESS_TZ } from "@/lib/utils";
import type { Profile } from "@/lib/types";
import { mapaDelDia } from "@/lib/reportes-choferes/arma";
import { cargaDias, esErrorDeCarga } from "@/lib/reportes-choferes/carga";
import { DIAS_MAX_DE_REPORTES, puedeVerReportesDeChoferes, rangoDeReportes } from "@/lib/reportes-choferes/permiso";

// ============================================================
// GET /api/driver-reports?from=YYYY-MM-DD&to=YYYY-MM-DD[&driver=<id>][&map=1] — «Reportes de choferes» (D-907).
//
// Devuelve un DÍA por chofer y fecha (`informeDelDia`): sus paradas con lo planeado y lo real, las visitas del rastro,
// el orden, las millas. Los cuatro reportes de la pantalla se calculan de ahí (`reportes-choferes/metricas`).
// Con `map=1` (y un solo día y chofer) añade el rastro para el mapa.
//
// QUIÉN: admin, logística y gerente con Entregas (`puedeVerReportesDeChoferes`). El gerente, solo las órdenes de sus
// tiendas, con las mismas funciones que el Panel (D-396).
//
// La lectura y el armado viven en `reportes-choferes/carga.ts` (D-910), compartidos con `/api/route-adherence` para
// que el Recorrido y este reporte den los mismos números del mismo día. Lo que se lee con sesión y lo que se lee con la
// llave de servicio está dicho allí.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SIN_CACHE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { data: yo, error: alLeerPerfil } = await supabase.from("profiles").select("role, store, permissions, module_access").eq("id", user.id).maybeSingle();
  if (alLeerPerfil) return NextResponse.json({ error: "Could not check your access." }, { status: 503 });
  if (!puedeVerReportesDeChoferes(yo as { role?: string; module_access?: string[] | null } | null)) {
    return NextResponse.json({ error: "Only admin, logistics or managers can see driver reports." }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const desde = q.get("from") ?? "", hasta = q.get("to") ?? "", chofer = q.get("driver") ?? "", conMapa = q.get("map") === "1";
  if (!rangoDeReportes(desde, hasta)) return NextResponse.json({ error: `A range (from, to: YYYY-MM-DD) of at most ${DIAS_MAX_DE_REPORTES} days is required.` }, { status: 400 });
  if (chofer && !UUID.test(chofer)) return NextResponse.json({ error: "Invalid driver." }, { status: 400 });
  if (conMapa && (desde !== hasta || !chofer)) return NextResponse.json({ error: "The map needs one day and one driver." }, { status: 400 });

  const cargado = await cargaDias({ supabase, yo: yo as Pick<Profile, "role" | "store" | "permissions">, desde, hasta, choferId: chofer || null });
  if (esErrorDeCarga(cargado)) return NextResponse.json({ error: cargado.error, detail: cargado.detail }, { status: cargado.status });
  const { dias, choferes, pares, tiendas, alcance, avisos } = cargado;

  return NextResponse.json({
    ok: true, desde, hasta, alcance: alcance.tipo, zona: BUSINESS_TZ,
    choferes: choferes.filter((c) => pares.some((p) => p.choferId === c.id)).map((c) => ({ id: c.id, nombre: c.full_name })),
    dias: dias.map((d) => d.informe),
    mapa: conMapa && dias.length === 1 ? mapaDelDia(dias[0]) : null,
    tiendas,
    avisos,
  }, { headers: SIN_CACHE });
}
