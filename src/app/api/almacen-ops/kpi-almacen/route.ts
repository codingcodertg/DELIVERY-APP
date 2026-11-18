import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { errorAlCliente } from "@/lib/api-error";
import { todasLasFilas } from "@/lib/puntualidad";
import { leerNivelEscrito } from "@/lib/almacen-ops/nivel";
import { veLosReportes } from "@/lib/almacen-ops/visibilidad";
import { DIAS_MAX_DEL_RANGO, KIND_LISTA, KIND_RECOGIDA, tiendasDelKpi, type EventoDeOrden } from "@/lib/almacen-ops/kpi-entregas";
import {
  listasAntesDeRecoger, nivelDeBono, puntajeGeneral, rangoDelMes, resultadoDeMerma, resultadoDeTiempo,
  type EntregaParaListas,
} from "@/lib/almacen-ops/kpi-almacen";

// ============================================================
// KPIs de almacén: GET ?store=<tienda>&month=YYYY-MM. Lo ve quien ve «Reportes (gerentes)» (`veLosReportes`), y solo
// las tiendas que le tocan (`tiendasDelKpi`). Las reglas de cada número viven en `src/lib/almacen-ops/kpi-almacen.ts`.
//
// Tres lecturas, todas con la SESIÓN de quien pide:
//   · Listas a tiempo: las recogidas del mes (order_events), sus órdenes de esa tienda (deliveries, con la hora de
//     creación para la excepción de las 4 horas) y sus «lista» (order_events). Igual que el KPI de entregas.
//   · Merma, ventas y fichajes: UNA llamada a `warehouse_ops_kpi_almacen_mes` (migración 325), que solo devuelve totales
//     de la tienda y del mes. Si la 325 aún no está aplicada, esos tres vienen en null y la pantalla lo dice.
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
  const tienda = (q.get("store") ?? "").trim();
  const mes = rangoDelMes(q.get("month") ?? "");
  if (!tienda || !mes) return NextResponse.json({ error: "A store and a month (YYYY-MM) are required." }, { status: 400 });
  if ((Date.parse(`${mes.hasta}T00:00:00Z`) - Date.parse(`${mes.desde}T00:00:00Z`)) / 86_400_000 >= DIAS_MAX_DEL_RANGO) {
    return NextResponse.json({ error: "Month range too long." }, { status: 400 });
  }

  const { data: yo, error: errorPerfil } = await supabase.from("profiles").select("id, role, store, visible_stores, permissions, module_access, recruiting_role").eq("id", user.id).maybeSingle();
  if (errorPerfil) return NextResponse.json({ error: "Could not check your access." }, { status: 503 });
  if (!yo) return NextResponse.json({ error: "Profile not found." }, { status: 403 });
  const nivel = await leerNivelEscrito(supabase, user.id);
  const quien = { ...yo, id: user.id, role: String(yo.role ?? ""), warehouse_ops_role: nivel };
  if (!veLosReportes(quien)) return NextResponse.json({ error: "Only Warehouse Ops managers can see these KPIs." }, { status: 403 });
  const tiendas = tiendasDelKpi(quien);
  if (tiendas && !tiendas.includes(tienda)) return NextResponse.json({ error: "That store is not yours." }, { status: 403 });

  // 1. Las recogidas del mes (con un día de margen en UTC; el día que cuenta es el de Texas).
  const inicio = new Date(Date.parse(`${mes.desde}T00:00:00Z`) - 86_400_000).toISOString();
  const fin = new Date(Date.parse(`${mes.hasta}T00:00:00Z`) + 2 * 86_400_000).toISOString();
  const recogidas = await todasLasFilas<EventoDeOrden>((a, b) =>
    supabase.from("order_events").select("delivery_id, kind, created_by, created_at").eq("kind", KIND_RECOGIDA).gte("created_at", inicio).lt("created_at", fin).order("created_at").range(a, b));
  if (recogidas.error) return errorAlCliente("kpi-almacen", recogidas.error, 500, "Could not read the order history.");
  const ids = [...new Set(recogidas.filas.map((e) => e.delivery_id))];

  // 2. Las órdenes de ESTA tienda (con su hora de creación) y 3. sus «lista».
  const entregas: EntregaParaListas[] = [];
  const listas: EventoDeOrden[] = [];
  for (const t of trozos(ids, TROZO_DE_IDS)) {
    const [o, l] = await Promise.all([
      supabase.from("deliveries").select("id, order_code, invoice_num, store, pickup_name, delivery_date, created_at").in("id", t).eq("store", tienda),
      supabase.from("order_events").select("delivery_id, kind, created_by, created_at").eq("kind", KIND_LISTA).in("delivery_id", t),
    ]);
    if (o.error) return errorAlCliente("kpi-almacen", o.error, 500, "Could not read the deliveries.");
    if (l.error) return errorAlCliente("kpi-almacen", l.error, 500, "Could not read the order history.");
    entregas.push(...((o.data ?? []) as EntregaParaListas[]));
    listas.push(...((l.data ?? []) as EventoDeOrden[]));
  }
  const entregasKpi = listasAntesDeRecoger(entregas, [...recogidas.filas, ...listas], mes);

  // 4. Merma, ventas y fichajes (totales por tienda y mes; 325).
  let merma: null | ReturnType<typeof resultadoDeMerma> & { filas: number; ventasFilas: number; ventasHasta: string | null } = null;
  let tiempo: null | ReturnType<typeof resultadoDeTiempo> & { horas: number; personas: number } = null;
  let aviso: string | null = null;
  const { data: agregado, error: errorAgregado } = await supabase.rpc("warehouse_ops_kpi_almacen_mes", { p_store: tienda, p_desde: mes.desde, p_hasta: mes.hasta });
  if (errorAgregado) {
    // 42883 = la función no existe: la migración 325 aún no está aplicada. Cualquier otro error sí es un fallo.
    if (errorAgregado.code === "42883") aviso = "migration-325";
    else return errorAlCliente("kpi-almacen", errorAgregado, 500, "Could not read the store totals.");
  } else {
    const a = (agregado ?? {}) as Record<string, number | string | null>;
    const m = resultadoDeMerma(Number(a.merma_valor ?? 0), a.ventas === null || a.ventas === undefined ? null : Number(a.ventas));
    merma = { ...m, filas: Number(a.merma_filas ?? 0), ventasFilas: Number(a.ventas_filas ?? 0), ventasHasta: (a.ventas_hasta as string | null) ?? null };
    // La base manda null con menos de 3 personas (ver 325): ese KPI no se calcula y se muestra como sin datos.
    if (a.turnos !== null && a.turnos !== undefined) {
      const t = resultadoDeTiempo(Number(a.turnos), Number(a.turnos_bien ?? 0));
      tiempo = { ...t, horas: Number(a.horas ?? 0), personas: Number(a.personas ?? 0) };
    }
  }

  const puntaje = puntajeGeneral({
    listas: entregasKpi.pct,
    tiempo: tiempo?.pct ?? null,
    merma: merma?.cumple ?? null,
  });

  return NextResponse.json({
    ok: true,
    tienda, mes: q.get("month"), desde: mes.desde, hasta: mes.hasta,
    aviso,
    listas: entregasKpi,
    merma,
    tiempo,
    puntaje,
    bono: nivelDeBono(puntaje),
    cortado: recogidas.cortado,
  });
}
