import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUSINESS_TZ } from "@/lib/utils";
import { unavailableDriverNames } from "@/lib/dispatch";
import { planificaElDia } from "@/lib/route-plan/borrador";
import { ETAPAS_RUTEABLES } from "@/lib/route-plan/publicar";
import { cacheEnSupabase, type ClienteDeCache } from "@/lib/route-times/cache-supabase";
import { proveedorEstimado, proveedorGoogle, proveedorOSRM, type FetchFn, type ProveedorDeTiempos } from "@/lib/route-times/proveedores";
import type { DatosDelDia } from "@/lib/route-plan/entrada";

// ============================================================
// «Planificar el día» (D-NEXT): calcula un plan de ruta y lo deja en BORRADOR.
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

  const nombrePorId = new Map((choferes.data ?? []).map((c) => [c.id as string, String(c.full_name ?? "")]));
  const datos: DatosDelDia = {
    ordenes: (ordenes.data ?? []) as unknown as DatosDelDia["ordenes"],
    choferes: (choferes.data ?? []) as DatosDelDia["choferes"],
    ajustesDeChofer: (deChofer.data ?? []) as DatosDelDia["ajustesDeChofer"],
    settings: ajustes.data as DatosDelDia["settings"],
    publicadoAntes: ((publicado.data?.writes ?? []) as DatosDelDia["publicadoAntes"]) ?? [],
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
    resumen: {
      paradas: borrador.paradas.length, ordenes: borrador.plan.writes.length, sinAsignar: borrador.plan.result.sinAsignar,
      fuera: borrador.plan.result.fuera, choferesFuera: borrador.plan.result.choferesFuera, partes: borrador.plan.result.partes,
      minutos: borrador.plan.total_minutes, millas: borrador.plan.total_miles, tarde: borrador.plan.late_minutes,
      proveedor: borrador.plan.provider, trafico: borrador.plan.traffic, convergio: borrador.plan.converged, tiempos: borrador.plan.result.tiempos,
    },
  });
}
