import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUSINESS_TZ } from "@/lib/utils";
import {
  actualesParaGuardar, fechaEnZona, minutoEnZona, realesDelDia, reporteDePrecision, sellosDeOrdenes, type ParadaDelPlan, type Posicion,
} from "@/lib/route-plan/llegadas";

// ============================================================
// La hora REAL de cada parada del plan publicado, y cuánto se equivocó la estimada.
//
// Lee —con la SESIÓN de quien pide, admin o logística— el plan publicado de la fecha, las posiciones GPS de sus
// choferes ese día, los sellos y eventos de sus órdenes y los turnos; deduce la hora real de cada parada
// (`route-plan/llegadas`); y escribe SOLO `actual_arrival_at` / `actual_departure_at` en `route_plan_stops`,
// que es lo único que la 133 deja tocar en un plan publicado. Recalcular da lo mismo: es idempotente.
//
// No toca `deliveries`, no avisa a nadie, no llama a ningún proveedor, y no cambia nada de lo que ve o pulsa
// el chofer.
//
// LA LLAVE DE SERVICIO se usa para UNA cosa: saber si cada chofer del plan ha iniciado sesión alguna vez
// (`auth.users` no lo lee ninguna sesión). Tres condiciones, las tres con prueba: el rol se comprueba ANTES de
// crear ese cliente; los ids salen del plan publicado, nunca del cuerpo de la petición; y de cada usuario sale
// un booleano — ni fecha, ni correo, ni nada más. Si la consulta de uno falla, es «no se sabe» (`null`), no «no».
// ============================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const COLUMNAS_DE_PARADA = "id, driver_id, driver_name, delivery_id, seq, kind, lat, lng, eta, etd";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let fecha = "";
  try { fecha = String(((await req.json()) as { date?: unknown }).date ?? ""); } catch { /* cae en la validación */ }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: "A date (YYYY-MM-DD) is required." }, { status: 400 });

  const { data: yo } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!yo || !["admin", "logistics"].includes(String(yo.role))) return NextResponse.json({ error: "Only admin or logistics can see this report." }, { status: 403 });

  const { data: plan, error } = await supabase.from("route_plans").select("id, version").eq("plan_date", fecha).eq("status", "published").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not read the plan.", detail: error.message }, { status: 500 });
  if (!plan) return NextResponse.json({ ok: true, plan: null });

  const { data: filas, error: alLeerParadas } = await supabase.from("route_plan_stops").select(COLUMNAS_DE_PARADA).eq("plan_id", plan.id);
  if (alLeerParadas) return NextResponse.json({ error: "Could not read the stops.", detail: alLeerParadas.message }, { status: 500 });
  const paradas = (filas ?? []) as unknown as (ParadaDelPlan & { driver_name: string })[];
  const choferes = [...new Set(paradas.map((p) => p.driver_id).filter((c): c is string => !!c))];
  const ordenes = [...new Set(paradas.map((p) => p.delivery_id).filter((o): o is string => !!o))];

  // Un día de margen a cada lado en UTC; el día LOCAL exacto se decide abajo, con la zona del negocio.
  const desde = new Date(Date.parse(`${fecha}T00:00:00Z`) - 86400000).toISOString(), hasta = new Date(Date.parse(`${fecha}T00:00:00Z`) + 2 * 86400000).toISOString();
  const [posiciones, sellos, eventos, turnos] = await Promise.all([
    choferes.length ? supabase.from("driver_locations").select("driver_id, lat, lng, accuracy_m, recorded_at").in("driver_id", choferes).gte("recorded_at", desde).lt("recorded_at", hasta) : { data: [], error: null },
    ordenes.length ? supabase.from("deliveries").select("id, pickup_gps_at, pod_delivered_at").in("id", ordenes) : { data: [], error: null },
    ordenes.length ? supabase.from("order_events").select("delivery_id, kind, created_by, created_at").in("delivery_id", ordenes).in("kind", ["picked_up", "delivered"]) : { data: [], error: null },
    choferes.length ? supabase.from("driver_shifts").select("driver_id, started_at").in("driver_id", choferes).gte("started_at", desde).lt("started_at", hasta) : { data: [], error: null },
  ]);
  const fallo = posiciones.error ?? sellos.error ?? eventos.error ?? turnos.error;
  if (fallo) return NextResponse.json({ error: "Could not read the day.", detail: fallo.message }, { status: 500 });

  const delDia = ((posiciones.data ?? []) as Posicion[]).filter((p) => fechaEnZona(p.recorded_at, BUSINESS_TZ) === fecha);
  const conTurno = [...new Set(((turnos.data ?? []) as { driver_id: string; started_at: string }[]).filter((t) => fechaEnZona(t.started_at, BUSINESS_TZ) === fecha).map((t) => t.driver_id))];
  const reales = realesDelDia(paradas, delDia, sellosDeOrdenes((sellos.data ?? []) as Parameters<typeof sellosDeOrdenes>[0], (eventos.data ?? []) as Parameters<typeof sellosDeOrdenes>[1]));

  // ¿Ha entrado alguna vez? El rol ya está comprobado arriba; los ids son los del plan publicado.
  const admin = createAdminClient();
  const haEntrado: { driver_id: string; ha_entrado: boolean | null }[] = [];
  for (const id of choferes) {
    const { data, error: alPreguntar } = await admin.auth.admin.getUserById(id);
    haEntrado.push({ driver_id: id, ha_entrado: alPreguntar || !data?.user ? null : !!data.user.last_sign_in_at });
  }

  // Guardar SOLO las dos columnas `actual_*`, parada a parada, y contar lo que de verdad se escribió.
  let guardadas = 0;
  const noGuardadas: string[] = [];
  for (const a of actualesParaGuardar(reales)) {
    const { data: tocada, error: alGuardar } = await supabase.from("route_plan_stops")
      .update({ actual_arrival_at: a.actual_arrival_at, actual_departure_at: a.actual_departure_at }).eq("id", a.id).eq("plan_id", plan.id).select("id");
    if (alGuardar || !tocada?.length) noGuardadas.push(a.id); else guardadas++;
  }

  const nombreDe = new Map(paradas.filter((p) => p.driver_id).map((p) => [p.driver_id as string, p.driver_name]));
  return NextResponse.json({
    ok: true, plan: { plan_id: plan.id, version: plan.version },
    reporte: reporteDePrecision(paradas, reales, (iso) => minutoEnZona(iso, BUSINESS_TZ), conTurno, [...new Set(delDia.map((p) => p.driver_id))], haEntrado.filter((h) => h.ha_entrado === true).map((h) => h.driver_id)),
    choferes: choferes.map((id) => ({
      driver_id: id, nombre: nombreDe.get(id) ?? "", ha_entrado: haEntrado.find((h) => h.driver_id === id)?.ha_entrado ?? null,
      con_turno: conTurno.includes(id), posiciones: delDia.filter((p) => p.driver_id === id).length,
    })),
    paradas: paradas.map((p, k) => ({ id: p.id, driver_id: p.driver_id, seq: p.seq, kind: p.kind, delivery_id: p.delivery_id, eta: p.eta, etd: p.etd, ...reales[k] })),
    guardadas, noGuardadas,
  });
}
