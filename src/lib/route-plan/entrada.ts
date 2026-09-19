import { parseWindow } from "@/lib/dispatch";
import { serviceMin } from "@/lib/trip-timing";
import { isStoreToStore, type OrderTypeRules } from "@/lib/required";
import { tipoDeClienteDeLaOrden } from "@/lib/customer-type";
import { choferParaElMotor, esVentanaDura, pesosDeRuta, topeDeRetrasoMin, type ChoferParaElMotor } from "@/lib/route-settings";
import {
  PARAMETROS_POR_DEFECTO, type ChoferEntrada, type Entrada, type OrdenEntrada, type Parametros, type Plan, type Punto,
} from "@/lib/route-engine";
import type { LatLng } from "@/lib/route-times/claves";
import type { Delivery, DriverSettings, NamedLocation, Profile, Settings } from "@/lib/types";
import { ETAPAS_RUTEABLES, ordenDeLaParte, type EscrituraDeOrden } from "./publicar";

/**
 * De lo que hay en la base a lo que entiende el motor, y de vuelta (D-320). Puro: recibe filas y devuelve
 * datos. Plan en `docs/PLAN-133-route-plans.md`.
 *
 * Lo que se decide aquí, y conviene saber:
 *   · El ORIGEN de una orden es su tienda (`pickup_name`, y si falta, `store`): su punto es el de Ajustes. Una
 *     tienda sin punto, o una orden sin tienda, deja la orden sin origen y el motor la saca «sin punto».
 *   · El DESTINO es el pin de la orden (`delivery_lat/lng`). En un movimiento entre tiendas, si no hay pin, el
 *     punto de la tienda que recibe. **No se geocodifica nada aquí** (D-223): sin pin no hay destino.
 *   · Una orden metida en un «route bucket» —un chofer ficticio— queda FUERA del plan: es un carril manual.
 *   · El chofer que ya trae una orden se respeta SOLO si lo puso una persona: si coincide con lo que escribió
 *     el último plan publicado de esa fecha, lo puso el motor y la orden es libre. Sin esto, re-planificar un
 *     día ya publicado no podría mover nada.
 */

export const puntoDeTienda = (nombre: string): Punto => `tienda:${nombre.trim().toLowerCase()}`;
export const puntoDeOrden = (id: string): Punto => `orden:${id}`;

type OrdenDeLaBase = Pick<Delivery,
  "id" | "stage" | "order_code" | "order_type" | "store" | "pickup_name" | "delivery_name" | "delivery_lat" | "delivery_lng" |
  "delivery_windows" | "est_pallets" | "actual_pallets" | "pickup_duration" | "delivery_duration" | "assigned_driver" |
  "input_date" | "input_time" | "account" | "customer_type" | "is_training" | "updated_at"> & { invoice_num?: string | null };

export interface DatosDelDia {
  ordenes: readonly OrdenDeLaBase[];
  choferes: readonly Pick<Profile, "id" | "full_name" | "role">[];
  ajustesDeChofer: readonly DriverSettings[];
  settings: Pick<Settings, "stores" | "accounts" | "order_type_rules" | "route_buckets" | "driver_capacity" | "default_truck_capacity" |
    "route_weights" | "route_hard_windows" | "route_late_cap_min">;
  /** Lo que escribió el último plan publicado de esa fecha, para saber qué chofer puso el motor y cuál una persona. */
  publicadoAntes?: readonly Pick<EscrituraDeOrden, "id" | "assigned_driver">[];
  /** Choferes que ese día no están (vacaciones, baja): por NOMBRE, como lo da `unavailableDriverNames`. */
  noDisponibles?: readonly string[];
  /** Lo que una persona fijó en el borrador anterior de esa fecha (ver `./ajuste`): por chofer, sus paradas en
   *  orden. «Planificar de nuevo» lo respeta: el motor arranca con eso puesto y reparte el resto alrededor. */
  fijadas?: Readonly<Record<string, readonly { orden: string; tipo: "P" | "D" }[]>>;
}

export type FueraDelPlan = { id: string; motivo: "en_un_carril_manual" | "chofer_no_rutea" };

