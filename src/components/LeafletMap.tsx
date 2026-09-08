"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMapInstance, Marker, Polyline, Polygon as LeafletPolygon, LatLng } from "leaflet";
import { colorZona, ESTILO_ZONA } from "@/lib/delivery-zone";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type L = any;

/** Shift a polyline sideways by `d` screen pixels (perpendicular to its
 * direction) so parallel routes on the same road sit side by side. Computed
 * in pixel space, so the gap stays constant as you zoom. */
function offsetLatLngs(L: L, map: LeafletMapInstance, base: [number, number][], d: number): LatLng[] {
  if (!d) return base.map((p) => L.latLng(p[0], p[1]));
  const pts = base.map((p) => map.latLngToLayerPoint(L.latLng(p[0], p[1])));
  const out: LatLng[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    let nx = 0, ny = 0;
    if (prev) { const dx = cur.x - prev.x, dy = cur.y - prev.y; const len = Math.hypot(dx, dy) || 1; nx += -dy / len; ny += dx / len; }
    if (next) { const dx = next.x - cur.x, dy = next.y - cur.y; const len = Math.hypot(dx, dy) || 1; nx += -dy / len; ny += dx / len; }
    const nlen = Math.hypot(nx, ny) || 1;
    out.push(map.layerPointToLatLng(L.point(cur.x + (nx / nlen) * d, cur.y + (ny / nlen) * d)));
  }
  return out;
}

// ============================================================
// Thin wrapper around Leaflet (free OpenStreetMap tiles, no API key) — used
// by the dispatch map (color-coded points) and the "drop an exact pin"
// picker in the order form. Leaflet touches the DOM directly, so it's only
// ever imported inside useEffect (client-only, never during SSR).
// ============================================================

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  color: string;
  label: string;
  /** Shown inside the marker itself (e.g. a route stop number), not just on
   * hover — used by the route planner so a driver's stop order is visible
   * at a glance. Omit for a plain dot (the default everywhere else). */
  badge?: string;
  /** Faded back (low opacity) — used to push everything that isn't the
   * currently-focused driver into the background. */
  dimmed?: boolean;
}

/** A store / branch location, drawn as a big red point that's always visible
 * on top of everything else — the fixed landmarks the fleet works around. */
export interface StoreMarker {
  name: string;
  lat: number;
  lng: number;
}

/** A driver's live position, drawn as a moving truck marker on top of
 * everything else with a halo showing how precise the fix is. */
export interface LiveDriver {
  driver: string;
  lat: number;
  lng: number;
  color: string;
  /** Reported accuracy in metres — drawn as a circle so a vague fix reads as
   * vague instead of looking pin-sharp. */
  accuracy_m?: number | null;
  /** Minutes since the fix; a stale position is faded. */
  ageMin?: number;
  label?: string;
}

/** A traced route — e.g. one driver's optimized stop-to-stop path. */
export interface MapLine {
  id: string;
  color: string;
  /** [lat, lng] pairs, in driving order, following actual roads. */
  positions: [number, number][];
  /** Dashed rendering — used for the empty return-to-pickup leg and for
   * simulated/preview routes, so they read as tentative next to solid runs. */
  dashed?: boolean;
  /** Faded + thinned, so the focused route stands out over the rest. */
  dimmed?: boolean;
  /** Sideways pixel offset, so parallel routes on one road sit side by side. */
  offset?: number;
}

