import { ciudadDeEntrega } from "@/lib/ciudad-de-entrega";
import { fmtWindows, orderLabel, shiftDateISO } from "@/lib/utils";

/**
 * «Ruta de hoy» (D-NEXT): las rutas del día, ENTERAS, para todos los del módulo de entregas — y nada más que eso.
 *
 * El dueño, 2026-10-04: «este mapa lo quiero en el map view que ya esta y que todos los puedan ver y se lo cambias de map a
 * today's route». Y a la pregunta de si cada rol vería solo lo que ya lee o las rutas completas: «si rutas completas pero
 * solo ver nada mas».
 *
 * La RLS de `deliveries` (131) no deja al chofer leer las órdenes de otro chofer, ni a almacén las pendientes, ni a quien
 * tiene tiendas marcadas las de otras tiendas. No se abrió: la función `public.rutas_del_dia(fecha)` (migración 160,
 * `security definer`) devuelve de cada parada SOLO lo que hace falta para pintarla. Esta es su lista blanca, la misma que el
 * `returns table` de la función; `paradaDeLaFila` tira cualquier otra cosa que llegue.
 *
 * Lo que NO está, a propósito: la cuenta/cliente, el contacto, teléfonos, correo, la factura, PO/SO, la tarifa, las notas y
 * la dirección de entrega (solo su CIUDAD y su punto en el mapa).
 */
export const COLUMNAS_DE_RUTAS_DEL_DIA = [
  "id", "order_no", "order_code", "order_suffix", "stage", "assigned_driver", "route_seq", "pickup_seq", "load_no",
  "actual_pallets", "est_pallets", "store", "store_lat", "store_lng", "delivery_lat", "delivery_lng", "delivery_city",
  "delivery_windows", "delivery_date", "delivery_duration", "pickup_duration", "pod_delivered_at", "pickup_gps_at",
] as const;

/** Una parada del día, con lo mínimo. Cumple lo que piden `lista-unica`, la lectura de la ruta, la medida y el mapa. */
export interface ParadaDelDia {
  id: string;
  order_no: number;
  order_code: string | null;
  order_suffix: string | null;
  stage: string;
  assigned_driver: string | null;
  route_seq: number | null;
  pickup_seq: number | null;
  load_no: number | null;
  actual_pallets: number | null;
  est_pallets: number | null;
  /** La tienda donde se recoge, y su punto (de Ajustes → Tiendas). */
  store: string | null;
  store_lat: number | null;
  store_lng: number | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  /** La ciudad de la entrega. Nunca la dirección. */
  delivery_city: string;
  delivery_windows: string | null;
  delivery_date: string | null;
  delivery_duration: string | null;
  pickup_duration: string | null;
  pod_delivered_at: string | null;
  pickup_gps_at: string | null;
}

/** Las etapas que NO son de una ruta: lo que aún no es una orden, y lo que ya no lo es. Las mismas que excluye la 160. */
export const ETAPAS_FUERA_DE_RUTA: ReadonlySet<string> = new Set(["draft", "rejected", "canceled"]);
/** Lo pendiente de una ruta: lo que el Gestor de Rutas asigna y mueve (su `ROUTE_STAGES`). */
export const ETAPAS_PENDIENTES_DE_RUTA: readonly string[] = ["pending", "approved", "fulfilling", "ready"];

/** Cuántos días atrás y adelante enseña «Ruta de hoy». El mismo ±7 que comprueba la función. */
export const DIAS_DE_RUTAS_DEL_DIA = 7;
export function rangoDeRutasDelDia(hoy: string): { min: string; max: string } {
  return { min: shiftDateISO(hoy, -DIAS_DE_RUTAS_DEL_DIA), max: shiftDateISO(hoy, DIAS_DE_RUTAS_DEL_DIA) };
}

