import { serviceMin } from "@/lib/trip-timing";
import { fechaEnZona } from "@/lib/route-plan/llegadas";
import { claveDePunto } from "@/lib/route-times/claves";
import { instanteLocalISO } from "@/lib/route-times/tiempos";
import { FACTOR_DE_RODEO, MILLAS_POR_HORA_ESTIMADAS, millasEnLineaRecta } from "@/lib/route-times/proveedores";
import { informeDelDia, type InformeDelDia, type OrdenDelDia, type PlanDeParada, type Toque, type TramoPlaneado } from "./dia";
import { eligeRastro, trazosParaElMapa, type LatLng, type PuntoDeRastro, type Rastro } from "./rastro";

/**
 * De las filas de la base a los días de cada chofer (D-907, «Reportes de choferes»). Sin base ni red: la ruta lee y esto
 * arma, para poder probarlo con las filas de una semana de verdad.
 */

export interface FilaDeEntrega {
  id: string; order_code: string | null; order_type: string | null; store: string | null; account: string | null;
  /** D-NEXT: el número de factura, lo que nombra la parada en el Recorrido (Roberto, logística). Opcional: las pruebas viejas no lo traen. */
  invoice_num?: string | null;
  pickup_name: string | null; delivery_name: string | null; assigned_driver: string | null; delivery_date: string | null; stage: string;
  route_seq: number | null; delivery_windows: string | null; pickup_duration: string | null; delivery_duration: string | null;
  delivery_lat: number | null; delivery_lng: number | null; pickup_point_lat: number | null; pickup_point_lng: number | null;
  /** OJO: `pickup_lat/lng` y `pod_lat/lng` son DÓNDE TOCÓ el chofer («recogida», «entregada»), no dónde está la parada. */
  pickup_lat: number | null; pickup_lng: number | null; pod_lat: number | null; pod_lng: number | null;
  pickup_gps_at: string | null; pod_delivered_at: string | null;
}
export interface FilaDeEvento { delivery_id: string; kind: string; created_by: string | null; created_at: string }
export interface FilaDeEta { delivery_id: string; plan_date: string; kind: "P" | "D"; eta: string; first_eta?: string | null; plan_at?: string | null; created_at?: string | null }
export interface FilaDeTelefono { driver_id: string; lat: number; lng: number; accuracy_m: number | null; speed_mps?: number | null; recorded_at: string }
/** El rastro del camión que un chofer llevó un día (ya resuelto quién llevaba cuál). */
export interface RastroDeCamion { choferId: string; fecha: string; imei: string; nombre: string | null; puntos: PuntoDeRastro[] }

export interface DatosCrudos {
  zona: string;
  entregas: readonly FilaDeEntrega[];
  eventos: readonly FilaDeEvento[];
  etas: readonly FilaDeEta[];
  choferes: readonly { id: string; full_name: string }[];
  tiendas: readonly { name: string; lat: number; lng: number }[];
  telefono: readonly FilaDeTelefono[];
  camiones: readonly RastroDeCamion[];
  pausas: readonly { driver_id: string; empezo_at: string; termino_at: string | null }[];
  /** Tramos de la caché de tiempos del planificador: clave `origen|destino` (`claveDeTramo`). */
  tramos: ReadonlyMap<string, { millas: number; minutos: number }>;
}

export const claveDeTramo = (a: LatLng, b: LatLng): string => `${claveDePunto(a)}|${claveDePunto(b)}`;

