import { unavailableDriverNames } from "@/lib/dispatch";
import { cacheEnMemoria } from "@/lib/route-times/tiempos";
import { proveedorEstimado } from "@/lib/route-times/proveedores";
import type { Delivery, Profile, Settings } from "@/lib/types";
import { BUSINESS_TZ } from "@/lib/utils";
import { ajustesDelDemo, repartoDelDia, type DiaParaElReparto, type PeticionDeReparto, type RespuestaDelReparto } from "./reparto";

/**
 * Quién reparte para la pantalla (D-NEXT): el servidor (`/api/route-plan/reparto`), o —en el demo, que no tiene base ni
 * servidor con sesión— el MISMO `repartoDelDia` en el navegador, con los datos que la pantalla ya tiene, la tienda del
 * perfil como base (`ajustesDelDemo`) y la estimación en línea recta. En el demo no sale nada de la máquina.
 */

export async function pideAlServidor(p: PeticionDeReparto, fetchFn: typeof fetch = fetch): Promise<RespuestaDelReparto> {
  const res = await fetchFn("/api/route-plan/reparto", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: p.fecha, order_ids: p.ordenes, drivers: p.choferes }),
  });
  const data = (await res.json().catch(() => ({}))) as RespuestaDelReparto & { error?: string };
  if (!res.ok) throw new Error(data.error || `Auto-assign failed (${res.status})`);
  return data;
}

export interface DatosDelNavegador {
  deliveries: readonly Delivery[];
  users: readonly Profile[];
  settings: Settings;
  availability: readonly { driver_id: string; start_date: string; end_date: string }[];
  /** Las rutas 🔒 de ese día, como las lee la pantalla (`rutas-bloqueadas.ts`). */
  bloqueadas: (fecha: string) => readonly string[];
}

/** Las tiendas del demo no traen punto (`demo-data.ts`), y sin punto el motor no tiene de dónde sacar a nadie: el centro
 *  de cada ciudad, solo aquí y solo para una tienda que no tenga el suyo. */
export const PUNTOS_DEL_DEMO: Readonly<Record<string, { lat: number; lng: number }>> = {
  Brownsville: { lat: 25.93, lng: -97.49 }, Weslaco: { lat: 26.16, lng: -97.99 }, Pharr: { lat: 26.19, lng: -98.18 },
  McAllen: { lat: 26.21, lng: -98.23 }, Mission: { lat: 26.21, lng: -98.32 }, Edinburg: { lat: 26.3, lng: -98.16 },
};

export function pideEnElNavegador(p: PeticionDeReparto, d: DatosDelNavegador): Promise<RespuestaDelReparto> {
  const nombrePorId = new Map(d.users.map((u) => [u.id, u.full_name]));
  const stores = (d.settings.stores ?? []).map((s) => (s.lat != null && s.lng != null ? s : { ...s, ...PUNTOS_DEL_DEMO[s.name] }));
  const dia: DiaParaElReparto = {
    ordenes: d.deliveries.filter((o) => o.delivery_date === p.fecha) as unknown as DiaParaElReparto["ordenes"],
    choferes: d.users,
    ajustesDeChofer: ajustesDelDemo(d.users),
    settings: { ...d.settings, stores },
    noDisponibles: [...unavailableDriverNames([...d.availability], nombrePorId, p.fecha)],
    bloqueadas: d.bloqueadas(p.fecha),
  };
  return repartoDelDia(dia, p, BUSINESS_TZ, { cache: cacheEnMemoria(), proveedores: [proveedorEstimado()], ahoraISO: new Date().toISOString() });
}

/** El `pide` de `repartirConElMotor`: con base, el servidor; en el demo (`NEXT_PUBLIC_LOCAL_MODE`), el navegador. */
export const pideElReparto = (sinBase: boolean, datos: () => DatosDelNavegador) =>
  (p: PeticionDeReparto): Promise<RespuestaDelReparto> => (sinBase ? pideEnElNavegador(p, datos()) : pideAlServidor(p));
