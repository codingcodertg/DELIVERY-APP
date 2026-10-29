/**
 * Millas y reparto del gas por tienda, para el Panel (D-NEXT, 2026-10-29).
 *
 * El dueño pidió un informe de «cuántas millas por tienda» para repartir el gasto de gasolina entre
 * las tiendas (2026-10-29), y después «incluyamos estas tablas al panel». Lo que se hizo a mano sobre
 * octubre está aquí como regla, para que el Panel lo saque solo en cualquier rango:
 *
 * - **Cuentan** las órdenes **entregadas o recogidas** (`ETAPAS_QUE_VIAJAN`): un viaje que salió. Las
 *   abiertas, anuladas y rechazadas no gastaron gasolina.
 * - **Parada** = mismo día, mismo chofer, misma tienda que paga y mismo destino. Dos órdenes que fueron
 *   en el mismo viaje a la misma puerta son UNA parada, con las millas de una (la mayor), no la suma.
 * - **Millas:** las de Google (`route_miles`, tienda → destino directo) cuando la orden salió de su
 *   tienda y la cifra es creíble (≤ `TOPE_MILLAS_CREIBLES`; en octubre había cuatro geocodes de 700 a
 *   1800 millas). Si no, **estimada**: línea recta tienda → coordenadas del destino × `FACTOR_LINEA_RECTA`.
 *   Sin coordenadas ni cifra creíble: 0 y `sinDato`, para que se vea que falta.
 * - **Quién paga:** la tienda que creó la orden (`store`)… salvo las de tienda a tienda, que las paga la
 *   que **recibe** (`delivery_name`): regla del dueño, 2026-10-29 («el envío lo paga la tienda que lo
 *   recibe»). Se decide por la regla del tipo (`storeToStore`), no por el nombre del tipo.
 * - **% del gas** = millas de la tienda ÷ millas de todas, del rango que esté puesto en el Panel.
 *
 * Nada de aquí toca la base: recibe las órdenes que ya tiene el Panel (su alcance y su rango) y las
 * tiendas de Ajustes.
 */
import { orderTypeRule, type OrderTypeRules } from "./required";
import { haversineMi } from "./route-batching";
import { redondeaMillas } from "./totales";
import type { Delivery, NamedLocation } from "./types";

export const ETAPAS_QUE_VIAJAN: readonly string[] = ["picked_up", "delivered"];
/** Línea recta × esto ≈ carretera, en el Valle. El mismo factor que usó el informe de octubre. */
export const FACTOR_LINEA_RECTA = 1.3;
/** Por encima de esto, la cifra de Google es un geocode malo, no un viaje. */
export const TOPE_MILLAS_CREIBLES = 150;

export type OrdenDeMillas = Pick<
  Delivery,
  | "id" | "stage" | "store" | "pickup_name" | "delivery_name" | "delivery_address" | "delivery_lat" | "delivery_lng"
  | "route_miles" | "order_type" | "assigned_driver" | "delivery_date" | "input_date" | "created_at"
>;

export interface ParadaDeMillas {
  fecha: string;
  chofer: string;
  /** La tienda que creó la orden. */
  tienda: string;
  /** La que paga el gas: la que recibe si es de tienda a tienda; si no, `tienda`. */
  paga: string;
  destino: string;
  ordenes: number;
  millas: number;
  estimada: boolean;
  sinDato: boolean;
  entreTiendas: boolean;
}

export interface MillasDeTienda {
  tienda: string;
  paradas: number;
  ordenes: number;
  millasReales: number;
  millasEstimadas: number;
  millas: number;
  paradasEstimadas: number;
  paradasSinDato: number;
  /** Parte del total de millas del rango, en %, a un decimal. `null` si nadie hizo millas. */
  pctGas: number | null;
}

export const SIN_CHOFER = "(sin chofer)";
const SIN_TIENDA = "—";

const limpia = (s: string | null | undefined) => (s ?? "").trim();

