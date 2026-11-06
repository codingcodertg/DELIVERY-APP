import type { SupabaseClient } from "@supabase/supabase-js";
import { BUSINESS_TZ } from "@/lib/utils";
import { alcanceDelPanel, ordenesDelPanel, type AlcanceDelPanel } from "@/lib/panel-por-tienda";
import { todasLasFilas } from "@/lib/puntualidad";
import type { OrderTypeRules } from "@/lib/required";
import type { NamedLocation, Profile } from "@/lib/types";
import { configDeTracksolid } from "@/lib/tracksolid/api";
import { almacenEnSupabase, clienteDeServicioDeTracksolid } from "@/lib/tracksolid/almacen";
import { camionesDelDia, type CamionDeUnDia, type CamionHabitual } from "@/lib/tracksolid/camion-del-dia";
import { historialDeCamiones, historialEnSupabase } from "@/lib/tracksolid/historial";
import { armaDias, sitiosDeLasOrdenes, type DatosCrudos, type DiaArmado, type FilaDeEntrega, type FilaDeEta, type FilaDeEvento, type FilaDeTelefono, type RastroDeCamion } from "./arma";

// ============================================================
// Leer de la base todo lo que necesitan los días de un chofer (D-907) y armarlos. Solo servidor.
//
// Lo usan DOS rutas con la misma lectura y el mismo motor, para que den los MISMOS números del mismo día:
//   · `/api/driver-reports` («Reportes de choferes», un rango de hasta 31 días), y
//   · `/api/route-adherence` («Plan contra real» del Recorrido, D-NEXT: un día, con el rastro del camión o del teléfono).
//
// CON QUÉ SE LEE. Órdenes, eventos, horas del plan, posiciones del teléfono y pausas: con la SESIÓN de quien pide (su
// RLS decide). Con la LLAVE DE SERVICIO, y solo después de que la ruta comprobó el rol: qué camión llevó cada chofer
// (`tracksolid_devices`, `truck_day_assignments`), el rastro guardado de los camiones (`truck_track_days`, 264) y la
// caché de tiempos del planificador (`travel_time_cache`) — tablas sin políticas. De ahí salen posiciones, millas y
// minutos; nunca el token ni las llaves de TrackSolid.
//
// SOLO ESCRIBE una cosa: la copia del rastro de un camión que hubo que pedirle a TrackSolid (264).
// ============================================================

const TROZO = 150;
const trozos = <T,>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const sumaDias = (fecha: string, n: number) => new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const COLUMNAS_DE_ENTREGAS = "id, order_code, order_type, store, account, pickup_name, delivery_name, assigned_driver, delivery_date, stage, route_seq, delivery_windows, pickup_duration, delivery_duration, delivery_lat, delivery_lng, pickup_point_lat, pickup_point_lng, pickup_lat, pickup_lng, pod_lat, pod_lng, pickup_gps_at, pod_delivered_at, is_training";

export type Chofer = { id: string; full_name: string };
export type Tienda = { name: string; lat: number; lng: number };

/** Los rastros de los camiones y los tramos del plan: lo que necesita la llave de servicio. Si algo falla, sin ello. */
export async function conLlaveDeServicio(
  pares: { choferId: string; fecha: string }[], sitios: string[], desde: string, hasta: string,
  opciones: { refrescoDeHoyMs?: number; aceptaViejo?: boolean } = {},
) {
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
      pedidos, { zona: BUSINESS_TZ, ...opciones },
    );
    out.pendientes = h.pendientes;
    for (const p of pedidos) {
      const puntos = h.dias.get(`${p.imei}|${p.fecha}`);
      if (puntos) out.camiones.push({ choferId: p.choferId, fecha: p.fecha, imei: p.imei, nombre: nombreDe.get(p.imei) ?? null, puntos });
    }
  } catch (e) {
    console.warn("[reportes-choferes] sin rastro de camiones:", e instanceof Error ? e.name : "error");
  }
  return out;
}

export type DiasCargados = {
  dias: DiaArmado[];
  crudos: DatosCrudos;
  choferes: Chofer[];
  tiendas: Tienda[];
  alcance: AlcanceDelPanel;
  /** Los pares chofer–fecha con alguna orden. */
  pares: { choferId: string; fecha: string }[];
  avisos: { rastroCortado: boolean; camionesPendientes: number; hayTracksolid: boolean };
};
export type ErrorDeCarga = { error: string; detail?: unknown; status: number };

export type PeticionDeDias = {
  supabase: SupabaseClient;
  /** El perfil de quien pide: su alcance de tiendas acota las órdenes (como el Panel, D-396). */
  yo: Pick<Profile, "role" | "store" | "permissions">;
  desde: string; hasta: string;
  /** Solo las órdenes de este chofer (por id de perfil). */
  choferId?: string | null;
  /** Todas las órdenes, sin acotar por las tiendas de quien pide (el mapa en vivo enseña a todos los choferes; la RLS
   *  sigue mandando). Sin esto, el alcance del Panel (`alcanceDelPanel`). */
  todasLasTiendas?: boolean;
  /** Para el día de hoy en el mapa en vivo: cada cuánto se vuelve a pedir a TrackSolid, y si vale lo guardado mientras. */
  rastro?: { refrescoDeHoyMs?: number; aceptaViejo?: boolean };
};

