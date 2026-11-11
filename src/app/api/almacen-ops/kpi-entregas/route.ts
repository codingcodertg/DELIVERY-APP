import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { errorAlCliente } from "@/lib/api-error";
import { todasLasFilas } from "@/lib/puntualidad";
import { leerNivelEscrito } from "@/lib/almacen-ops/nivel";
import { veLosReportes } from "@/lib/almacen-ops/visibilidad";
import {
  DIAS_MAX_DEL_RANGO, KIND_LISTA, KIND_RECOGIDA, evaluarOrdenes, rangoValido, peores, porEmpleado, porPeriodo, porTienda, tiendasDelKpi, totalDelKpi,
  type EntregaDelKpi, type EventoDeOrden,
} from "@/lib/almacen-ops/kpi-entregas";

// ============================================================
// KPI de entregas del almacén (Roberto, fase 1): GET ?from=YYYY-MM-DD&to=YYYY-MM-DD.
// «% de órdenes listas antes de que llegue el chofer». La regla exacta vive en `src/lib/almacen-ops/kpi-entregas.ts`.
//
// SOLO LEE, y todo con la SESIÓN de quien pide (como `/api/puntualidad`): ni llave de servicio ni escrituras. Qué
// filas ve cada uno lo decide su RLS; además se acota a las tiendas de quien pide (`tiendasDelKpi`). La ven quienes
// ven «Reportes (gerentes)» en Operaciones de almacén (`veLosReportes`: admin de la app, gerentes, supervisores).
//
// Lectura en tres pasos: los `picked_up` del rango (con un día de margen en UTC: el día que cuenta es el de Texas),
// luego las órdenes de esos ids y sus `ready`, de 150 ids en 150 (el `in.(…)` va en la URL).
// ============================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const TROZO_DE_IDS = 150;
const trozos = <T,>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const q = new URL(req.url).searchParams;
  const desde = q.get("from") ?? "", hasta = q.get("to") ?? "";
  if (!rangoValido(desde, hasta)) return NextResponse.json({ error: `A range (from, to: YYYY-MM-DD) of at most ${DIAS_MAX_DEL_RANGO} days is required.` }, { status: 400 });

  const { data: yo, error: errorPerfil } = await supabase.from("profiles").select("id, role, store, visible_stores, permissions, module_access, recruiting_role").eq("id", user.id).maybeSingle();
  if (errorPerfil) return NextResponse.json({ error: "Could not check your access." }, { status: 503 });
  if (!yo) return NextResponse.json({ error: "Profile not found." }, { status: 403 });
  const nivel = await leerNivelEscrito(supabase, user.id);
  const quien = { ...yo, id: user.id, role: String(yo.role ?? ""), warehouse_ops_role: nivel };
  if (!veLosReportes(quien)) return NextResponse.json({ error: "Only Warehouse Ops managers can see this KPI." }, { status: 403 });
  const tiendas = tiendasDelKpi(quien);

  // 1. Las recogidas del rango (UTC con margen; el filtro fino por día de Texas lo hace `evaluarOrdenes`).
  const inicio = new Date(Date.parse(`${desde}T00:00:00Z`) - 86_400_000).toISOString();
  const fin = new Date(Date.parse(`${hasta}T00:00:00Z`) + 2 * 86_400_000).toISOString();
  const recogidas = await todasLasFilas<EventoDeOrden>((a, b) =>
    supabase.from("order_events").select("delivery_id, kind, created_by, created_at").eq("kind", KIND_RECOGIDA).gte("created_at", inicio).lt("created_at", fin).order("created_at").range(a, b));
  if (recogidas.error) return NextResponse.json({ error: "Could not read the order history.", detail: recogidas.error }, { status: 500 });
  const ids = [...new Set(recogidas.filas.map((e) => e.delivery_id))];

  // 2. Las órdenes (acotadas a las tiendas de quien pide) y 3. sus `ready`.
  const entregas: EntregaDelKpi[] = [];
  const listas: EventoDeOrden[] = [];
  for (const t of trozos(ids, TROZO_DE_IDS)) {
    let qo = supabase.from("deliveries").select("id, order_code, invoice_num, store, pickup_name, delivery_date").in("id", t);
    if (tiendas) qo = qo.in("store", tiendas);
    const [o, l] = await Promise.all([
      qo,
      supabase.from("order_events").select("delivery_id, kind, created_by, created_at").eq("kind", KIND_LISTA).in("delivery_id", t),
    ]);
    if (o.error) return errorAlCliente("kpi-entregas", o.error, 500, "Could not read the deliveries.");
    if (l.error) return errorAlCliente("kpi-entregas", l.error, 500, "Could not read the order history.");
    entregas.push(...((o.data ?? []) as EntregaDelKpi[]));
    listas.push(...((l.data ?? []) as EventoDeOrden[]));
  }

  const ordenes = evaluarOrdenes(entregas, [...recogidas.filas, ...listas], { desde, hasta });

  // Los nombres de quienes marcaron «lista» (profiles; la RLS deja leer nombre y rol a cualquier sesión del hub).
  const quienes = [...new Set(ordenes.map((o) => o.quienMarco).filter((x): x is string => !!x))];
  const nombres = new Map<string, string>();
  for (const t of trozos(quienes, TROZO_DE_IDS)) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", t);
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) if ((p.full_name ?? "").trim()) nombres.set(p.id, (p.full_name ?? "").trim());
  }

  return NextResponse.json({
    ok: true, desde, hasta,
    tiendas,
    cortado: recogidas.cortado,
    total: totalDelKpi(ordenes),
    porTienda: porTienda(ordenes),
    porDia: porPeriodo(ordenes, "dia"),
    porSemana: porPeriodo(ordenes, "semana"),
    porEmpleado: porEmpleado(ordenes, nombres),
    peores: peores(ordenes, 10).map((o) => ({ ...o, quienMarcoNombre: o.quienMarco ? nombres.get(o.quienMarco) ?? null : null })),
  });
}
