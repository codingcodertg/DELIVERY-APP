import type { NamedLocation } from "@/lib/types";

/**
 * La tienda de Ajustes (con punto) que se llama `nombre`. Es LA regla de «esta tienda es un sitio del mapa»: la usa el motor
 * de rutas al armar su entrada (`entrada.ts`: una entrega a una tienda va al punto de la tienda, y la recogida también) y la
 * lista del Gestor al decidir si una descarga y una carga son la misma visita (`misma-visita.ts`). Sin mayúsculas ni
 * espacios de más. Una tienda sin `lat`/`lng` no cuenta como sitio: `null`.
 */
export function tiendaConPuntoDeAjustes(
  tiendas: readonly NamedLocation[], nombre: string | null | undefined,
): (NamedLocation & { lat: number; lng: number }) | null {
  const t = tiendas.find((s) => (s.name ?? "").trim().toLowerCase() === (nombre ?? "").trim().toLowerCase());
  return t && t.lat != null && t.lng != null ? { ...t, lat: t.lat, lng: t.lng } : null;
}