export interface EntradaDelDia {
  entrada: Entrada;
  parametros: Parametros;
  puntos: Record<Punto, LatLng>;
  /** Para guardar con el plan: cada orden con su `updated_at`, que es contra lo que se compara al publicar. */
  /** `factura`: la que tenía la orden AL PLANIFICAR, para la historia. En pantalla la factura se lee en vivo. */
  fotos: { id: string; updated_at: string; factura: string | null }[];
  /** Órdenes que ni entran al motor, con su porqué. */
  fuera: FueraDelPlan[];
  /** Choferes que no rutean, y qué les falta: para que la pantalla lo diga en vez de callarlo. */
  choferesFuera: { id: string; nombre: string; motivo: "no_rutea" | "base" | "base_sin_punto" | "no_disponible" }[];
}

const igual = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export function entradaDelDia(datos: DatosDelDia): EntradaDelDia {
  const { settings } = datos;
  const tiendas: readonly NamedLocation[] = settings.stores ?? [];
  const reglas = settings.order_type_rules as OrderTypeRules | undefined;
  const puntos: Record<Punto, LatLng> = {};
  const tiendaConPunto = (nombre: string | null | undefined): Punto | null => {
    const t = tiendas.find((s) => igual(s.name, nombre));
    if (!t || t.lat == null || t.lng == null) return null;
    puntos[puntoDeTienda(t.name)] = { lat: t.lat, lng: t.lng };
    return puntoDeTienda(t.name);
  };

  // ---- Choferes ----
  const filaDe = new Map(datos.ajustesDeChofer.map((f) => [f.profile_id, f]));
  const paraElMotor: ChoferParaElMotor[] = datos.choferes.filter((p) => p.role === "driver").map((p) => choferParaElMotor(p, filaDe.get(p.id), settings));
  const choferes: ChoferEntrada[] = [];
  const choferesFuera: EntradaDelDia["choferesFuera"] = [];
  for (const c of paraElMotor) {
    const base = c.rutea ? tiendaConPunto(c.base) : null;
    const motivo = (datos.noDisponibles ?? []).some((n) => igual(n, c.nombre)) ? "no_disponible" as const
      : c.falta[0] ?? (!c.rutea || !base ? "no_rutea" as const : null);
    if (motivo || !base) { choferesFuera.push({ id: c.id, nombre: c.nombre, motivo: motivo ?? "no_rutea" }); continue; }
    choferes.push({ id: c.id, nombre: c.nombre, base, capacidad: c.capacidad, entrada: c.entradaMin, salida: c.salidaMin, vuelveABase: c.vuelveABase });
  }
  const idPorNombre = new Map(paraElMotor.map((c) => [c.nombre.trim().toLowerCase(), c.id]));
  const ruteables = new Set(choferes.map((c) => c.id));
  const puestoPorElMotor = new Map((datos.publicadoAntes ?? []).map((w) => [w.id, w.assigned_driver]));
  const carriles = settings.route_buckets ?? [];

  // ---- Órdenes ----
  const ordenes: OrdenEntrada[] = [];
  const fotos: EntradaDelDia["fotos"] = [];
  const fuera: FueraDelPlan[] = [];
  for (const d of datos.ordenes) {
    if (d.is_training || !ETAPAS_RUTEABLES.includes(d.stage)) continue;
    const asignado = (d.assigned_driver ?? "").trim();
    if (asignado && carriles.some((b) => igual(b, asignado))) { fuera.push({ id: d.id, motivo: "en_un_carril_manual" }); continue; }

    // ¿Lo puso una persona? Solo si NO es lo que escribió el último plan publicado.
    const loPusoUnaPersona = !!asignado && !igual(puestoPorElMotor.get(d.id), asignado);
    const choferFijado = loPusoUnaPersona ? idPorNombre.get(asignado.toLowerCase()) ?? null : null;
    if (loPusoUnaPersona && (!choferFijado || !ruteables.has(choferFijado))) { fuera.push({ id: d.id, motivo: "chofer_no_rutea" }); continue; }

    const entreTiendas = isStoreToStore(d.order_type, reglas);
    const origen = tiendaConPunto(d.pickup_name) ?? tiendaConPunto(d.store);
    let destino: Punto | null = null;
    if (d.delivery_lat != null && d.delivery_lng != null) {
      destino = puntoDeOrden(d.id);
      puntos[destino] = { lat: d.delivery_lat, lng: d.delivery_lng };
    } else if (entreTiendas) destino = tiendaConPunto(d.delivery_name);

    const pallets = Number(d.actual_pallets ?? d.est_pallets ?? 0);
    ordenes.push({
      id: d.id, codigo: d.order_code ?? null,
      entrada: d.input_date ? `${d.input_date} ${(d.input_time ?? "").padStart(4, "0")}` : null,
      origen, destino, pallets: Number.isFinite(pallets) && pallets > 0 ? pallets : 0,
      ventana: parseWindow(d.delivery_windows), estrecha: esVentanaDura(d.delivery_windows, settings),
      builder: tipoDeClienteDeLaOrden(d, reglas, settings.accounts) === "builder",
      servicioRecogidaMin: serviceMin(d.pickup_duration), servicioEntregaMin: serviceMin(d.delivery_duration),
      choferFijado,
    });
    fotos.push({ id: d.id, updated_at: d.updated_at, factura: d.invoice_num ?? null });
  }

  // Lo fijado solo vale si sigue teniendo sentido HOY: el chofer rutea, y la orden sigue en el plan.
  const enElPlan = new Set(ordenes.map((o) => o.id));
  const secuenciaFijada: NonNullable<Entrada["secuenciaFijada"]> = {};
  for (const [chofer, paradas] of Object.entries(datos.fijadas ?? {})) {
    const validas = ruteables.has(chofer) ? paradas.filter((p) => enElPlan.has(ordenDeLaParte(p.orden))) : [];
    if (validas.length) secuenciaFijada[chofer] = validas.map((p) => ({ orden: p.orden, tipo: p.tipo }));
  }
  const parametros: Parametros = { ...PARAMETROS_POR_DEFECTO, pesos: pesosDeRuta(settings), topeTardeAnchaMin: topeDeRetrasoMin(settings) };
  return { entrada: { ordenes, choferes, matriz: {}, ...(Object.keys(secuenciaFijada).length ? { secuenciaFijada } : {}) }, parametros, puntos, fotos, fuera, choferesFuera };
}