/** Un punto del teléfono que dice ser peor que esto no prueba dónde estaba. */
export const PRECISION_MAX_M = 100;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const HORA = /^([0-2]\d):([0-5]\d)$/;
const minutos = (h: string | null | undefined): number | null => { const m = HORA.exec(h ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const ms = (iso: string | null | undefined): number | null => { const t = Date.parse(iso ?? ""); return Number.isFinite(t) ? t : null; };
const punto = (lat: number | null, lng: number | null): LatLng | null => (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null);

/** El tramo planeado entre dos sitios: de la caché del planificador; si no está, recta × 1,3 a 30 mph, y se dice. */
export function tramoPlaneado(tramos: DatosCrudos["tramos"]): (a: LatLng, b: LatLng) => TramoPlaneado {
  return (a, b) => {
    const t = tramos.get(claveDeTramo(a, b));
    if (t) return { millas: t.millas, minutos: t.minutos, estimado: false };
    const millas = millasEnLineaRecta(a, b) * FACTOR_DE_RODEO;
    return { millas, minutos: (millas / MILLAS_POR_HORA_ESTIMADAS) * 60, estimado: true };
  };
}

/** Dónde está la RECOGIDA de una orden: su pin propio si lo tiene; si no, la tienda de la que sale. */
export function sitioDeRecogida(d: FilaDeEntrega, tiendas: DatosCrudos["tiendas"]): (LatLng & { nombre: string }) | null {
  const pin = punto(d.pickup_point_lat, d.pickup_point_lng);
  const nombre = d.pickup_name?.trim() || d.store?.trim() || "";
  if (pin) return { ...pin, nombre: nombre || "Pickup" };
  const t = tiendas.find((s) => norm(s.name) === norm(d.pickup_name)) ?? tiendas.find((s) => norm(s.name) === norm(d.store));
  const p = t ? punto(t.lat, t.lng) : null;
  return p ? { ...p, nombre: t!.name } : null;
}

export interface DiaArmado { informe: InformeDelDia; rastro: Rastro | null }

/** Un día por chofer y fecha de entrega, ordenados por fecha y nombre. Las órdenes sin chofer conocido no entran. */
export function armaDias(c: DatosCrudos): DiaArmado[] {
  const idDe = new Map(c.choferes.map((x) => [norm(x.full_name), x.id]));

  // El último evento de cada clase por orden: cuándo, y QUIÉN.
  const ultimo = new Map<string, { t: number; por: string | null }>();
  for (const e of c.eventos) {
    const t = ms(e.created_at);
    if (t == null) continue;
    const k = `${e.delivery_id}|${e.kind}`, ya = ultimo.get(k);
    if (!ya || t > ya.t) ultimo.set(k, { t, por: e.created_by });
  }
  const etaDe = new Map<string, FilaDeEta>();
  for (const f of c.etas) etaDe.set(`${f.delivery_id}|${f.plan_date}|${f.kind}`, f);

  const grupos = new Map<string, { fecha: string; chofer: string; choferId: string | null; filas: FilaDeEntrega[] }>();
  for (const d of c.entregas) {
    const nombre = d.assigned_driver?.trim();
    if (!nombre || !d.delivery_date || d.stage === "canceled") continue;
    const k = `${d.delivery_date}|${norm(nombre)}`;
    const g = grupos.get(k) ?? { fecha: d.delivery_date, chofer: nombre, choferId: idDe.get(norm(nombre)) ?? null, filas: [] };
    g.filas.push(d);
    grupos.set(k, g);
  }

  const tramo = tramoPlaneado(c.tramos);
  const dias: DiaArmado[] = [];
  for (const g of grupos.values()) {
    const ini = ms(instanteLocalISO(g.fecha, 0, c.zona));
    if (ini == null) continue;
    const fin = ini + 26 * 3_600_000;   // el día local y dos horas más (el cambio de hora, y quien cierra tarde)
    const instante = (min: number) => ms(instanteLocalISO(g.fecha, Math.max(0, Math.min(1439, Math.round(min))), c.zona)) ?? ini + min * 60_000;
    const enElDia = (t: number) => t >= ini && t < ini + 24 * 3_600_000;

    const ordenes: OrdenDelDia[] = g.filas.map((d) => {
      const toque = (clase: string, sello: string | null, lat: number | null, lng: number | null): Toque | null => {
        const ev = ultimo.get(`${d.id}|${clase}`);
        const t = ms(sello) ?? ev?.t ?? null;
        if (t == null) return null;
        return { t, porElChofer: !!ev?.por && !!g.choferId && ev.por === g.choferId, lat, lng };
      };
      const plan = (tipo: "P" | "D"): PlanDeParada | null => {
        const f = etaDe.get(`${d.id}|${g.fecha}|${tipo}`);
        const eta = minutos(f?.eta);
        if (!f || eta == null) return null;
        return { eta, primera: minutos(f.first_eta) ?? (f.plan_at ? null : eta), apuntadaEn: ms(f.created_at), rehechaEn: ms(f.plan_at) };
      };
      const recogio = toque("picked_up", d.pickup_gps_at, d.pickup_lat, d.pickup_lng);
      const entrega = punto(d.delivery_lat, d.delivery_lng);
      const P = plan("P");
      return {
        id: d.id, codigo: d.order_code ?? d.id.slice(0, 6), factura: d.invoice_num?.trim() || null, tipo: d.order_type, tienda: d.store, cliente: d.account?.trim() || d.delivery_name?.trim() || null, etapa: d.stage,
        recogida: sitioDeRecogida(d, c.tiendas),
        entrega: entrega ? { ...entrega, nombre: d.delivery_name?.trim() || d.account?.trim() || "Delivery" } : null,
        // La recogida es de este día si se cargó este día, si tiene hora en el plan de este día, o si aún no se cargó.
        conRecogida: !!P || !recogio || enElDia(recogio.t),
        ventana: d.delivery_windows, minRecogida: serviceMin(d.pickup_duration), minEntrega: serviceMin(d.delivery_duration), ordenEnLista: d.route_seq,
        toques: {
          llegoARecoger: toque("arrived_pickup", null, null, null), recogio,
          llegoAEntregar: toque("arrived_delivery", null, null, null), entrego: toque("delivered", d.pod_delivered_at, d.pod_lat, d.pod_lng),
        },
        plan: { P, D: plan("D") },
      };
    });

    const camion = g.choferId ? c.camiones.find((x) => x.choferId === g.choferId && x.fecha === g.fecha) : undefined;
    const telefono: PuntoDeRastro[] = g.choferId
      ? c.telefono.filter((p) => p.driver_id === g.choferId && (p.accuracy_m == null || p.accuracy_m <= PRECISION_MAX_M))
          .map((p) => ({ t: Date.parse(p.recorded_at), lat: p.lat, lng: p.lng, mph: p.speed_mps != null ? p.speed_mps * 2.23694 : null }))
          .filter((p) => p.t >= ini && p.t < fin && fechaEnZona(new Date(p.t).toISOString(), c.zona) === g.fecha)
      : [];
    const rastro = eligeRastro(camion?.puntos.filter((p) => p.t >= ini && p.t < ini + 24 * 3_600_000), telefono);
    const pausas = c.pausas.filter((p) => p.driver_id === g.choferId).flatMap((p) => { const a = ms(p.empezo_at), b = ms(p.termino_at); return a != null && b != null && b > a ? [{ desde: a, hasta: b }] : []; });

    dias.push({
      rastro,
      informe: informeDelDia({ fecha: g.fecha, zona: c.zona, choferId: g.choferId, chofer: g.chofer, ordenes, rastro, camion: camion?.nombre ?? null, tiendas: c.tiendas, pausas, tramo, instante }),
    });
  }
  return dias.sort((a, b) => a.informe.fecha.localeCompare(b.informe.fecha) || a.informe.chofer.localeCompare(b.informe.chofer));
}

/** Todos los sitios (recogidas y entregas) de las órdenes, para pedir a la caché sus tramos. */
export function sitiosDeLasOrdenes(entregas: readonly FilaDeEntrega[], tiendas: DatosCrudos["tiendas"]): string[] {
  const claves = new Set<string>();
  for (const d of entregas) {
    const p = sitioDeRecogida(d, tiendas), e = punto(d.delivery_lat, d.delivery_lng);
    if (p) claves.add(claveDePunto(p));
    if (e) claves.add(claveDePunto(e));
  }
  return [...claves];
}

/** Lo que el mapa del día necesita además del informe: el rastro en trozos y la línea del plan (sitios en su orden). */
export function mapaDelDia(d: DiaArmado): { trazos: [number, number][][]; plan: [number, number][] } {
  const plan: [number, number][] = [];
  for (const p of d.informe.paradas.filter((x) => x.puestoPlan != null && x.lat != null && x.lng != null).sort((a, b) => a.puestoPlan! - b.puestoPlan!)) {
    const prev = plan[plan.length - 1];
    if (!prev || prev[0] !== p.lat || prev[1] !== p.lng) plan.push([p.lat!, p.lng!]);
  }
  return { trazos: d.rastro ? trazosParaElMapa(d.rastro) : [], plan };
}
