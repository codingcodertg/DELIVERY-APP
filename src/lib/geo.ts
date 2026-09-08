// ============================================================
// One-shot GPS capture for delivery milestones (#4, "stamp" variant).
//
// Grabs the device's coordinates at the moment the driver presses Pick up /
// Mark delivered — no continuous tracking, so no battery drain and no
// background-tab problem.
//
// IMPORTANT: browsers only expose geolocation over HTTPS (localhost is exempt).
// On plain HTTP, or if the driver denies permission, this resolves to null —
// it must NEVER block the delivery from being recorded.
// ============================================================

export interface GeoStamp {
  lat: number;
  lng: number;
  accuracy: number | null;
  at: string;
}

/** True when the browser can actually give us a position (HTTPS or localhost). */
export function geoAvailable(): boolean {
  if (typeof window === "undefined" || !("geolocation" in navigator)) return false;
  return window.isSecureContext;
}

/**
 * Try to read the current position. Resolves to null on any failure
 * (insecure context, permission denied, timeout, no signal).
 */
export function captureLocation(timeoutMs = 8000): Promise<GeoStamp | null> {
  if (!geoAvailable()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: GeoStamp | null) => { if (!settled) { settled = true; resolve(v); } };
    // Hard backstop: never hang the delivery flow waiting on a GPS fix.
    const timer = setTimeout(() => done(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        done({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracy: pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null,
          at: new Date().toISOString(),
        });
      },
      () => { clearTimeout(timer); done(null); },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        // A fix from the last half-minute is fine for "where did this stop
        // happen" — the truck hasn't moved far. Demanding a brand-new one
        // (maximumAge: 0) made the phone wake the GPS chip and re-acquire on
        // every press, which is what made pickups and deliveries feel slow.
        // On shift the background service is already producing fixes, so this
        // almost always returns instantly.
        maximumAge: 30_000,
      },
    );
  });
}

/**
 * Position for a milestone the driver is waiting on.
 *
 * `immediate` settles fast — with whatever fix is already available, or null
 * if none arrives in `maxWaitMs`. Stamp the milestone with that and move on;
 * the driver came to press a button, not to watch a spinner.
 *
 * `eventual` is the real fix whenever it lands, so a caller that had to
 * proceed without one can patch the coordinates in afterwards. Nothing is
 * lost, and nothing is delayed.
 */
export function captureLocationSplit(maxWaitMs = 1200): {
  immediate: Promise<GeoStamp | null>;
  eventual: Promise<GeoStamp | null>;
} {
  const eventual = captureLocation();
  const immediate = Promise.race([
    eventual,
    new Promise<null>((r) => setTimeout(() => r(null), maxWaitMs)),
  ]);
  return { immediate, eventual };
}

/** Google Maps link for a captured point (used to review where a stop happened). */
export function mapLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export interface LatLng { lat: number; lng: number }

/**
 * ¿Cae el punto dentro del polígono? Trazado de rayo (par/impar), en grados.
 *
 * Vivía en `lib/clockin/geofence.ts`, que es de fichaje, y ahora lo necesita también la zona de
 * entrega. Se sube aquí —a la geometría neutral que ya usan Entregas y las analíticas— en vez de
 * copiarlo: dos copias de un par/impar es exactamente el tipo de duplicado que se descubre el día
 * que una de las dos arregla un borde y la otra no. `geofence.ts` lo reexporta, así que fichaje
 * no cambia una línea.
 *
 * A escala de una ciudad o una propiedad no hace falta proyectar: la diferencia contra un cálculo
 * geodésico está muy por debajo de la precisión de un GPS.
 */
export function pointInPolygon(lat: number, lng: number, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].lat;
    const xi = poly[i].lng;
    const yj = poly[j].lat;
    const xj = poly[j].lng;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Straight-line distance between two points, in metres (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}
