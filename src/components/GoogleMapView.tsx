"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, MAPS_MAP_ID } from "@/lib/google-maps-loader";
import { colorZona, ESTILO_ZONA } from "@/lib/delivery-zone";
import type { LiveDriver, MapLine, MapPoint, StoreMarker } from "@/components/LeafletMap";

// ============================================================
// The dispatch map, drawn with the Google Maps JavaScript API.
//
// Deliberately exposes the SAME props as LeafletMap so the Map and Routes
// pages are untouched by the switch — see MapView, which picks between them.
// Everything the pages rely on is reproduced here: order pins (plain dots and
// numbered route stops), traced routes with dashing and side-by-side offsets,
// store landmarks, live driver trucks with accuracy halos, framing, and the
// right-click pin picker used by the order form.
// ============================================================

const RGV_FALLBACK = { lat: 26.2034, lng: -98.2300 };   // Rio Grande Valley

/** Marker artwork as data-URI SVG. Classic markers take an icon rather than
 * arbitrary HTML, and an inline SVG keeps the look identical to the Leaflet
 * version without needing a Cloud-configured Map ID. */
function dotIcon(color: string, dimmed?: boolean): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">` +
    `<circle cx="9" cy="9" r="6" fill="${color}" stroke="#fff" stroke-width="2" opacity="${dimmed ? 0.45 : 1}"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function pinIcon(color: string, badge: string, dimmed?: boolean): string {
  // A teardrop with the stop number inside, matching the route planner's pins.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="38" viewBox="0 0 32 38">` +
    `<g opacity="${dimmed ? 0.45 : 1}">` +
    `<path d="M16 1C8.8 1 3 6.8 3 14c0 9.2 13 23 13 23s13-13.8 13-23C29 6.8 23.2 1 16 1z" ` +
    `fill="${color}" stroke="#fff" stroke-width="2.5"/>` +
    `<text x="16" y="19" text-anchor="middle" font-family="sans-serif" font-size="12" ` +
    `font-weight="700" fill="#fff">${badge.replace(/[<>&]/g, "")}</text></g></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function storeIcon(): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">` +
    `<circle cx="13" cy="13" r="9" fill="#e11414" stroke="#fff" stroke-width="3"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** Grey once the fix has gone stale — the truck's last known spot, not where
 * it is. Colour carries that, rather than a subtle fade nobody notices on a
 * busy map. */
const STALE_GREY = "#8b95a3";

function truckIcon(color: string, stale?: boolean): string {
  const fill = stale ? STALE_GREY : color;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">` +
    `<g opacity="${stale ? 0.75 : 1}">` +
    `<circle cx="18" cy="18" r="14" fill="${fill}" stroke="#fff" stroke-width="3"/>` +
    `<text x="18" y="24" text-anchor="middle" font-size="16"${stale ? ' opacity="0.65"' : ""}>🚚</text></g></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** Dashes for a polyline — Google draws these as repeated symbols. */
function dashSymbols(maps: typeof google.maps) {
  return [{
    icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
    offset: "0",
    repeat: "12px",
  }];
}

export function GoogleMapView({
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
  /** Contorno de la zona local, en verde y por debajo de todo (D-219). Opcional: sin él, este
   *  mapa se comporta exactamente igual que antes. */
  zone?: { lat: number; lng: number }[];
  lines?: MapLine[];
  stores?: StoreMarker[];
  liveDrivers?: LiveDriver[];
  onPointClick?: (id: string) => void;
  onLineClick?: (id: string) => void;
  fitTo?: [number, number][];
  center?: [number, number];
  zoom?: number;
  pickable?: boolean;
  onPick?: (lat: number, lng: number) => void;
  pickedPoint?: [number, number] | null;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const mapsRef = useRef<typeof google.maps | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const markersRef = useRef<google.maps.Marker[]>([]);
  const storeMarkersRef = useRef<google.maps.Marker[]>([]);
  const liveRef = useRef<(google.maps.Marker | google.maps.Circle)[]>([]);
  const linesRef = useRef<google.maps.Polyline[]>([]);
  const zoneRef = useRef<google.maps.Polygon | null>(null);
  const offsetLinesRef = useRef<{ poly: google.maps.Polyline; base: [number, number][]; offset: number }[]>([]);
  const pickMarkerRef = useRef<google.maps.Marker | null>(null);
  const hoverMarkerRef = useRef<google.maps.Marker | null>(null);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const fitSigRef = useRef("");

  // Callbacks change every render; keep them in refs so listeners bound once
  // stay current without rebuilding the map.
  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  const onClickRef = useRef(onPointClick); onClickRef.current = onPointClick;
  const onLineClickRef = useRef(onLineClick); onLineClickRef.current = onLineClick;

  // ---- Create the map once ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const maps = await loadGoogleMaps();
        if (cancelled || !containerRef.current) return;
        mapsRef.current = maps;
        const start = center ?? (points[0] ? { lat: points[0].lat, lng: points[0].lng } : RGV_FALLBACK);
        const map = new maps.Map(containerRef.current, {
          center: start instanceof Array ? { lat: start[0], lng: start[1] } : start,
          zoom,
          mapId: MAPS_MAP_ID || undefined,
          // Dispatch wants the map itself, not Google's chrome.
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        mapRef.current = map;
        infoRef.current = new maps.InfoWindow({ disableAutoPan: true });

        if (pickable) {
          // Hover previews where the pin would land; RIGHT-click commits it.
          // A plain left-click would fire on every stray click while panning
          // around looking for the spot.
          map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
            if (!e.latLng) return;
            if (hoverMarkerRef.current) hoverMarkerRef.current.setPosition(e.latLng);
            else {
              hoverMarkerRef.current = new maps.Marker({
                map, position: e.latLng, clickable: false,
                icon: {
                  url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
                    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><text x="2" y="24" font-size="24" opacity="0.45">📍</text></svg>`)}`,
                  anchor: new maps.Point(6, 28),
                },
              });
            }
          });
          map.addListener("mouseout", () => { hoverMarkerRef.current?.setMap(null); hoverMarkerRef.current = null; });
          map.addListener("rightclick", (e: google.maps.MapMouseEvent) => {
            if (e.latLng) onPickRef.current?.(e.latLng.lat(), e.latLng.lng());
          });
        }

        // Pixel offsets are recomputed per zoom, same as the Leaflet version.
        map.addListener("zoom_changed", () => reapplyOffsets());
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Shift a path sideways by `px` screen pixels, perpendicular to its
   * direction, so routes sharing a road sit beside each other instead of on
   * top. Computed in world coordinates scaled by zoom, so the gap looks
   * constant however far you zoom. */
  const offsetPath = (base: [number, number][], px: number): google.maps.LatLngLiteral[] => {
    const maps = mapsRef.current, map = mapRef.current;
    if (!maps || !map || !px) return base.map(([lat, lng]) => ({ lat, lng }));
    const projection = map.getProjection();
    if (!projection) return base.map(([lat, lng]) => ({ lat, lng }));
    const scale = Math.pow(2, map.getZoom() ?? 11);
    const pts = base.map(([lat, lng]) => {
      const p = projection.fromLatLngToPoint(new maps.LatLng(lat, lng))!;
      return { x: p.x * scale, y: p.y * scale };
    });
    const out: google.maps.LatLngLiteral[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
      let nx = 0, ny = 0;
      if (prev) { const dx = cur.x - prev.x, dy = cur.y - prev.y; const len = Math.hypot(dx, dy) || 1; nx += -dy / len; ny += dx / len; }
      if (next) { const dx = next.x - cur.x, dy = next.y - cur.y; const len = Math.hypot(dx, dy) || 1; nx += -dy / len; ny += dx / len; }
      const nlen = Math.hypot(nx, ny) || 1;
      const moved = new maps.Point((cur.x + (nx / nlen) * px) / scale, (cur.y + (ny / nlen) * px) / scale);
      const ll = projection.fromPointToLatLng(moved)!;
      out.push({ lat: ll.lat(), lng: ll.lng() });
    }
    return out;
  };

  const reapplyOffsets = () => {
    for (const it of offsetLinesRef.current) it.poly.setPath(offsetPath(it.base, it.offset));
  };

  // ---- Zona local ----
  // El mismo polígono verde que pinta el mapa de Leaflet, con la geometría y el color salidos del
  // mismo módulo: `MapView` elige uno u otro según haya llave de navegador, y la zona tiene que
  // verse igual por los dos caminos. `zIndex: 0` y `clickable: false` para que quede debajo y no
  // robe el clic derecho con el que se suelta el pin.
  useEffect(() => {
    const maps = mapsRef.current, map = mapRef.current;
    if (!ready || !maps || !map) return;
    zoneRef.current?.setMap(null);
    zoneRef.current = null;
    if (!zone || zone.length < 3) return;
    const color = colorZona();
    zoneRef.current = new maps.Polygon({
      map,
      paths: zone.map((p) => ({ lat: p.lat, lng: p.lng })),
      strokeColor: color,
      strokeWeight: ESTILO_ZONA.strokeWeight,
      strokeOpacity: ESTILO_ZONA.strokeOpacity,
      fillColor: color,
      fillOpacity: ESTILO_ZONA.fillOpacity,
      clickable: false,
      zIndex: 0,
    });
  }, [zone, ready]);

  // ---- Routes ----
  useEffect(() => {
    const maps = mapsRef.current, map = mapRef.current;
    if (!ready || !maps || !map) return;
    linesRef.current.forEach((l) => l.setMap(null));
    linesRef.current = [];
    offsetLinesRef.current = [];
    // Dimmed first so focused routes paint over them.
    const ordered = [...lines].sort((a, b) => Number(!!b.dimmed) - Number(!!a.dimmed));
    for (const line of ordered) {
      if (line.positions.length < 2) continue;
      const off = line.offset ?? 0;
      const poly = new maps.Polyline({
        map,
        path: offsetPath(line.positions, off),
        strokeColor: line.color,
        strokeWeight: line.dimmed ? 4 : 6,
        strokeOpacity: line.dashed ? 0 : (line.dimmed ? 0.3 : 0.95),
        icons: line.dashed ? dashSymbols(maps) : undefined,
        zIndex: line.dimmed ? 1 : 2,
      });
      if (onLineClickRef.current) {
        poly.addListener("click", () => onLineClickRef.current?.(line.id));
      }
      linesRef.current.push(poly);
      offsetLinesRef.current.push({ poly, base: line.positions, offset: off });
    }
  }, [lines, ready]);

  // ---- Order pins ----
  useEffect(() => {
    const maps = mapsRef.current, map = mapRef.current;
    if (!ready || !maps || !map) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    const ordered = [...points].sort((a, b) => Number(!!b.dimmed) - Number(!!a.dimmed));
    for (const p of ordered) {
      const marker = new maps.Marker({
        map,
        position: { lat: p.lat, lng: p.lng },
        title: p.label,
        zIndex: p.dimmed ? 10 : 500,
        icon: p.badge
          ? { url: pinIcon(p.color, p.badge, p.dimmed), anchor: new maps.Point(16, 36) }
          : { url: dotIcon(p.color, p.dimmed), anchor: new maps.Point(9, 9) },
      });
      marker.addListener("click", () => onClickRef.current?.(p.id));
      markersRef.current.push(marker);
    }
  }, [points, ready]);

  // ---- Store landmarks ----
  useEffect(() => {
    const maps = mapsRef.current, map = mapRef.current;
    if (!ready || !maps || !map) return;
    storeMarkersRef.current.forEach((m) => m.setMap(null));
    storeMarkersRef.current = [];
    for (const s of stores) {
      if (s.lat == null || s.lng == null) continue;
      storeMarkersRef.current.push(new maps.Marker({
        map,
        position: { lat: s.lat, lng: s.lng },
        title: `🏬 ${s.name}`,
        zIndex: 1000,
        icon: { url: storeIcon(), anchor: new maps.Point(13, 13) },
      }));
    }
  }, [stores, ready]);

  // ---- Live drivers ----
  useEffect(() => {
    const maps = mapsRef.current, map = mapRef.current;
    if (!ready || !maps || !map) return;
    liveRef.current.forEach((m) => m.setMap(null));
    liveRef.current = [];
    for (const d of liveDrivers) {
      if (d.lat == null || d.lng == null) continue;
      const stale = (d.ageMin ?? 0) > 10;
      if (d.accuracy_m && d.accuracy_m > 25) {
        liveRef.current.push(new maps.Circle({
          map, center: { lat: d.lat, lng: d.lng }, radius: d.accuracy_m,
          strokeColor: stale ? STALE_GREY : d.color, strokeWeight: 1, strokeOpacity: stale ? 0.25 : 0.5,
          fillColor: stale ? STALE_GREY : d.color, fillOpacity: stale ? 0.05 : 0.12, clickable: false,
        }));
      }
      liveRef.current.push(new maps.Marker({
        map,
        position: { lat: d.lat, lng: d.lng },
        title: d.label ?? d.driver,
        zIndex: 1500,
        icon: { url: truckIcon(d.color, stale), anchor: new maps.Point(18, 18) },
      }));
    }
  }, [liveDrivers, ready]);

  // ---- Framing ----
  useEffect(() => {
    const maps = mapsRef.current, map = mapRef.current;
    if (!ready || !maps || !map || !fitTo || fitTo.length === 0) return;
    const sig = JSON.stringify(fitTo);
    if (sig === fitSigRef.current) return;
    fitSigRef.current = sig;
    const bounds = new maps.LatLngBounds();
    for (const [lat, lng] of fitTo) bounds.extend({ lat, lng });
    map.fitBounds(bounds, 45);
    // fitBounds can zoom in absurdly far on a single point.
    const once = maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > 14) map.setZoom(14);
    });
    return () => maps.event.removeListener(once);
  }, [fitTo, ready]);

  // ---- Manual pin picker ----
  useEffect(() => {
    const maps = mapsRef.current, map = mapRef.current;
    if (!ready || !maps || !map) return;
    pickMarkerRef.current?.setMap(null);
    pickMarkerRef.current = null;
    if (pickedPoint) {
      pickMarkerRef.current = new maps.Marker({
        map,
        position: { lat: pickedPoint[0], lng: pickedPoint[1] },
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><text x="2" y="24" font-size="24">📍</text></svg>`)}`,
          anchor: new maps.Point(6, 28),
        },
      });
    }
  }, [pickedPoint, ready]);

  if (failed) {
    return (
      <div style={{ height, borderRadius: 12, border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, textAlign: "center", fontSize: 13.5 }}>
        No se pudo cargar Google Maps. Revisa que la llave del navegador permita este dominio.
      </div>
    );
  }

  return <div ref={containerRef} style={{ height, borderRadius: 12, border: "1px solid var(--line)", overflow: "hidden" }} />;
}
