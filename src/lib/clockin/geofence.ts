// Geofence math. Supports both polygon sites (property outline + padding) and
// legacy circle sites (center + radius). Runs server-side in the clock-in action.

export type LatLng = { lat: number; lng: number };

export type GeoSite = {
  id: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  boundary: LatLng[] | null;
  padding_meters: number | null;
};

const EARTH_R = 6371000; // meters
const GPS_BUFFER = 25; // circle sites get a small drift buffer

export function haversine(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const la1 = toRad(aLat);
  const la2 = toRad(bLat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(x)));
}

// Local planar projection (meters) around an origin — accurate at property scale.
function toXY(lat: number, lng: number, lat0: number, lng0: number) {
  return {
    x: (lng - lng0) * Math.cos((lat0 * Math.PI) / 180) * 111320,
    y: (lat - lat0) * 110540,
  };
}

export function pointInPolygon(lat: number, lng: number, poly: LatLng[]) {
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

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Shortest distance (m) from a point to a polygon's edges. */
export function distanceToPolygonMeters(lat: number, lng: number, poly: LatLng[]) {
  const lat0 = poly[0].lat;
  const lng0 = poly[0].lng;
  const p = toXY(lat, lng, lat0, lng0);
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = toXY(poly[i].lat, poly[i].lng, lat0, lng0);
    const b = toXY(poly[j].lat, poly[j].lng, lat0, lng0);
    min = Math.min(min, distToSegment(p.x, p.y, a.x, a.y, b.x, b.y));
  }
  return min;
}

export function matchSite(lat: number, lng: number, site: GeoSite): boolean {
  if (site.boundary && site.boundary.length >= 3) {
    if (pointInPolygon(lat, lng, site.boundary)) return true;
    return distanceToPolygonMeters(lat, lng, site.boundary) <= (site.padding_meters ?? 25);
  }
  return haversine(lat, lng, site.latitude, site.longitude) <= site.radius_meters + GPS_BUFFER;
}

/** Returns the id of the first matching site, or null. */
export function firstMatch(lat: number, lng: number, sites: GeoSite[]): string | null {
  for (const s of sites) if (matchSite(lat, lng, s)) return s.id;
  return null;
}
