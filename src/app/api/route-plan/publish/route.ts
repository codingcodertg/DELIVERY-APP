import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { errorDePublicar, rutasDeParadas } from "@/lib/route-plan/borrador";
import { avisosAlPublicar, textoDelAviso } from "@/lib/route-plan/publicar";

// ============================================================
// «Publicar ruta» (D-NEXT): escribe el borrador en las órdenes y avisa a cada chofer UNA vez.
//
// Todo lo que escribe lo hace `publish_route_plan` (migración 133), por `rpc` y **con la sesión de quien
// publica**: una transacción —o entra todo o no entra nada— en la que valen su RLS y el guard de las
// órdenes. Esta ruta NO usa la llave de servicio, y no escribe en `deliveries` ni en `notifications` por su
// cuenta: decide A QUIÉN se avisa (comparando con el plan publicado anterior) y se lo pasa a la función.
//
// El aviso por asignación vive en el cliente, dentro de `updateDelivery`; publicar no pasa por ahí, y por
// eso catorce órdenes a tres choferes son tres avisos y no catorce.
//
// Los push los lanza quien llama, con los ids que devuelve esto, por `/api/push` — como el aviso de
// asignación (D-308).
// ============================================================

export const runtime = "nodejs";

const COLUMNAS_DE_PARADA = "driver_id, seq, kind, order_ref, eta";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  let planId = "";
  try { planId = String(((await req.json()) as { plan_id?: unknown }).plan_id ?? ""); } catch { /* cae en la validación */ }
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return NextResponse.json({ error: "A plan_id is required." }, { status: 400 });

  const { data: plan, error: alLeer } = await supabase.from("route_plans").select("id, plan_date, status").eq("id", planId).maybeSingle();
  if (alLeer) return NextResponse.json({ error: "Could not read the plan.", detail: alLeer.message }, { status: 500 });
  if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  // A quién se avisa: se compara parada a parada con el plan publicado que este va a sustituir.
  const { data: vigente } = await supabase.from("route_plans").select("id").eq("plan_date", plan.plan_date).eq("status", "published").maybeSingle();
  const [nuevas, viejas] = await Promise.all([
    supabase.from("route_plan_stops").select(COLUMNAS_DE_PARADA).eq("plan_id", planId),
    vigente ? supabase.from("route_plan_stops").select(COLUMNAS_DE_PARADA).eq("plan_id", vigente.id) : Promise.resolve({ data: null, error: null }),
  ]);
  if (nuevas.error || viejas.error) return NextResponse.json({ error: "Could not read the stops.", detail: (nuevas.error ?? viejas.error)?.message }, { status: 500 });

  type Parada = Parameters<typeof rutasDeParadas>[0][number];
  const conChofer = (ps: unknown) => ((ps ?? []) as Parada[]).filter((p) => !!p.driver_id);
  const avisos = avisosAlPublicar(rutasDeParadas(conChofer(nuevas.data)), viejas.data ? rutasDeParadas(conChofer(viejas.data)) : null);
  const p_avisos = avisos.map((a) => ({ driver_id: a.chofer, message: textoDelAviso(a, String(plan.plan_date)) }));

  const { data, error } = await supabase.rpc("publish_route_plan", { p_plan: planId, p_avisos });
  if (error) {
    const e = errorDePublicar(error.message);
    return NextResponse.json({ error: e.codigo, detail: e.detalle }, { status: e.status });
  }
  const r = (data ?? {}) as { written?: number; notifications?: { driver_id: string; notification_id: string }[] };
  return NextResponse.json({ ok: true, plan_id: planId, written: r.written ?? 0, notifications: r.notifications ?? [] });
}
