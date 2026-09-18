import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUSINESS_TZ } from "@/lib/utils";
import { unavailableDriverNames } from "@/lib/dispatch";
import { choferesDelPlan, planificaElDia, resumenDelPlan, type FilaDePlan } from "@/lib/route-plan/borrador";
import { vistaDelPlan, type ParadaGuardada } from "@/lib/route-plan/vista";
import { aplicaMovimiento, estadoDeParadas, movimientoValido, revalida, type PlanGuardado } from "@/lib/route-plan/ajuste";
import type { NamedLocation } from "@/lib/types";
import { ETAPAS_RUTEABLES } from "@/lib/route-plan/publicar";
import { cacheEnSupabase, type ClienteDeCache } from "@/lib/route-times/cache-supabase";
import { proveedorEstimado, proveedorGoogle, proveedorOSRM, type FetchFn, type ProveedorDeTiempos } from "@/lib/route-times/proveedores";
import type { DatosDelDia } from "@/lib/route-plan/entrada";

// ============================================================
// «Planificar el día» (D-320): calcula un plan de ruta y lo deja en BORRADOR.
//
// No toca ninguna orden ni avisa a nadie: eso es publicar (`./publish`). Plan en
// `docs/PLAN-133-route-plans.md`.
//
// DOS CLIENTES, y cada uno para lo suyo:
//   · la SESIÓN de quien planifica lee las órdenes y guarda el plan — que valgan su RLS: ve lo que ve, y el
//     plan lo puede crear porque es admin o logística (133);
//   · la LLAVE DE SERVICIO solo toca la caché de tiempos de viaje, que ningún navegador lee ni escribe (132).
//
// Es la única ruta de la app que puede llamar a Google para el motor. El gasto lo frena el tope de
// `route-times` (por corrida y por día), y casi todo sale de la caché.
// ============================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const COLUMNAS_DE_ORDEN =
  "id, stage, order_code, order_type, store, pickup_name, delivery_name, delivery_lat, delivery_lng, delivery_windows, est_pallets, actual_pallets, pickup_duration, delivery_duration, assigned_driver, input_date, input_time, account, customer_type, is_training, updated_at";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let fecha = "";
  try { fecha = String(((await req.json()) as { date?: unknown }).date ?? ""); } catch { /* cae en la validación */ }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: "A date (YYYY-MM-DD) is required." }, { status: 400 });

  // Quién planifica. La base lo vuelve a comprobar al guardar (133); esto es para decirlo claro y pronto.
  const { data: yo } = await supabase.from("profiles").select("role, visible_stores").eq("id", user.id).maybeSingle();
  if (!yo || !["admin", "logistics"].includes(String(yo.role))) return NextResponse.json({ error: "Only admin or logistics can plan routes." }, { status: 403 });

  const [ordenes, ajustes, choferes, deChofer, ausencias, publicado] = await Promise.all([
    supabase.from("deliveries").select(COLUMNAS_DE_ORDEN).eq("delivery_date", fecha).in("stage", [...ETAPAS_RUTEABLES]),
    supabase.from("settings").select("stores, accounts, order_type_rules, route_buckets, driver_capacity, default_truck_capacity, route_weights, route_hard_windows, route_late_cap_min").eq("id", 1).maybeSingle(),
    supabase.from("profiles").select("id, full_name, role").eq("role", "driver"),
    supabase.from("driver_settings").select("profile_id, base_store, capacity_pallets, shift_start, shift_end, returns_to_base, routable"),
    supabase.from("driver_availability").select("driver_id, start_date, end_date"),
    supabase.from("route_plans").select("writes").eq("plan_date", fecha).eq("status", "published").maybeSingle(),
  ]);
  const fallo = ordenes.error ?? ajustes.error ?? choferes.error ?? deChofer.error ?? ausencias.error ?? publicado.error;
  if (fallo || !ajustes.data) return NextResponse.json({ error: "Could not read the day.", detail: fallo?.message ?? "no settings" }, { status: 500 });

  // Lo que alguien fijó a mano en el borrador vigente de esa fecha: planificar de nuevo lo respeta.
  const { data: borradorVigente } = await supabase.from("route_plans").select("id").eq("plan_date", fecha).eq("status", "draft").order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: paradasFijadas } = borradorVigente
    ? await supabase.from("route_plan_stops").select("driver_id, seq, kind, order_ref, pinned").eq("plan_id", borradorVigente.id).eq("pinned", true)
    : { data: null };

  const nombrePorId = new Map((choferes.data ?? []).map((c) => [c.id as string, String(c.full_name ?? "")]));
  const datos: DatosDelDia = {
    ordenes: (ordenes.data ?? []) as unknown as DatosDelDia["ordenes"],
    choferes: (choferes.data ?? []) as DatosDelDia["choferes"],
    ajustesDeChofer: (deChofer.data ?? []) as DatosDelDia["ajustesDeChofer"],
    settings: ajustes.data as DatosDelDia["settings"],
    publicadoAntes: ((publicado.data?.writes ?? []) as DatosDelDia["publicadoAntes"]) ?? [],
    fijadas: estadoDeParadas((paradasFijadas ?? []) as Parameters<typeof estadoDeParadas>[0]).secuencias,
    noDisponibles: [...unavailableDriverNames((ausencias.data ?? []) as { driver_id: string; start_date: string; end_date: string }[], nombrePorId, fecha)],
  };

  // Tiempos de viaje: Google si hay llave, y siempre los dos respaldos detrás.
  const admin = createAdminClient();
  const llave = process.env.GOOGLE_MAPS_API_KEY;
  const proveedores: ProveedorDeTiempos[] = [...(llave ? [proveedorGoogle(llave, fetch as unknown as FetchFn)] : []), proveedorOSRM(fetch as unknown as FetchFn), proveedorEstimado()];
  const cache = cacheEnSupabase(admin as unknown as ClienteDeCache, {
    cuentaDePago: async (desdeISO, conTrafico) => {
      const { count } = await admin.from("travel_time_cache").select("origin_key", { count: "exact", head: true })
        .eq("provider", "google").eq("traffic", conTrafico).gte("fetched_at", desdeISO);
      return count ?? 0;
    },
  });

  const borrador = await planificaElDia(datos, fecha, BUSINESS_TZ, { cache, proveedores, ahoraISO: new Date().toISOString() });

  // Guardar, con la sesión de quien planifica. Quien crea el plan puede leerlo, así que pedirlo de vuelta no
  // choca con ninguna política.
  const { data: fila, error: alGuardar } = await supabase.from("route_plans").insert(borrador.plan).select("id, version").maybeSingle();
  if (alGuardar || !fila) return NextResponse.json({ error: "Could not save the plan.", detail: alGuardar?.message }, { status: 500 });
  if (borrador.paradas.length) {
    const { error: alGuardarParadas } = await supabase.from("route_plan_stops").insert(borrador.paradas.map((p) => ({ ...p, plan_id: fila.id })));
    if (alGuardarParadas) {
      // Un plan sin sus paradas no sirve: se descarta, que es lo que la base deja hacer con un borrador.
      await supabase.from("route_plans").update({ status: "discarded" }).eq("id", fila.id);
      return NextResponse.json({ error: "Could not save the stops.", detail: alGuardarParadas.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true, plan_id: fila.id, version: fila.version,
    // A quien publica no se le marcan tiendas (131): no vería órdenes que tendría que escribir.
    warnTiendasMarcadas: Array.isArray(yo.visible_stores) && yo.visible_stores.length > 0,
    status: "draft",
    resumen: resumenDelPlan(borrador.plan, borrador.paradas.length),
    rutas: vistaDelPlan(borrador.paradas, borrador.plan.input.entrada.ordenes, borrador.plan.result.partes),
    choferes: choferesDelPlan(borrador.plan.input.entrada.choferes),
  });
}

// ------------------------------------------------------------
// GET ?date=YYYY-MM-DD — el plan vigente de esa fecha, para enseñarlo: el último borrador o publicado.
// Solo LEE, con la sesión de quien mira: qué planes ve cada rol lo decide la RLS de la 133 (almacén, solo
// lo publicado; chofer y ventas, nada). Quien no ve ninguno recibe `plan: null`, no un error.
// ------------------------------------------------------------
const COLUMNAS_DE_PARADA =
  "driver_id, driver_name, seq, kind, delivery_id, order_ref, label, place, window_start, window_end, is_hard, eta, etd, wait_min, service_min, late_min, load_after, leg_minutes, leg_miles, pinned";

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const fecha = new URL(req.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: "A date (YYYY-MM-DD) is required." }, { status: 400 });

  const { data: fila, error } = await supabase.from("route_plans")
    .select("id, version, status, published_at, writes, result, ordenes:input->entrada->ordenes, choferes:input->entrada->choferes, total_minutes, total_miles, late_minutes, provider, traffic, converged")
    .eq("plan_date", fecha).in("status", ["draft", "published"]).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not read the plan.", detail: error.message }, { status: 500 });
  if (!fila) return NextResponse.json({ ok: true, plan: null });

  const { data: paradas, error: alLeerParadas } = await supabase.from("route_plan_stops").select(COLUMNAS_DE_PARADA).eq("plan_id", fila.id);
  if (alLeerParadas) return NextResponse.json({ error: "Could not read the stops.", detail: alLeerParadas.message }, { status: 500 });

  const { data: yo } = await supabase.from("profiles").select("visible_stores").eq("id", user.id).maybeSingle();
  const plan = fila as unknown as FilaDePlan & { ordenes: { id: string; builder?: boolean }[] | null; choferes: { id: string; nombre: string }[] | null; id: string; version: number; status: string; published_at: string | null };
  const filas = (paradas ?? []) as unknown as ParadaGuardada[];
  return NextResponse.json({
    ok: true,
    plan: {
      plan_id: plan.id, version: plan.version, status: plan.status, published_at: plan.published_at,
      warnTiendasMarcadas: Array.isArray(yo?.visible_stores) && yo.visible_stores.length > 0,
      resumen: resumenDelPlan(plan, filas.length),
      rutas: vistaDelPlan(filas, plan.ordenes ?? [], plan.result?.partes ?? {}),
      choferes: choferesDelPlan(plan.choferes),
    },
  });
}