/** Lee y arma los días. Devuelve el error (con su código HTTP) en vez de lanzar: la ruta decide cómo contestarlo. */
export async function cargaDias(p: PeticionDeDias): Promise<DiasCargados | ErrorDeCarga> {
  const { supabase, desde, hasta } = p;
  const [ajustes, gente] = await Promise.all([
    supabase.from("settings").select("stores, order_type_rules").eq("id", 1).maybeSingle(),
    supabase.from("profiles").select("id, full_name").eq("role", "driver"),
  ]);
  if (ajustes.error || gente.error) return { error: "Could not read settings.", detail: (ajustes.error ?? gente.error)?.message, status: 500 };
  const choferes = (gente.data ?? []) as Chofer[];
  const tiendas = ((ajustes.data?.stores ?? []) as NamedLocation[]).flatMap((s) => (typeof s.lat === "number" && typeof s.lng === "number" ? [{ name: s.name, lat: s.lat, lng: s.lng }] : []));
  const elChofer = p.choferId ? choferes.find((c) => c.id === p.choferId) : null;
  if (p.choferId && !elChofer) return { error: "Driver not found.", status: 404 };

  // Las órdenes del rango (por fecha de entrega), acotadas a las tiendas de quien pide.
  const leidas = await todasLasFilas<FilaDeEntrega & { is_training: boolean | null }>((a, b) => {
    let c = supabase.from("deliveries").select(COLUMNAS_DE_ENTREGAS).gte("delivery_date", desde).lte("delivery_date", hasta).not("assigned_driver", "is", null).neq("stage", "canceled");
    if (elChofer) c = c.eq("assigned_driver", elChofer.full_name);
    return c.order("id").range(a, b);
  }, 20_000);
  if (leidas.error) return { error: "Could not read the deliveries.", detail: leidas.error, status: 500 };
  const alcance: AlcanceDelPanel = p.todasLasTiendas ? { tipo: "todas" } : alcanceDelPanel(p.yo, (ajustes.data?.stores ?? []) as NamedLocation[]);
  const entregas = (ordenesDelPanel(leidas.filas as never[], alcance, ajustes.data?.order_type_rules as OrderTypeRules | undefined) as typeof leidas.filas).filter((d) => !d.is_training);
  const ids = entregas.map((d) => d.id);

  const eventos: FilaDeEvento[] = [], etas: FilaDeEta[] = [];
  for (const t of trozos(ids, TROZO)) {
    const [ev, et] = await Promise.all([
      supabase.from("order_events").select("delivery_id, kind, created_by, created_at").in("kind", ["picked_up", "delivered", "arrived_pickup", "arrived_delivery"]).in("delivery_id", t).limit(5000),
      // `*`: con la 260 trae `first_eta` y `plan_at`; sin ella, solo `eta` (y la primera es esa misma).
      supabase.from("delivery_eta_plans").select("*").in("delivery_id", t).gte("plan_date", desde).lte("plan_date", hasta).limit(5000),
    ]);
    if (ev.error || et.error) return { error: "Could not read the order history.", detail: (ev.error ?? et.error)?.message, status: 500 };
    eventos.push(...((ev.data ?? []) as FilaDeEvento[]));
    etas.push(...((et.data ?? []) as FilaDeEta[]));
  }

  // Quién trabajó qué día (de las órdenes), para pedir solo esos rastros.
  const idDe = new Map(choferes.map((c) => [c.full_name.trim().toLowerCase(), c.id]));
  const pares = [...new Map(entregas.flatMap((d) => {
    const id = idDe.get((d.assigned_driver ?? "").trim().toLowerCase());
    return id && d.delivery_date ? [[`${id}|${d.delivery_date}`, { choferId: id, fecha: d.delivery_date }] as const] : [];
  })).values()];

  const servicio = await conLlaveDeServicio(pares, sitiosDeLasOrdenes(entregas, tiendas), desde, hasta, p.rastro);

  // El teléfono: solo de los choferes con algún día sin rastro de camión. Un día de margen a cada lado en UTC.
  const conCamion = new Set(servicio.camiones.filter((c) => c.puntos.length >= 20).map((c) => `${c.choferId}|${c.fecha}`));
  const sinCamion = [...new Set(pares.filter((x) => !conCamion.has(`${x.choferId}|${x.fecha}`)).map((x) => x.choferId))];
  const telefono: FilaDeTelefono[] = [];
  let rastroCortado = false;
  if (sinCamion.length) {
    const r = await todasLasFilas<FilaDeTelefono>((a, b) =>
      supabase.from("driver_locations").select("driver_id, lat, lng, accuracy_m, speed_mps, recorded_at").in("driver_id", sinCamion)
        .gte("recorded_at", `${sumaDias(desde, -1)}T00:00:00Z`).lt("recorded_at", `${sumaDias(hasta, 2)}T00:00:00Z`).order("recorded_at").range(a, b), 120_000);
    if (r.error) return { error: "Could not read the GPS positions.", detail: r.error, status: 500 };
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
  return {
    dias: armaDias(crudos), crudos, choferes, tiendas, alcance, pares,
    avisos: { rastroCortado, camionesPendientes: servicio.pendientes, hayTracksolid: servicio.hayTracksolid },
  };
}

export const esErrorDeCarga = (x: DiasCargados | ErrorDeCarga): x is ErrorDeCarga => "error" in x;