/** La misma dirección escrita de dos maneras es el mismo destino: sin país, sin ZIP, sin puntuación. */
export function destinoDeParada(d: Pick<OrdenDeMillas, "id" | "delivery_address" | "delivery_lat" | "delivery_lng">): string {
  const dir = limpia(d.delivery_address)
    .toLowerCase()
    .replace(/united states|usa|,|\./g, " ")
    .replace(/\b\d{5}(-\d{4})?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (dir) return dir;
  if (d.delivery_lat != null && d.delivery_lng != null) return `${d.delivery_lat.toFixed(4)},${d.delivery_lng.toFixed(4)}`;
  return "?" + d.id;
}

/** La tienda que paga el gas de esta orden. */
export function tiendaQuePaga(d: Pick<OrdenDeMillas, "store" | "delivery_name" | "order_type">, reglas?: OrderTypeRules): string {
  const recibe = limpia(d.delivery_name);
  if (recibe && orderTypeRule(d.order_type, reglas).storeToStore === true) return recibe;
  return limpia(d.store) || SIN_TIENDA;
}

const fechaDe = (d: OrdenDeMillas) => (d.delivery_date || d.input_date || d.created_at).slice(0, 10);

/** Millas de UNA orden, según las reglas de arriba; `null` cuando no hay con qué. */
function millasDeOrden(d: OrdenDeMillas, tienda: NamedLocation | undefined): { millas: number; estimada: boolean } | null {
  const google = d.route_miles == null ? null : Number(d.route_miles);
  const salioDeSuTienda = !limpia(d.pickup_name) || limpia(d.pickup_name).toLowerCase() === limpia(d.store).toLowerCase();
  if (google != null && Number.isFinite(google) && google >= 0 && google <= TOPE_MILLAS_CREIBLES && salioDeSuTienda) {
    return { millas: google, estimada: false };
  }
  if (d.delivery_lat != null && d.delivery_lng != null && tienda?.lat != null && tienda?.lng != null) {
    const recta = haversineMi({ lat: tienda.lat, lng: tienda.lng }, { lat: d.delivery_lat, lng: d.delivery_lng });
    const est = redondeaMillas(recta * FACTOR_LINEA_RECTA);
    if (est <= TOPE_MILLAS_CREIBLES) return { millas: est, estimada: true };
  }
  return null;
}

/** Las paradas del rango: una por día + chofer + tienda que paga + destino. */
export function paradasDeMillas(ordenes: readonly OrdenDeMillas[], tiendas: readonly NamedLocation[], reglas?: OrderTypeRules): ParadaDeMillas[] {
  const porNombre = new Map(tiendas.map((t) => [t.name.trim().toLowerCase(), t]));
  const paradas = new Map<string, ParadaDeMillas & { candidatas: ({ millas: number; estimada: boolean } | null)[] }>();
  for (const d of ordenes) {
    if (!ETAPAS_QUE_VIAJAN.includes(d.stage)) continue;
    const fecha = fechaDe(d);
    const chofer = limpia(d.assigned_driver) || SIN_CHOFER;
    const tienda = limpia(d.store) || SIN_TIENDA;
    const paga = tiendaQuePaga(d, reglas);
    const destino = destinoDeParada(d);
    const k = [fecha, chofer, paga, destino].join("|");
    const p = paradas.get(k) ?? {
      fecha, chofer, tienda, paga, destino, ordenes: 0, millas: 0, estimada: false, sinDato: false,
      entreTiendas: paga !== tienda, candidatas: [],
    };
    p.ordenes++;
    p.candidatas.push(millasDeOrden(d, porNombre.get(tienda.toLowerCase())));
    paradas.set(k, p);
  }
  return [...paradas.values()].map(({ candidatas, ...p }) => {
    // La mayor de las REALES; si ninguna es real, la mayor de las estimadas; si nada, sin dato.
    const reales = candidatas.filter((c): c is { millas: number; estimada: boolean } => !!c && !c.estimada);
    const estimadas = candidatas.filter((c): c is { millas: number; estimada: boolean } => !!c && c.estimada);
    const usa = reales.length ? reales : estimadas;
    if (!usa.length) return { ...p, millas: 0, estimada: true, sinDato: true };
    return { ...p, millas: Math.max(...usa.map((c) => c.millas)), estimada: !reales.length, sinDato: false };
  });
}

const vacia = (tienda: string): MillasDeTienda => ({
  tienda, paradas: 0, ordenes: 0, millasReales: 0, millasEstimadas: 0, millas: 0, paradasEstimadas: 0, paradasSinDato: 0, pctGas: null,
});

/** Una fila por tienda que paga, de más a menos millas, y la fila del total. */
export function millasPorTienda(paradas: readonly ParadaDeMillas[]): { filas: MillasDeTienda[]; total: MillasDeTienda } {
  const porTienda = new Map<string, MillasDeTienda>();
  const total = vacia("Total");
  const suma = (f: MillasDeTienda, p: ParadaDeMillas) => {
    f.paradas++;
    f.ordenes += p.ordenes;
    if (p.estimada) { f.millasEstimadas += p.millas; f.paradasEstimadas++; } else f.millasReales += p.millas;
    if (p.sinDato) f.paradasSinDato++;
  };
  for (const p of paradas) {
    const f = porTienda.get(p.paga) ?? vacia(p.paga);
    suma(f, p);
    suma(total, p);
    porTienda.set(p.paga, f);
  }
  const cierra = (f: MillasDeTienda) => {
    f.millasReales = redondeaMillas(f.millasReales);
    f.millasEstimadas = redondeaMillas(f.millasEstimadas);
    f.millas = redondeaMillas(f.millasReales + f.millasEstimadas);
  };
  cierra(total);
  const filas = [...porTienda.values()].map((f) => {
    cierra(f);
    f.pctGas = total.millas > 0 ? Math.round((f.millas / total.millas) * 1000) / 10 : null;
    return f;
  }).sort((a, b) => b.millas - a.millas || a.tienda.localeCompare(b.tienda));
  total.pctGas = total.millas > 0 ? 100 : null;
  return { filas, total };
}