const texto = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const numero = (v: unknown): number | null => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Una fila de `rutas_del_dia` → la parada. Solo las columnas de la lista blanca: lo demás se tira aunque llegue. */
export function paradaDeLaFila(fila: Record<string, unknown>): ParadaDelDia {
  return {
    id: String(fila.id ?? ""),
    order_no: numero(fila.order_no) ?? 0,
    order_code: texto(fila.order_code),
    order_suffix: texto(fila.order_suffix),
    stage: String(fila.stage ?? ""),
    assigned_driver: texto(fila.assigned_driver),
    route_seq: numero(fila.route_seq),
    pickup_seq: numero(fila.pickup_seq),
    load_no: numero(fila.load_no),
    actual_pallets: numero(fila.actual_pallets),
    est_pallets: numero(fila.est_pallets),
    store: texto(fila.store),
    store_lat: numero(fila.store_lat),
    store_lng: numero(fila.store_lng),
    delivery_lat: numero(fila.delivery_lat),
    delivery_lng: numero(fila.delivery_lng),
    delivery_city: String(fila.delivery_city ?? ""),
    delivery_windows: texto(fila.delivery_windows),
    delivery_date: texto(fila.delivery_date)?.slice(0, 10) ?? null,
    delivery_duration: texto(fila.delivery_duration),
    pickup_duration: texto(fila.pickup_duration),
    pod_delivered_at: texto(fila.pod_delivered_at),
    pickup_gps_at: texto(fila.pickup_gps_at),
  };
}

/** Lo que se lee de una orden entera para sacar su parada. */
export interface OrdenParaParada {
  id: string; order_no: number; order_code?: string | null; order_suffix?: string | null; stage: string; is_training?: boolean | null;
  assigned_driver?: string | null; route_seq?: number | null; pickup_seq?: number | string | null; load_no?: number | null;
  actual_pallets?: number | null; est_pallets?: number | null; store?: string | null;
  delivery_lat?: number | null; delivery_lng?: number | null; delivery_address?: string | null;
  delivery_windows?: string | null; delivery_date?: string | null; delivery_duration?: string | null; pickup_duration?: string | null;
  pod_delivered_at?: string | null; pickup_gps_at?: string | null;
}
type Tienda = { name: string; lat?: number | null; lng?: number | null };

/**
 * La MISMA proyección que hace la función, sobre órdenes que la pantalla ya tiene: para cuando la 160 aún no está aplicada
 * (cada quien pinta lo que su RLS ya le dejaba leer) y para el demo, que no tiene base. Las mismas reglas: solo ese día, sin
 * enseñanza, sin borradores, rechazadas ni anuladas; y de la dirección, solo la ciudad.
 */
export function paradasDeLasOrdenes(ordenes: readonly OrdenParaParada[], fecha: string, tiendas: readonly Tienda[], ciudadesConocidas: Iterable<string> = []): ParadaDelDia[] {
  const conocidas = [...ciudadesConocidas];
  const tiendaDe = (nombre: string | null | undefined) => {
    const n = (nombre ?? "").trim().toLowerCase();
    return n ? tiendas.find((s) => s.name.trim().toLowerCase() === n) : undefined;
  };
  return ordenes
    .filter((d) => d.delivery_date === fecha && !d.is_training && !ETAPAS_FUERA_DE_RUTA.has(d.stage))
    .map((d) => {
      const tienda = tiendaDe(d.store);
      return paradaDeLaFila({
        ...Object.fromEntries(COLUMNAS_DE_RUTAS_DEL_DIA.map((c) => [c, (d as unknown as Record<string, unknown>)[c]])),
        store_lat: tienda?.lat ?? null, store_lng: tienda?.lng ?? null,
        delivery_city: ciudadDeEntrega(d.delivery_address, conocidas),
      });
    });
}

/** De dónde salieron las paradas que se pintan. */
export type OrigenDeLasRutas =
  /** De `rutas_del_dia`: las rutas enteras. */
  | "funcion"
  /** El demo (sin base): las órdenes del demo, por la misma proyección. */
  | "demo"
  /** La función no existe todavía (falta la migración 160): lo que la RLS de cada quien ya le deja leer. */
  | "sin_funcion"
  /** La función falló por otra cosa (sin red, sin el módulo): lo mismo, lo que ya se podía leer. */
  | "error";

