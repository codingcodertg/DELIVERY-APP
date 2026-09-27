import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { BUSINESS_TZ } from "@/lib/utils";
import { alcanceDelPanel, ordenesDelPanel } from "@/lib/panel-por-tienda";
import type { OrderTypeRules } from "@/lib/required";
import type { NamedLocation, Profile } from "@/lib/types";
import type { Posicion } from "@/lib/route-plan/llegadas";
import {
  puntualidadPorChofer, rangoValido, todasLasFilas, DIAS_MAX_DEL_RANGO,
  type EntregaParaPuntualidad, type EventoDeEntrega, type ParadaPublicada,
} from "@/lib/puntualidad";

// ============================================================
// Informe de puntualidad por chofer (D-NEXT): GET ?from=YYYY-MM-DD&to=YYYY-MM-DD.
//
// SOLO LEE, y todo con la SESIÓN de quien pide: ni llave de servicio, ni escrituras, ni proveedores. Qué filas ve cada
// uno lo decide su RLS; y además, como el Panel (D-396), el gerente solo ve las órdenes de SUS tiendas: se acota con
// las mismas funciones que la pantalla (`alcanceDelPanel`, `ordenesDelPanel`).
//
// Admin, logística y gerente: los tres roles que leen las posiciones GPS (121) y los planes (133).
// El cálculo vive en `src/lib/puntualidad.ts`; aquí solo se lee y se pagina (PostgREST da 1000 filas por petición).
// ============================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const ROLES = ["admin", "logistics", "manager"];
const TROZO_DE_IDS = 150; // `in.(…)` va en la URL: de 150 en 150 ids no pasa de unos 6 KB.

const trozos = <T,>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const q = new URL(req.url).searchParams;
  const desde = q.get("from") ?? "", hasta = q.get("to") ?? "";
  if (!rangoValido(desde, hasta)) return NextResponse.json({ error: `A range (from, to: YYYY-MM-DD) of at most ${DIAS_MAX_DEL_RANGO} days is required.` }, { status: 400 });

  const { data: yo } = await supabase.from("profiles").select("role, store").eq("id", user.id).maybeSingle();
  if (!yo || !ROLES.includes(String(yo.role))) return NextResponse.json({ error: "Only admin, logistics or managers can see this report." }, { status: 403 });

  const [ajustes, choferes] = await Promise.all([
    supabase.from("settings").select("stores, order_type_rules").eq("id", 1).maybeSingle(),
    supabase.from("profiles").select("id, full_name").eq("role", "driver"),
  ]);
  if (ajustes.error || choferes.error) return NextResponse.json({ error: "Could not read settings.", detail: (ajustes.error ?? choferes.error)?.message }, { status: 500 });

  // Las entregas del rango (por fecha de entrega), paginadas; y acotadas a las tiendas de quien pide.
  const leidas = await todasLasFilas<EntregaParaPuntualidad & { store: string | null; pickup_name: string | null; delivery_name: string | null; order_type: string | null }>((a, b) =>
    supabase.from("deliveries").select("id, stage, delivery_date, delivery_windows, assigned_driver, pod_delivered_at, is_training, store, pickup_name, delivery_name, order_type")
      .eq("stage", "delivered").gte("delivery_date", desde).lte("delivery_date", hasta).not("assigned_driver", "is", null).order("id").range(a, b));
  if (leidas.error) return NextResponse.json({ error: "Could not read the deliveries.", detail: leidas.error }, { status: 500 });
  const alcance = alcanceDelPanel(yo as Pick<Profile, "role" | "store">, (ajustes.data?.stores ?? []) as NamedLocation[]);
  const entregas = ordenesDelPanel(leidas.filas as never[], alcance, ajustes.data?.order_type_rules as OrderTypeRules | undefined) as typeof leidas.filas;
  const ids = entregas.map((d) => d.id);

  // Quién pulsó «entregado» en cada una.
  const eventos: EventoDeEntrega[] = [];
  for (const t of trozos(ids, TROZO_DE_IDS)) {
    const { data, error } = await supabase.from("order_events").select("delivery_id, kind, created_by, created_at").eq("kind", "delivered").in("delivery_id", t);
    if (error) return NextResponse.json({ error: "Could not read the order history.", detail: error.message }, { status: 500 });
    eventos.push(...((data ?? []) as EventoDeEntrega[]));
  }

  // Los planes PUBLICADOS del rango y sus paradas (llegada por GPS ya guardada, y millas del plan).
  const { data: planes, error: alLeerPlanes } = await supabase.from("route_plans").select("id, plan_date").eq("status", "published").gte("plan_date", desde).lte("plan_date", hasta);
  if (alLeerPlanes) return NextResponse.json({ error: "Could not read the plans.", detail: alLeerPlanes.message }, { status: 500 });
  const fechaDelPlan = new Map((planes ?? []).map((p) => [p.id as string, String(p.plan_date)]));
  const paradas: ParadaPublicada[] = [];
  for (const t of trozos([...fechaDelPlan.keys()], TROZO_DE_IDS)) {
    const r = await todasLasFilas<{ plan_id: string; driver_id: string | null; delivery_id: string | null; kind: "P" | "D"; actual_arrival_at: string | null; leg_miles: number | null }>((a, b) =>
      supabase.from("route_plan_stops").select("plan_id, driver_id, delivery_id, kind, actual_arrival_at, leg_miles").in("plan_id", t).order("id").range(a, b));
    if (r.error) return NextResponse.json({ error: "Could not read the stops.", detail: r.error }, { status: 500 });
    paradas.push(...r.filas.map((p) => ({ ...p, plan_date: fechaDelPlan.get(p.plan_id) ?? "" })));
  }

  // El rastro GPS de los choferes del informe. Un día de margen a cada lado en UTC; el día local lo pone la zona.
  const nombres = new Set(entregas.map((d) => (d.assigned_driver ?? "").trim().toLowerCase()));
  const delInforme = ((choferes.data ?? []) as { id: string; full_name: string }[]).filter((c) => nombres.has((c.full_name ?? "").trim().toLowerCase())).map((c) => c.id);
  const inicio = new Date(Date.parse(`${desde}T00:00:00Z`) - 86_400_000).toISOString(), fin = new Date(Date.parse(`${hasta}T00:00:00Z`) + 2 * 86_400_000).toISOString();
  let posiciones: Posicion[] | null = [];
  let rastroCortado = false;
  if (delInforme.length) {
    const r = await todasLasFilas<Posicion>((a, b) =>
      supabase.from("driver_locations").select("driver_id, lat, lng, accuracy_m, recorded_at").in("driver_id", delInforme).gte("recorded_at", inicio).lt("recorded_at", fin).order("recorded_at").range(a, b));
    if (r.error) return NextResponse.json({ error: "Could not read the GPS positions.", detail: r.error }, { status: 500 });
    // Cortado por el tope: un rastro a medias daría menos millas de las hechas. Mejor ninguna cifra que una falsa.
    rastroCortado = r.cortado;
    posiciones = r.cortado ? null : r.filas;
  }

  return NextResponse.json({
    ok: true, desde, hasta,
    alcance: alcance.tipo,
    planesPublicados: fechaDelPlan.size,
    rastroCortado,
    filas: puntualidadPorChofer({ entregas, choferes: (choferes.data ?? []) as { id: string; full_name: string }[], eventos, paradas, posiciones, zona: BUSINESS_TZ }),
  });
}
