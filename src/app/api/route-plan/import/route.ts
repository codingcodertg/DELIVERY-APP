import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { evaluaPlan, parteOrdenesGrandes, type Parametros } from "@/lib/route-engine";
import { estadoDeParadas, type PlanGuardado } from "@/lib/route-plan/ajuste";
import { planImportado, filasValidas, type ResultadoDeImportar } from "@/lib/route-plan/importa";
import type { NamedLocation } from "@/lib/types";

// ============================================================
// Importar la hoja del despachador y compararla con el plan del motor.
//
// Recibe las FILAS ya leídas en el navegador (el fichero no sale de él), las casa con las órdenes del día y
// puntúa el plan del despachador con el MISMO modelo que el del motor: la matriz, el tráfico y los parámetros
// que guardó el plan del motor de esa fecha. Por eso hace falta que ese plan exista: sin él, 409.
//
// **Esto NUNCA toca una orden ni avisa a nadie.** Lo único que escribe es un plan `source = 'manual_import'`
// con sus paradas, que queda DESCARTADO en cuanto está entero: es historia para comparar, no un plan que se
// pueda publicar. Va con `writes = []`, así que ni publicándolo por error escribiría una orden; y `publish`,
// `GET` y «planificar de nuevo» lo ignoran por su `source`.
//
// No llama a ningún proveedor de tiempos ni usa la llave de servicio: lee y guarda con la sesión de quien importa.
// ============================================================

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let cuerpo: { date?: unknown; filas?: unknown } = {};
  try { cuerpo = (await req.json()) as typeof cuerpo; } catch { /* cae en la validación */ }
  const fecha = String(cuerpo.date ?? "");
  const filas = filasValidas(cuerpo.filas);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !filas) return NextResponse.json({ error: "A date and the sheet rows are required." }, { status: 400 });

  const { data: yo } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!yo || !["admin", "logistics"].includes(String(yo.role))) return NextResponse.json({ error: "Only admin or logistics can import a sheet." }, { status: 403 });

  // El plan del motor contra el que se compara: el último de esa fecha que NO sea una hoja importada.
  const { data: ref, error } = await supabase.from("route_plans")
    .select("id, plan_date, algorithm_version, params, input, result, provider, traffic, converged")
    .eq("plan_date", fecha).in("status", ["draft", "published"]).neq("source", "manual_import").order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not read the plan.", detail: error.message }, { status: 500 });
  if (!ref) return NextResponse.json({ error: "NO_PLAN" }, { status: 409 });

  const [paradas, ordenes, ajustes] = await Promise.all([
    supabase.from("route_plan_stops").select("driver_id, seq, kind, order_ref, pinned").eq("plan_id", ref.id),
    supabase.from("deliveries").select("id, invoice_num, po2, so_num").eq("delivery_date", fecha),
    supabase.from("settings").select("stores").eq("id", 1).maybeSingle(),
  ]);
  const fallo = paradas.error ?? ordenes.error ?? ajustes.error;
  if (fallo) return NextResponse.json({ error: "Could not read the day.", detail: fallo.message }, { status: 500 });

  const guardado = ref as unknown as PlanGuardado & { id: string };
  const e = guardado.input.entrada;
  const parametros = guardado.params as unknown as Parametros;
  const motor = evaluaPlan({
    secuencias: estadoDeParadas((paradas.data ?? []) as Parameters<typeof estadoDeParadas>[0]).secuencias,
    ordenes: parteOrdenesGrandes(e.ordenes, e.choferes).ordenes, choferes: e.choferes, matriz: e.matriz, porHora: e.porHora, parametros,
  });

  const r: ResultadoDeImportar = planImportado(guardado, guardado.id, motor, filas, (ordenes.data ?? []) as Parameters<typeof planImportado>[4], fecha, (ajustes.data?.stores ?? []) as NamedLocation[]);

  // Guardar: plan, paradas y —solo entonces— descartado. Las paradas solo se pueden escribir mientras es borrador (133).
  const { data: nueva, error: alGuardar } = await supabase.from("route_plans").insert(r.plan).select("id, version").maybeSingle();
  if (alGuardar || !nueva) return NextResponse.json({ error: "Could not save the imported plan.", detail: alGuardar?.message }, { status: 500 });
  const { error: alGuardarParadas } = r.paradas.length
    ? await supabase.from("route_plan_stops").insert(r.paradas.map((p) => ({ ...p, plan_id: nueva.id })))
    : { error: null };
  const { error: alDescartar } = await supabase.from("route_plans").update({ status: "discarded" }).eq("id", nueva.id);
  if (alDescartar) return NextResponse.json({ error: "The imported plan could not be closed.", detail: alDescartar.message }, { status: 500 });
  if (alGuardarParadas) return NextResponse.json({ error: "Could not save the stops.", detail: alGuardarParadas.message }, { status: 500 });

  return NextResponse.json({ ok: true, plan_id: nueva.id, version: nueva.version, contra: { plan_id: guardado.id }, ...r.respuesta });
}