/** El cliente de Supabase, lo justo para llamar a la función (y poder probarlo con uno de mentira). */
export interface ClienteDeRutas {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

/** ¿El error es «esa función no existe»? PostgREST: PGRST202 (no está en su caché de esquema); Postgres: 42883. */
export function faltaLaFuncion(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message ?? "");
}

/** Lee las rutas de un día con la función. UNA llamada a la base; no llama a ningún servicio de mapas. */
export async function leeRutasDelDia(cliente: ClienteDeRutas, fecha: string): Promise<{ origen: "funcion"; paradas: ParadaDelDia[] } | { origen: "sin_funcion" | "error" }> {
  try {
    const { data, error } = await cliente.rpc("rutas_del_dia", { p_fecha: fecha });
    if (error) return { origen: faltaLaFuncion(error) ? "sin_funcion" : "error" };
    return { origen: "funcion", paradas: (Array.isArray(data) ? data : []).map((f) => paradaDeLaFila(f as Record<string, unknown>)) };
  } catch {
    return { origen: "error" };
  }
}

/** Lo pendiente y lo hecho de las paradas del día: lo que el Gestor llama `dayOrders` y `hechasPintadas`. */
export function pendientesDelDia<T extends { stage: string }>(paradas: readonly T[]): T[] {
  return paradas.filter((p) => ETAPAS_PENDIENTES_DE_RUTA.includes(p.stage));
}

/**
 * El rótulo de una parada al pulsar su pin: P/D, chofer, ciudad, pallets, ventana y llegada. Es TODO lo que «Ruta de hoy»
 * dice de una orden — no hay cliente ni dirección que enseñar, porque no se leyeron.
 */
export function rotuloDeLaParada(
  p: Pick<ParadaDelDia, "order_no" | "order_code" | "order_suffix" | "assigned_driver" | "delivery_city" | "actual_pallets" | "est_pallets" | "delivery_windows" | "stage" | "store">,
  extra: { etiqueta?: string | null; llegada?: string | null; horaReal?: string | null }, t: (en: string, es: string) => string,
): { titulo: string; datos: { clave: string; nombre: string; valor: string }[] } {
  const pallets = p.actual_pallets ?? p.est_pallets;
  const datos = [
    { clave: "chofer", nombre: t("Driver", "Chofer"), valor: p.assigned_driver || t("Unassigned", "Sin asignar") },
    { clave: "recogida", nombre: t("Pickup", "Recogida"), valor: p.store || "—" },
    { clave: "ciudad", nombre: t("Delivery city", "Ciudad de entrega"), valor: p.delivery_city || "—" },
    { clave: "pallets", nombre: t("Pallets", "Pallets"), valor: pallets == null ? "—" : String(pallets) },
    { clave: "ventana", nombre: t("Window", "Ventana"), valor: fmtWindows(p.delivery_windows) },
    p.stage === "delivered"
      ? { clave: "llegada", nombre: t("Delivered", "Entregada"), valor: extra.horaReal || "✓" }
      : { clave: "llegada", nombre: t("Estimated arrival", "Llegada estimada"), valor: extra.llegada || "—" },
  ];
  return { titulo: `${extra.etiqueta ? `${extra.etiqueta} · ` : ""}#${orderLabel(p)}`, datos };
}

/**
 * En qué pestaña va el aviso «N órdenes para hoy/mañana sin chofer». Iba en «Mapa», que era donde se asignaba; «Ruta de hoy»
 * es de solo lectura, así que va donde SÍ se asigna: el Gestor de Rutas, para quien lo tiene. Quien no lo tiene (el gerente)
 * lo sigue viendo en «Ruta de hoy», donde esas órdenes salen como pines grises.
 */
export function pestanaDelAvisoSinChofer(pestanasVisibles: readonly string[]): "routes" | "map" | null {
  if (pestanasVisibles.includes("routes")) return "routes";
  return pestanasVisibles.includes("map") ? "map" : null;
}
