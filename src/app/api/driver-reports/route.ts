import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/api-auth";
import { BUSINESS_TZ } from "@/lib/utils";
import { alcanceDelPanel, ordenesDelPanel } from "@/lib/panel-por-tienda";
import { todasLasFilas } from "@/lib/puntualidad";
import type { OrderTypeRules } from "@/lib/required";
import type { NamedLocation, Profile } from "@/lib/types";
import { configDeTracksolid } from "@/lib/tracksolid/api";
import { almacenEnSupabase, clienteDeServicioDeTracksolid } from "@/lib/tracksolid/almacen";
import { camionesDelDia, type CamionDeUnDia, type CamionHabitual } from "@/lib/tracksolid/camion-del-dia";
import { historialDeCamiones, historialEnSupabase } from "@/lib/tracksolid/historial";
import { armaDias, mapaDelDia, sitiosDeLasOrdenes, type DatosCrudos, type FilaDeEntrega, type FilaDeEta, type FilaDeEvento, type FilaDeTelefono, type RastroDeCamion } from "@/lib/reportes-choferes/arma";
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
// CON QUÉ SE LEE. Órdenes, eventos, horas del plan, posiciones del teléfono y pausas: con la SESIÓN de quien pide (su
// RLS decide). Con la LLAVE DE SERVICIO, y solo después de comprobar el rol: qué camión llevó cada chofer
// (`tracksolid_devices`, `truck_day_assignments`), el rastro guardado de los camiones (`truck_track_days`, 264) y la
// caché de tiempos del planificador (`travel_time_cache`) — tablas sin políticas. De ahí salen posiciones, millas y
// minutos; nunca el token ni las llaves de TrackSolid.
//
// SOLO ESCRIBE una cosa: la copia del rastro de un camión que hubo que pedirle a TrackSolid (264). No toca órdenes,
// no avisa a nadie y a TrackSolid solo le pregunta.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SIN_CACHE = { "Cache-Control": "no-store" };
const TROZO = 150;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const trozos = <T,>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const sumaDias = (fecha: string, n: number) => new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const COLUMNAS = "id, order_code, order_type, store, account, pickup_name, delivery_name, assigned_driver, delivery_date, stage, route_seq, delivery_windows, pickup_duration, delivery_duration, delivery_lat, delivery_lng, pickup_point_lat, pickup_point_lng, pickup_lat, pickup_lng, pod_lat, pod_lng, pickup_gps_at, pod_delivered_at, is_training";

