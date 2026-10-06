import { blankDelivery } from "@/lib/blank-delivery";
import type { ParadaDelDia } from "@/lib/rutas-del-dia";
import type { Delivery } from "@/lib/types";
import { orderOwner } from "@/lib/utils";

/**
 * «Ruta de hoy» es el Gestor de Rutas en SOLO LECTURA (D-481, b). El dueño, 2026-10-06 (dictado, literal): «today srotue
 * is an exact duplicate of routes manager but without any actionable buttom or action».
 *
 * La pantalla es la misma (`routes/page.tsx` con `soloLectura`): las mismas tarjetas, la misma tabla de paradas, el mismo
 * mapa, Cuadrícula y Horario, el mismo filtro de chofer. Lo que cambia es de dónde salen las órdenes: el Gestor pinta lo que
 * esta persona ya lee (`deliveries`, su RLS); «Ruta de hoy» pinta las paradas de `useRutasDelDia` (D-467: con la migración
 * 160, las rutas ENTERAS de cualquier rol, con lo mínimo de cada parada; sin ella, lo que ya leía), y las completa con la
 * orden entera SOLO si esta persona ya la tiene (`legibles`). Una parada cuya orden no puede leer sale con lo mínimo: su ID,
 * su chofer, su puesto, su tienda, su ciudad, sus pallets, su ventana y su etapa; la factura, la cuenta, el contacto y la
 * dirección quedan vacíos («—»), porque no se leyeron.
 */
export function ordenesDeRutaDeHoy(paradas: readonly ParadaDelDia[], legibles: readonly Delivery[]): Delivery[] {
  const porId = new Map(legibles.map((d) => [d.id, d]));
  return paradas.map((p) => porId.get(p.id) ?? blankDelivery({
    id: p.id, order_no: p.order_no, order_code: p.order_code, order_suffix: p.order_suffix, stage: p.stage as Delivery["stage"],
    is_training: false, assigned_driver: p.assigned_driver, route_seq: p.route_seq, pickup_seq: p.pickup_seq, load_no: p.load_no,
    actual_pallets: p.actual_pallets, est_pallets: p.est_pallets, store: p.store, delivery_lat: p.delivery_lat, delivery_lng: p.delivery_lng,
    // La ciudad, y nada más de la dirección: `ciudadDeEntrega` de un solo trozo devuelve ese trozo.
    delivery_address: p.delivery_city || null,
    delivery_windows: p.delivery_windows, delivery_date: p.delivery_date, delivery_duration: p.delivery_duration, pickup_duration: p.pickup_duration,
    pod_delivered_at: p.pod_delivered_at, pickup_gps_at: p.pickup_gps_at,
  }));
}

/**
 * La orden ENTERA solo se abre si esta persona YA la puede leer (está entre las que le carga su RLS) y no es un vendedor
 * mirando la de otro: «solo ver, nada más» (D-467). La misma regla que tenía «Ruta de hoy» antes de ser el Gestor.
 */
export function ordenLegible(id: string, legibles: readonly Delivery[], me: { id: string; role: string } | null): Delivery | null {
  const d = legibles.find((x) => x.id === id);
  if (!d || !me) return null;
  return me.role !== "sales" || orderOwner(d) === me.id ? d : null;
}
