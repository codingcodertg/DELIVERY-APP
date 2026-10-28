// ============================================================
// Las columnas que la LISTA de órdenes baja de `deliveries` (D-562, migración 177).
//
// La lista hacía `select("*")`, y `photos` / `photo_meta` guardan las fotos en base64 DENTRO de la fila. El
// 2026-10-15 entraron 4 entregas con ~5 MB de fotos y la lista pasó a 6,4 MB por carga —y se recarga entera con
// cada evento realtime—: la app de Entregas se quedaba en «Cargando…» (23 s en una laptop; en los teléfonos no
// terminaba). La lista pide ahora todas las columnas MENOS esas dos, y en su lugar `photo_count`, que calcula la base.
// La ficha de una orden baja sus fotos aparte (`fotos-de-la-orden.ts`).
//
// La lista se construye a partir de `Delivery` con un `Record<keyof Delivery, true>`: una columna nueva en el tipo
// que no se añada aquí NO compila (tsc), y una prueba compara esto con las columnas que crean las migraciones.
// ============================================================
import type { Delivery } from "./types";

const TODAS_LAS_COLUMNAS: Record<keyof Delivery, true> = {
  id: true, order_no: true, order_code: true, order_suffix: true, stage: true, rejected_reason: true,
  canceled_reason: true, canceled_reason_note: true, canceled_by: true, canceled_at: true,
  is_training: true, redelivery_of: true, redelivery_reason: true,
  order_type: true, store: true, po2: true, so_num: true, invoice_num: true, invoices_extra: true, estimate_num: true,
  input_date: true, input_time: true, delivery_date: true,
  pickup_name: true, pickup_address: true, pickup_duration: true,
  delivery_fee: true, est_pallets: true, actual_pallets: true, assigned_driver: true,
  route_seq: true, load_no: true, pickup_seq: true, load_auto: true, delivery_duration: true,
  delivery_name: true, delivery_address: true, delivered_address: true, delivery_windows: true,
  account: true, contact: true, delivery_phone: true, delivery_notes: true, role_notes: true, morning_priority: true,
  route_miles: true, route_duration: true, route_provider: true, route_traffic: true,
  pod_received_by: true, pod_signature: true, pod_delivered_at: true,
  photos: true, photo_count: true,
  departed_at: true, arrived_at: true,
  pickup_lat: true, pickup_lng: true, pickup_gps_at: true, pod_lat: true, pod_lng: true, pod_accuracy: true,
  delivery_lat: true, delivery_lng: true, delivery_pin_source: true,
  photo_meta: true, created_by: true, assigned_sales_rep: true, approved_by: true, approved_at: true,
  csat_rating: true, csat_comment: true, customer_type: true, priority: true,
  customer_email: true, notify_pref: true, customer_lang: true, requirements: true, plan_rank: true,
  created_at: true, updated_at: true,
};

/** Todas las columnas de `deliveries` que conoce el tipo, en el orden de arriba. */
export const COLUMNAS_DE_DELIVERY = Object.keys(TODAS_LAS_COLUMNAS) as (keyof Delivery)[];

/** Lo que la lista NO baja: las fotos, en base64 dentro de la fila. */
export const COLUMNAS_PESADAS: readonly (keyof Delivery)[] = ["photos", "photo_meta"];

/** Las columnas de la lista, separadas por comas, para `.select(...)`. */
/** Columnas que la base puede no tener todavía (D-NEXT: `plan_rank`, 208): se piden aparte con `leeConOpcionales`, y si
 *  faltan la lista llega sin ellas en vez de no llegar. `photo_count` (177) tiene su propio camino de antes. */
export const COLUMNAS_OPCIONALES_DE_LA_LISTA: readonly (keyof Delivery)[] = ["plan_rank"];
export const COLUMNAS_DE_LA_LISTA = COLUMNAS_DE_DELIVERY.filter((c) => !COLUMNAS_PESADAS.includes(c) && !COLUMNAS_OPCIONALES_DE_LA_LISTA.includes(c)).join(",");


/**
 * Lo mismo sin `photo_count`: para el rato entre que se publica el código y se aplica la 177. Sin esto, pedir una
 * columna que no existe tumba la lista entera —lo mismo que se está arreglando—. Sin conteo, la lista cuenta 0 fotos.
 */
export const COLUMNAS_DE_LA_LISTA_SIN_CONTEO = COLUMNAS_DE_DELIVERY
  .filter((c) => !COLUMNAS_PESADAS.includes(c) && !COLUMNAS_OPCIONALES_DE_LA_LISTA.includes(c) && c !== "photo_count").join(",");

/** ¿El error es «esa columna no existe» por `photo_count` (la 177 sin aplicar)? Postgres: 42703. */
export function faltaPhotoCount(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return /photo_count/.test(e.message ?? "") && (e.code === "42703" || e.code === "PGRST204" || /does not exist|could not find/i.test(e.message ?? ""));
}

/**
 * Cuántas fotos tiene la orden. Si la fila TRAE sus fotos (demo, modo enseñanza, o la lista justo después de guardar
 * fotos en esta pestaña), mandan ellas: son lo último. Si no —la fila de la lista— el `photo_count` de la base.
 */
export function conteoDeFotos(d: { photo_count?: number | null; photos?: readonly unknown[] | null }): number {
  return Array.isArray(d.photos) ? d.photos.length : d.photo_count ?? 0;
}

/** El `photo_count` no lo escribe nunca el cliente: lo pone el disparador de la 177. Quitarlo de lo que se manda. */
export function sinPhotoCount<T extends { photo_count?: unknown }>(fila: T): Omit<T, "photo_count"> {
  if (!("photo_count" in fila)) return fila;
  const { photo_count: _fuera, ...resto } = fila;
  return resto;
}