export interface FilaDeParada {
  driver_id: string; driver_name: string; seq: number; kind: "P" | "D"; delivery_id: string; order_ref: string; label: string; visit: number;
  place: string | null; lat: number | null; lng: number | null; window_start: number | null; window_end: number | null; is_hard: boolean;
  eta: number; etd: number; wait_min: number; service_min: number; late_min: number; load_after: number; leg_minutes: number; leg_miles: number; pinned: boolean;
}

/** Un plan del motor, como filas de `route_plan_stops`. */
export function filasDeParadas(plan: Pick<Plan, "rutas">, entrada: Pick<Entrada, "ordenes" | "choferes">, puntos: Readonly<Record<Punto, LatLng>>, tiendas: readonly NamedLocation[]): FilaDeParada[] {
  const ordenDe = new Map(entrada.ordenes.map((o) => [o.id, o]));
  const nombreDe = new Map(entrada.choferes.map((c) => [c.id, c.nombre]));
  const lugar = (p: Punto): string | null => (p.startsWith("tienda:") ? tiendas.find((s) => puntoDeTienda(s.name) === p)?.name ?? null : null);
  return plan.rutas.flatMap((r) => r.paradas.map((p, seq): FilaDeParada => {
    const o = ordenDe.get(ordenDeLaParte(p.orden));
    const ventana = p.tipo === "D" ? o?.ventana ?? null : null;
    return {
      driver_id: r.chofer, driver_name: nombreDe.get(r.chofer) ?? "", seq, kind: p.tipo, delivery_id: ordenDeLaParte(p.orden), order_ref: p.orden,
      label: p.etiqueta, visit: p.visita, place: lugar(p.punto), lat: puntos[p.punto]?.lat ?? null, lng: puntos[p.punto]?.lng ?? null,
      window_start: ventana?.[0] ?? null, window_end: ventana?.[1] ?? null, is_hard: p.tipo === "D" && !!o?.estrecha,
      eta: p.llegada, etd: p.salida, wait_min: p.esperaMin, service_min: p.servicioMin, late_min: p.tardeMin, load_after: p.cargaAlSalir,
      leg_minutes: p.tramoMin, leg_miles: p.tramoMillas, pinned: p.fijada,
    };
  }));
}
