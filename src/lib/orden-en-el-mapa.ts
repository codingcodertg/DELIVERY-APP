/**
 * «📍 Ver en el mapa» desde la ficha de una orden (Roberto, ayuda 62770f89, 12 nov: «Still need the option to be able to
 * open order on map»; antes, ayuda 042c7dc1 / D-895 dio el mapa de la TABLA, pero no el de UNA orden abierta).
 *
 * Regla pura: qué pines lleva el mapita de la ficha. El de la entrega (si tiene punto) y el de la recogida (su punto GPS o
 * la tienda de recogida, si es otro lugar), más el encuadre. Sin punto de entrega → `sinUbicacion` para avisar.
 */
import type { MapPoint, StoreMarker } from "@/components/LeafletMap";

export interface OrdenParaElMapa {
  id: string;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  delivery_address?: string | null;
  pickup_name?: string | null;
  store?: string | null;
  account?: string | null;
}

export interface MapaDeLaOrden {
  puntos: MapPoint[];
  encuadre: [number, number][];
  sinUbicacion: boolean;
}

const valido = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

export function mapaDeLaOrden(d: OrdenParaElMapa, tiendas: readonly StoreMarker[]): MapaDeLaOrden {
  const puntos: MapPoint[] = [];
  if (valido(d.delivery_lat) && valido(d.delivery_lng)) {
    puntos.push({ id: d.id, lat: d.delivery_lat, lng: d.delivery_lng, color: "#2456c9", label: d.delivery_address || d.account || "" });
  }
  const recoge = (d.pickup_name || d.store || "").trim();
  const tienda = recoge ? tiendas.find((t) => t.name === recoge) : undefined;
  const encuadre: [number, number][] = puntos.map((p) => [p.lat, p.lng]);
  if (tienda && valido(tienda.lat) && valido(tienda.lng)) encuadre.push([tienda.lat, tienda.lng]);
  return { puntos, encuadre, sinUbicacion: puntos.length === 0 };
}