/** Los rastros de los camiones y los tramos del plan: lo que necesita la llave de servicio. Si algo falla, sin ello. */
async function conLlaveDeServicio(pares: { choferId: string; fecha: string }[], sitios: string[], desde: string, hasta: string) {
  const out = { camiones: [] as RastroDeCamion[], tramos: new Map<string, { millas: number; minutos: number }>(), pendientes: 0, hayTracksolid: false };
  let db: SupabaseClient;
  try { db = clienteDeServicioDeTracksolid(); } catch { return out; }

  // Los tramos de la caché del planificador (sin tráfico), por orígenes.
  try {
    const quiero = new Set(sitios);
    for (const t of trozos(sitios, 60)) {
      const r = await todasLasFilas<{ origin_key: string; dest_key: string; minutes: number; miles: number }>((a, b) =>
        db.from("travel_time_cache").select("origin_key, dest_key, minutes, miles").eq("weekday", -1).eq("block", -1).eq("traffic", false).in("origin_key", t).order("dest_key").range(a, b), 20_000);
      for (const f of r.filas) if (quiero.has(f.dest_key)) out.tramos.set(`${f.origin_key}|${f.dest_key}`, { millas: Number(f.miles), minutos: Number(f.minutes) });
    }
  } catch { /* sin caché: los tramos salen estimados, y la pantalla lo dice */ }

  const config = configDeTracksolid();
  if (!config || !pares.length) return out;
  try {
    const [enlaces, delDia] = await Promise.all([
      db.from("tracksolid_devices").select("imei, driver_id, device_name"),
      db.from("truck_day_assignments").select("day, driver_id, imei").gte("day", desde).lte("day", hasta),
    ]);
    if (enlaces.error) return out;
    const habituales = (enlaces.data ?? []) as (CamionHabitual & { device_name: string | null })[];
    if (!habituales.length) return out;
    out.hayTracksolid = true;
    const excepciones = (delDia.error ? [] : delDia.data ?? []) as (CamionDeUnDia & { day: string })[];
    const nombreDe = new Map(habituales.map((h) => [h.imei, h.device_name]));
    const pedidos: { imei: string; fecha: string; choferId: string }[] = [];
    for (const fecha of [...new Set(pares.map((p) => p.fecha))]) {
      const resueltos = camionesDelDia(habituales, excepciones.filter((x) => String(x.day).slice(0, 10) === fecha));
      for (const p of pares.filter((x) => x.fecha === fecha)) {
        const imei = resueltos.get(p.choferId)?.imei;
        if (imei) pedidos.push({ imei, fecha, choferId: p.choferId });
      }
    }
    const h = await historialDeCamiones(
      { config, almacen: almacenEnSupabase(db), historial: historialEnSupabase(db), fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }) },
      pedidos, { zona: BUSINESS_TZ },
    );
    out.pendientes = h.pendientes;
    for (const p of pedidos) {
      const puntos = h.dias.get(`${p.imei}|${p.fecha}`);
      if (puntos) out.camiones.push({ choferId: p.choferId, fecha: p.fecha, imei: p.imei, nombre: nombreDe.get(p.imei) ?? null, puntos });
    }
  } catch (e) {
    console.warn("[driver-reports] sin rastro de camiones:", e instanceof Error ? e.name : "error");
  }
  return out;
}

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

  const [ajustes, gente] = await Promise.all([
    supabase.from("settings").select("stores, order_type_rules").eq("id", 1).maybeSingle(),
    supabase.from("profiles").select("id, full_name").eq("role", "driver"),
  ]);
  if (ajustes.error || gente.error) return NextResponse.json({ error: "Could not read settings.", detail: (ajustes.error ?? gente.error)?.message }, { status: 500 });
  const choferes = (gente.data ?? []) as { id: string; full_name: string }[];
  const tiendas = ((ajustes.data?.stores ?? []) as NamedLocation[]).flatMap((s) => (typeof s.lat === "number" && typeof s.lng === "number" ? [{ name: s.name, lat: s.lat, lng: s.lng }] : []));
  const elChofer = chofer ? choferes.find((c) => c.id === chofer) : null;
  if (chofer && !elChofer) return NextResponse.json({ error: "Driver not found." }, { status: 404 });

  // Las órdenes del rango (por fecha de entrega), acotadas a las tiendas de quien pide.
  const leidas = await todasLasFilas<FilaDeEntrega & { is_training: boolean | null }>((a, b) => {
    let c = supabase.from("deliveries").select(COLUMNAS).gte("delivery_date", desde).lte("delivery_date", hasta).not("assigned_driver", "is", null).neq("stage", "canceled");
    if (elChofer) c = c.eq("assigned_driver", elChofer.full_name);
    return c.order("id").range(a, b);
  }, 20_000);
  if (leidas.error) return NextResponse.json({ error: "Could not read the deliveries.", detail: leidas.error }, { status: 500 });
  const alcance = alcanceDelPanel(yo as Pick<Profile, "role" | "store" | "permissions">, (ajustes.data?.stores ?? []) as NamedLocation[]);
  const entregas = (ordenesDelPanel(leidas.filas as never[], alcance, ajustes.data?.order_type_rules as OrderTypeRules | undefined) as typeof leidas.filas).filter((d) => !d.is_training);
  const ids = entregas.map((d) => d.id);

  const eventos: FilaDeEvento[] = [], etas: FilaDeEta[] = [];
  for (const t of trozos(ids, TROZO)) {
    const [ev, et] = await Promise.all([
      supabase.from("order_events").select("delivery_id, kind, created_by, created_at").in("kind", ["picked_up", "delivered", "arrived_pickup", "arrived_delivery"]).in("delivery_id", t).limit(5000),
      // `*`: con la 260 trae `first_eta` y `plan_at`; sin ella, solo `eta` (y la primera es esa misma).
      supabase.from("delivery_eta_plans").select("*").in("delivery_id", t).gte("plan_date", desde).lte("plan_date", hasta).limit(5000),
    ]);
    if (ev.error || et.error) return NextResponse.json({ error: "Could not read the order history.", detail: (ev.error ?? et.error)?.message }, { status: 500 });
    eventos.push(...((ev.data ?? []) as FilaDeEvento[]));
    etas.push(...((et.data ?? []) as FilaDeEta[]));
  }

  // Quién trabajó qué día (de las órdenes), para pedir solo esos rastros.
  const idDe = new Map(choferes.map((c) => [c.full_name.trim().toLowerCase(), c.id]));
  const pares = [...new Map(entregas.flatMap((d) => {
    const id = idDe.get((d.assigned_driver ?? "").trim().toLowerCase());
    return id && d.delivery_date ? [[`${id}|${d.delivery_date}`, { choferId: id, fecha: d.delivery_date }] as const] : [];
  })).values()];

  const servicio = await conLlaveDeServicio(pares, sitiosDeLasOrdenes(entregas, tiendas), desde, hasta);

  // El teléfono: solo de los choferes con algún día sin rastro de camión. Un día de margen a cada lado en UTC.
  const conCamion = new Set(servicio.camiones.filter((c) => c.puntos.length >= 20).map((c) => `${c.choferId}|${c.fecha}`));
  const sinCamion = [...new Set(pares.filter((p) => !conCamion.has(`${p.choferId}|${p.fecha}`)).map((p) => p.choferId))];
  const telefono: FilaDeTelefono[] = [];
  let rastroCortado = false;
  if (sinCamion.length) {
    const r = await todasLasFilas<FilaDeTelefono>((a, b) =>
      supabase.from("driver_locations").select("driver_id, lat, lng, accuracy_m, speed_mps, recorded_at").in("driver_id", sinCamion)
        .gte("recorded_at", `${sumaDias(desde, -1)}T00:00:00Z`).lt("recorded_at", `${sumaDias(hasta, 2)}T00:00:00Z`).order("recorded_at").range(a, b), 120_000);
    if (r.error) return NextResponse.json({ error: "Could not read the GPS positions.", detail: r.error }, { status: 500 });
    // Cortado por el tope: un rastro a medias daría paradas y millas de menos. Mejor sin teléfono, y decirlo.
    rastroCortado = r.cortado;
    if (!r.cortado) telefono.push(...r.filas);
  }

  const { data: pausas } = await supabase.from("pausas_del_chofer").select("driver_id, empezo_at, termino_at")
    .gte("empezo_at", `${sumaDias(desde, -1)}T00:00:00Z`).lt("empezo_at", `${sumaDias(hasta, 2)}T00:00:00Z`).limit(5000);

  const crudos: DatosCrudos = {
    zona: BUSINESS_TZ, entregas, eventos, etas, choferes, tiendas, telefono, camiones: servicio.camiones,
    pausas: (pausas ?? []) as DatosCrudos["pausas"], tramos: servicio.tramos,
  };
  const dias = armaDias(crudos);

  return NextResponse.json({
    ok: true, desde, hasta, alcance: alcance.tipo, zona: BUSINESS_TZ,
    choferes: choferes.filter((c) => pares.some((p) => p.choferId === c.id)).map((c) => ({ id: c.id, nombre: c.full_name })),
    dias: dias.map((d) => d.informe),
    mapa: conMapa && dias.length === 1 ? mapaDelDia(dias[0]) : null,
    tiendas,
    avisos: { rastroCortado, camionesPendientes: servicio.pendientes, hayTracksolid: servicio.hayTracksolid },
  }, { headers: SIN_CACHE });
}
