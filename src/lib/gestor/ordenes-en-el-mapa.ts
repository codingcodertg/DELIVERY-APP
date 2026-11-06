import { abanicoDeMarcas } from "../abanico-de-marcas";
import { colorDeChofer } from "../map-legend";

/**
 * Las órdenes de una lista del Gestor («Sin asignar» o «Todas»), en el mapa.
 *
 * Pedido de Roberto (ayuda 042c7dc1, 2026-11-06, en `/routes` mirando «Órdenes sin asignar»): «When looking at orders
 * would like option to see in map». El mapa grande del Gestor pinta el DÍA entero y sus rutas; este pinta exactamente las
 * filas que la lista enseña ahora —su chip, su búsqueda y sus filtros de columna—, un pin por orden.
 *
 * Dos reglas que viven aquí para poder probarlas sin montar la página:
 * - el color es el del chofer (`colorDeChofer`, el del mapa del Gestor) y el gris de siempre si no tiene;
 * - una orden sin coordenadas NO se cae en silencio: sale en `sinUbicacion`, que la pantalla cuenta y lista.
 */

/** Lo mínimo de una orden que hace falta para pintarla. `Delivery` lo cumple. */
export interface OrdenParaElMapa {
  id: string;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  assigned_driver?: string | null;
}

export interface PinDeOrden {
  id: string;
  lat: number;
  lng: number;
  color: string;
  label: string;
  offset?: { x: number; y: number };
}

export interface OrdenesEnElMapa<T> {
  puntos: PinDeOrden[];
  /** Las que la lista enseña y el mapa no puede pintar, en el orden de la lista. */
  sinUbicacion: T[];
  /** Para encuadrar el mapa en lo que se pinta. Vacío si no hay ningún pin. */
  encuadre: [number, number][];
}

/** Una coordenada que se puede pintar: número finito, dentro del rango, y no el (0, 0) de un dato vacío. */
export function tieneUbicacion(o: OrdenParaElMapa): boolean {
  const lat = o.delivery_lat, lng = o.delivery_lng;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(lat === 0 && lng === 0);
}

export function ordenesEnElMapa<T extends OrdenParaElMapa>(
  filas: readonly T[],
  opciones: { coloresDeChofer?: Record<string, string> | null; etiqueta: (o: T) => string },
): OrdenesEnElMapa<T> {
  const puntos: PinDeOrden[] = [];
  const sinUbicacion: T[] = [];
  const vistos = new Set<string>();
  for (const o of filas) {
    if (vistos.has(o.id)) continue;
    vistos.add(o.id);
    if (!tieneUbicacion(o)) { sinUbicacion.push(o); continue; }
    puntos.push({
      id: o.id,
      lat: o.delivery_lat as number,
      lng: o.delivery_lng as number,
      color: colorDeChofer(opciones.coloresDeChofer, o.assigned_driver),
      label: opciones.etiqueta(o),
    });
  }
  // Dos órdenes a la misma dirección se abren en abanico, como en el mapa del Gestor (D-367): si no, una tapa a la otra
  // y no se puede pulsar.
  const abanico = abanicoDeMarcas(puntos);
  const conAbanico = abanico.size ? puntos.map((p) => { const d = abanico.get(p.id); return d ? { ...p, offset: d } : p; }) : puntos;
  return { puntos: conAbanico, sinUbicacion, encuadre: conAbanico.map((p) => [p.lat, p.lng]) };
}