// ------------------------------------------------------------
// PATCH { plan_id, movimiento } — ajustar a mano un BORRADOR: subir o bajar una parada, pasar una orden a otro
// chofer, fijarla o soltarla. Qué es un movimiento válido y cómo se revalida vive en `route-plan/ajuste`.
//
// El cliente manda el MOVIMIENTO, no las secuencias: el servidor parte de las paradas guardadas, así que nadie
// puede colar una ruta con órdenes de más o de menos.
//
// No llama a ningún proveedor de tiempos ni al motor de planificar: revalida con la matriz y el tráfico que el
// plan ya guardó. Y no pisa el plan: guarda uno NUEVO (`manual_edit`, hijo del anterior) y descarta el anterior
// solo cuando el nuevo está entero. Todo con la sesión de quien ajusta; la RLS y el guard de la 133 deciden.
// ------------------------------------------------------------
export async function PATCH(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let cuerpo: { plan_id?: unknown; movimiento?: unknown } = {};
  try { cuerpo = (await req.json()) as typeof cuerpo; } catch { /* cae en la validación */ }
  const planId = String(cuerpo.plan_id ?? "");
  const movimiento = movimientoValido(cuerpo.movimiento);
  if (!/^[0-9a-f-]{36}$/i.test(planId) || !movimiento) return NextResponse.json({ error: "A plan_id and a valid move are required." }, { status: 400 });

  const { data: yo } = await supabase.from("profiles").select("role, visible_stores").eq("id", user.id).maybeSingle();
  if (!yo || !["admin", "logistics"].includes(String(yo.role))) return NextResponse.json({ error: "Only admin or logistics can adjust routes." }, { status: 403 });

  const { data: fila, error } = await supabase.from("route_plans")
    .select("id, status, plan_date, algorithm_version, params, input, result, provider, traffic, converged").eq("id", planId).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not read the plan.", detail: error.message }, { status: 500 });
  if (!fila) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  if (fila.status !== "draft") return NextResponse.json({ error: "NOT_DRAFT" }, { status: 409 });

  const [paradas, ajustes] = await Promise.all([
    supabase.from("route_plan_stops").select("driver_id, seq, kind, order_ref, pinned").eq("plan_id", planId),
    supabase.from("settings").select("stores").eq("id", 1).maybeSingle(),
  ]);
  if (paradas.error || ajustes.error) return NextResponse.json({ error: "Could not read the stops.", detail: (paradas.error ?? ajustes.error)?.message }, { status: 500 });

  const guardado = fila as unknown as PlanGuardado;
  const choferes = (guardado.input?.entrada?.choferes ?? []).map((c) => c.id);
  const estado = aplicaMovimiento(estadoDeParadas((paradas.data ?? []) as Parameters<typeof estadoDeParadas>[0]), movimiento, choferes);
  if ("error" in estado) return NextResponse.json({ error: "BAD_MOVE", detail: estado.error }, { status: 400 });

  const ajustado = revalida(guardado, estado, planId, (ajustes.data?.stores ?? []) as NamedLocation[]);
  const { data: nueva, error: alGuardar } = await supabase.from("route_plans").insert(ajustado.plan).select("id, version").maybeSingle();
  if (alGuardar || !nueva) return NextResponse.json({ error: "Could not save the plan.", detail: alGuardar?.message }, { status: 500 });
  if (ajustado.paradas.length) {
    const { error: alGuardarParadas } = await supabase.from("route_plan_stops").insert(ajustado.paradas.map((p) => ({ ...p, plan_id: nueva.id })));
    if (alGuardarParadas) {
      await supabase.from("route_plans").update({ status: "discarded" }).eq("id", nueva.id);
      return NextResponse.json({ error: "Could not save the stops.", detail: alGuardarParadas.message }, { status: 500 });
    }
  }
  // El nuevo está entero: ahora sí, el anterior deja de ser el vigente. Si esto fallara quedan dos borradores y
  // manda el de versión más alta —el nuevo—, que es lo que `GET` enseña.
  await supabase.from("route_plans").update({ status: "discarded" }).eq("id", planId);

  return NextResponse.json({
    ok: true, plan_id: nueva.id, version: nueva.version, status: "draft",
    warnTiendasMarcadas: Array.isArray(yo.visible_stores) && yo.visible_stores.length > 0,
    resumen: resumenDelPlan(ajustado.plan, ajustado.paradas.length),
    rutas: vistaDelPlan(ajustado.paradas, ajustado.plan.input.entrada.ordenes, ajustado.plan.result.partes),
    choferes: choferesDelPlan(ajustado.plan.input.entrada.choferes),
  });
}