export function LeafletMap({
  points = [],
  zone,
  lines = [],
  stores = [],
  liveDrivers = [],
  onPointClick,
  onLineClick,
  fitTo,
  center,
  zoom = 11,
  pickable = false,
  onPick,
  pickedPoint,
  height = 420,
}: {
  points?: MapPoint[];
  /** Contorno de la zona local, pintado en verde bajo todo lo demás (D-219). Opcional: los
   *  mapas que no la pasan quedan exactamente igual. */
  zone?: { lat: number; lng: number }[];
  /** Route traces drawn under the pins (e.g. per-driver optimized paths). */
  lines?: MapLine[];
  /** Store/branch locations — always drawn as big red points on top. */
  stores?: StoreMarker[];
  /** Drivers currently on shift, drawn where their phone last reported. */
  liveDrivers?: LiveDriver[];
  onPointClick?: (id: string) => void;
  /** Click a traced route — used to focus that route's driver. */
  onLineClick?: (id: string) => void;
  /** Coordinates the map should frame; refits whenever this set changes. */
  fitTo?: [number, number][];
  center?: [number, number];
  zoom?: number;
  /** Click-to-place-a-pin mode (used by the manual location picker). */
  pickable?: boolean;
  onPick?: (lat: number, lng: number) => void;
  /** The currently-picked point, shown as its own marker in pickable mode. */
  pickedPoint?: [number, number] | null;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMapInstance | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const storeMarkersRef = useRef<Marker[]>([]);
  // Truck markers + accuracy halos, cleared and redrawn as fixes arrive.
  const liveLayerRef = useRef<{ remove: () => void }[]>([]);
  const linesRef = useRef<Polyline[]>([]);
  const zoneRef = useRef<LeafletPolygon | null>(null);
  // Polylines that need their sideways offset recomputed whenever the map is
  // zoomed/reset (the offset is in pixels, the stored path is in lat/lng).
  const offsetLinesRef = useRef<{ poly: Polyline; hit: Polyline; base: [number, number][]; offset: number }[]>([]);
  const pickMarkerRef = useRef<Marker | null>(null);
  const hoverMarkerRef = useRef<Marker | null>(null);
  const fitSigRef = useRef<string>("");
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onClickRef = useRef(onPointClick);
  onClickRef.current = onPointClick;
  const onLineClickRef = useRef(onLineClick);
  onLineClickRef.current = onLineClick;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: LeafletMapInstance | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;
      const fallback: [number, number] = [26.2034, -98.2300]; // Rio Grande Valley, TX
      const startCenter = center ?? (points[0] ? [points[0].lat, points[0].lng] as [number, number] : fallback);
      map = L.map(containerRef.current).setView(startCenter, zoom);
      // Free OpenStreetMap tiles (no billing). A Google-tiles proxy exists at
      // /api/map-tiles but is intentionally NOT used, to avoid Map Tiles API
      // charges — switch this URL to "/api/map-tiles/{z}/{x}/{y}" to enable it.
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;

      if (pickable) {
        // Hover shows a light preview of where the pin would land; a
        // right-click commits it. Two-handed but far less error-prone than
        // a plain left-click, which fires on every accidental click while
        // panning around to find the right spot.
        const previewIcon = L.divIcon({
          className: "",
          html: `<div style="font-size:28px;line-height:1;opacity:.45;transform:translate(-50%,-90%)">📍</div>`,
          iconSize: [0, 0],
        });
        map.on("mousemove", (e: { latlng: { lat: number; lng: number } }) => {
          if (hoverMarkerRef.current) hoverMarkerRef.current.setLatLng(e.latlng);
          else if (mapRef.current) hoverMarkerRef.current = L.marker(e.latlng, { icon: previewIcon, interactive: false }).addTo(mapRef.current);
        });
        map.on("mouseout", () => {
          hoverMarkerRef.current?.remove();
          hoverMarkerRef.current = null;
        });
        map.on("contextmenu", (e: { latlng: { lat: number; lng: number }; originalEvent?: MouseEvent }) => {
          e.originalEvent?.preventDefault?.();
          onPickRef.current?.(e.latlng.lat, e.latlng.lng);
        });
      }

      // Re-apply each line's pixel offset after a zoom (pixel↔latlng scale
      // changes), so parallel routes stay side by side at every zoom.
      map.on("zoomend", () => {
        if (!mapRef.current) return;
        for (const it of offsetLinesRef.current) {
          const ll = offsetLatLngs(L, mapRef.current, it.base, it.offset);
          it.poly.setLatLngs(ll);
          it.hit.setLatLngs(ll);
        }
      });

      // Force a resize pass — Leaflet miscalculates tile bounds when its
      // container was hidden/zero-size at construction time (e.g. inside a
      // modal that just opened).
      setTimeout(() => map?.invalidateSize(), 50);
    })();
    return () => {
      cancelled = true;
      hoverMarkerRef.current?.remove();
      hoverMarkerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La zona local, en verde y por debajo de todo: al soltar el pin se ve de un vistazo si cae
  // dentro. Se dibuja en su propio efecto para que no dependa de `lines` ni al revés.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      zoneRef.current?.remove();
      zoneRef.current = null;
      if (!zone || zone.length < 3) return;
      const color = colorZona();
      zoneRef.current = L.polygon(zone.map((p) => [p.lat, p.lng] as [number, number]), {
        color,
        weight: ESTILO_ZONA.strokeWeight,
        opacity: ESTILO_ZONA.strokeOpacity,
        fillColor: color,
        fillOpacity: ESTILO_ZONA.fillOpacity,
        interactive: false,
      }).addTo(mapRef.current);
      zoneRef.current.bringToBack();
    })();
    return () => { cancelled = true; };
  }, [zone]);

  // Keep the traced routes in sync with `lines`. Drawn each time so they
  // stay underneath the pins (markers are re-added after this runs). Dimmed
  // routes are drawn first so focused ones paint on top of them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      linesRef.current.forEach((l) => l.remove());
      linesRef.current = [];
      offsetLinesRef.current = [];
      const ordered = [...lines].sort((a, b) => Number(!!b.dimmed) - Number(!!a.dimmed));
      for (const line of ordered) {
        if (line.positions.length < 2) continue;
        const off = line.offset ?? 0;
        const ll = offsetLatLngs(L, mapRef.current!, line.positions, off);
        // A fat invisible line under each makes routes easy to click even
        // where they're thin or overlapping.
        const hit = L.polyline(ll, { color: line.color, weight: 20, opacity: 0 }).addTo(mapRef.current!);
        const poly = L.polyline(ll, {
          color: line.color,
          weight: line.dimmed ? 4 : 6,
          opacity: line.dimmed ? 0.3 : 0.95,
          dashArray: line.dashed ? "3 9" : undefined,
        }).addTo(mapRef.current!);
        const fire = () => onLineClickRef.current?.(line.id);
        hit.on("click", fire);
        poly.on("click", fire);
        if (onLineClickRef.current) { hit.getElement()?.setAttribute("style", "cursor:pointer"); }
        linesRef.current.push(hit, poly);
        offsetLinesRef.current.push({ poly, hit, base: line.positions, offset: off });
      }
    })();
    return () => { cancelled = true; };
  }, [lines]);

  // Reframe the map whenever the caller's focus set changes (e.g. selecting
  // a driver zooms to just their stops).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current || !fitTo || fitTo.length === 0) return;
      const sig = JSON.stringify(fitTo);
      if (sig === fitSigRef.current) return;
      fitSigRef.current = sig;
      const bounds = L.latLngBounds(fitTo.map((c) => L.latLng(c[0], c[1])));
      mapRef.current.fitBounds(bounds, { padding: [45, 45], maxZoom: 14, animate: true });
    })();
    return () => { cancelled = true; };
  }, [fitTo]);

  // Keep the colored fleet markers in sync with `points`.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      // Dimmed pins first, so focused ones sit above them.
      const orderedPts = [...points].sort((a, b) => Number(!!b.dimmed) - Number(!!a.dimmed));
      for (const p of orderedPts) {
        // A badge (a stop number, or "P" for a pickup/base) → a proper
        // teardrop map pin with the label inside. No badge → a plain dot
        // (unassigned orders, and every other map in the app).
        const icon = p.badge
          ? L.divIcon({
              className: "",
              html: `<div style="width:30px;height:30px"><div style="width:26px;height:26px;transform:rotate(-45deg);background:${p.color};border:2px solid #fff;border-radius:50% 50% 50% 0;box-shadow:0 2px 5px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font-weight:800;font-size:12px;font-family:sans-serif;line-height:1">${p.badge}</span></div></div>`,
              iconSize: [30, 30],
              iconAnchor: [13, 28],
            })
          : L.divIcon({
              className: "",
              html: `<div style="width:16px;height:16px;border-radius:50%;background:${p.color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`,
              iconSize: [16, 16],
              iconAnchor: [8, 8],
            });
        const marker = L.marker([p.lat, p.lng], { icon, opacity: p.dimmed ? 0.35 : 1, zIndexOffset: p.dimmed ? 0 : 500 }).addTo(mapRef.current!);
        marker.bindTooltip(p.label);
        marker.on("click", () => onClickRef.current?.(p.id));
        markersRef.current.push(marker);
      }
    })();
    return () => { cancelled = true; };
  }, [points]);

  // Store/branch markers: big red points, always drawn on top of the fleet
  // pins and never dimmed — the fixed landmarks the whole map is built around.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      storeMarkersRef.current.forEach((m) => m.remove());
      storeMarkersRef.current = [];
      for (const s of stores) {
        if (s.lat == null || s.lng == null) continue;
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:24px;height:24px;border-radius:50%;background:#e11414;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.55)"></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const marker = L.marker([s.lat, s.lng], { icon, zIndexOffset: 1000, interactive: true }).addTo(mapRef.current!);
        marker.bindTooltip(`🏬 ${s.name}`, { permanent: false, direction: "top" });
        storeMarkersRef.current.push(marker);
      }
    })();
    return () => { cancelled = true; };
  }, [stores]);

  // Live driver positions: a truck marker plus an accuracy halo, always on top
  // of the order pins. A fix that's gone stale is faded rather than removed —
  // "last seen here 20 min ago" is still useful, but shouldn't look current.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      liveLayerRef.current.forEach((m) => m.remove());
      liveLayerRef.current = [];
      for (const d of liveDrivers) {
        if (d.lat == null || d.lng == null) continue;
        // Grey once the fix goes stale: this is where the truck WAS, not where
        // it is. Matches the Google map so the two never disagree.
        const stale = (d.ageMin ?? 0) > 10;
        const STALE_GREY = "#8b95a3";
        const shade = stale ? STALE_GREY : d.color;
        const opacity = stale ? 0.75 : 1;
        if (d.accuracy_m && d.accuracy_m > 25) {
          const halo = L.circle([d.lat, d.lng], {
            radius: d.accuracy_m, color: shade, weight: 1,
            fillColor: shade, fillOpacity: stale ? 0.05 : 0.12, opacity: stale ? 0.25 : 0.5,
          }).addTo(mapRef.current!);
          liveLayerRef.current.push(halo);
        }
        const icon = L.divIcon({
          className: "",
          html:
            `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;` +
            `border-radius:50%;background:${shade};border:3px solid #fff;` +
            `box-shadow:0 2px 8px rgba(0,0,0,.5);font-size:16px;opacity:${opacity}">🚚</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        const marker = L.marker([d.lat, d.lng], { icon, zIndexOffset: 1500 }).addTo(mapRef.current!);
        marker.bindTooltip(d.label ?? d.driver, { direction: "top" });
        liveLayerRef.current.push(marker);
      }
    })();
    return () => { cancelled = true; };
  }, [liveDrivers]);

  // Keep the single "picked" marker in sync (manual pin picker mode).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      pickMarkerRef.current?.remove();
      pickMarkerRef.current = null;
      if (pickedPoint) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="font-size:28px;line-height:1;transform:translate(-50%,-90%)">📍</div>`,
          iconSize: [0, 0],
        });
        pickMarkerRef.current = L.marker(pickedPoint, { icon }).addTo(mapRef.current);
      }
    })();
    return () => { cancelled = true; };
  }, [pickedPoint]);

  return <div ref={containerRef} style={{ height, borderRadius: 12, border: "1px solid var(--line)" }} />;
}
