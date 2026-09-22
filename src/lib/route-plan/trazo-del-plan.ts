import { ordenDeLaParte } from "./publicar";

/**
 * Las coordenadas de la ruta PUBLICADA de un chofer, en el orden del plan (D-352), para pintarla por calles.
 *
 * El dueño, con una captura: «no tienen sentido los puntos: cuando selecciono el chofer debería mostrar las rutas que
 * él tiene». Los puntos P1/D1/D2 salían del plan publicado (D-334/D-335), pero la LÍNEA la trazaba el optimizador
 * viejo de la pantalla, que solo sabe de entregas y de un depósito adivinado por la dirección de recogida más
 * repetida: se veía P1 en una tienda y la línea empezaba en D1. Dos fuentes para un mismo dibujo.
 *
 * Esto devuelve lo que hay que pedirle al servicio de rutas **sin optimizar** (`optimize: false`, recorre las paradas
 * tal cual): cada P con el punto de su tienda, cada D con el punto de entrega de su orden. Una parada sin punto se
 * salta —la línea sigue por la siguiente— en vez de romper el trazo entero. Con menos de dos puntos no hay línea.
 */
export interface PuntoDelTrazo { id: string; lat: number; lng: number }

export function puntosDelTrazoPublicado(
  paradas: readonly { kind: "P" | "D"; order_ref: string; seq: number; place?: string | null }[],
  ordenes: readonly { id: string; delivery_lat?: number | null; delivery_lng?: number | null }[],
  tiendas: readonly { name: string; lat?: number | null; lng?: number | null }[],
): PuntoDelTrazo[] {
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const tienda = (nombre: string | null | undefined) =>
    tiendas.find((s) => s.name.trim().toLowerCase() === (nombre ?? "").trim().toLowerCase());
  const out: PuntoDelTrazo[] = [];
  for (const p of [...paradas].sort((a, b) => a.seq - b.seq)) {
    if (p.kind === "P") {
      const s = tienda(p.place);
      if (s?.lat != null && s.lng != null) out.push({ id: `P:${p.seq}`, lat: s.lat, lng: s.lng });
      continue;
    }
    const o = porId.get(ordenDeLaParte(p.order_ref));
    if (o?.delivery_lat != null && o.delivery_lng != null) out.push({ id: `D:${p.order_ref}`, lat: o.delivery_lat, lng: o.delivery_lng });
  }
  // Dos paradas seguidas en el mismo sitio (dos órdenes en la misma tienda) son un solo punto para el trazo.
  return out.filter((p, i) => i === 0 || p.lat !== out[i - 1].lat || p.lng !== out[i - 1].lng);
}
