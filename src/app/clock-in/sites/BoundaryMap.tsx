"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

type LatLng = { lat: number; lng: number };

export default function BoundaryMap({
  points,
  onAdd,
  center = null,
  focus = null,
  single = false,
}: {
  points: LatLng[];
  onAdd: (p: LatLng) => void;
  center?: LatLng | null; // center the map here (the site being edited)
  focus?: LatLng | null; // recenter here when it changes (address search result)
  single?: boolean; // circle mode: one marker, no polygon
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<{ L: typeof import("leaflet"); map: import("leaflet").Map } | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;

  // Init the map once.
  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | undefined;
    (async () => {
      const mod = await import("leaflet");
      const L = (mod as unknown as { default?: typeof import("leaflet") }).default ?? mod;
      if (cancelled || !containerRef.current) return;
      // Prefer the site being edited (center), then any existing points, else RGV.
      const start = center ?? points[0] ?? { lat: 26.2, lng: -98.23 };
      map = L.map(containerRef.current).setView([start.lat, start.lng], center || points.length ? 19 : 17);
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 21, attribution: "Imagery © Esri" },
      ).addTo(map);
      map.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        onAddRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
      ctxRef.current = { L, map };
      // Fit to an existing drawn outline if there is one.
      if (points.length >= 2) {
        map.fitBounds(points.map((p) => [p.lat, p.lng] as [number, number]), { padding: [30, 30] });
      } else if (!center && points.length === 0 && navigator.geolocation) {
        // Only for a brand-new site with no known location: use the owner's GPS.
        navigator.geolocation.getCurrentPosition(
          (pos) => map?.setView([pos.coords.latitude, pos.coords.longitude], 19),
          () => {},
          { enableHighAccuracy: true, timeout: 8000 },
        );
      }
      // Leaflet sometimes needs a nudge to size correctly after mount.
      setTimeout(() => map?.invalidateSize(), 200);
    })();
    return () => {
      cancelled = true;
      map?.remove();
      ctxRef.current = null;
    };
  }, []);

  // Recenter when an address search resolves to a new location.
  useEffect(() => {
    if (!focus) return;
    ctxRef.current?.map.setView([focus.lat, focus.lng], 19);
  }, [focus]);

  // Redraw markers + polygon when points change.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { L, map } = ctx;
    layerRef.current?.remove();
    const group = L.layerGroup();
    if (!single && points.length >= 2) {
      L.polygon(
        points.map((p) => [p.lat, p.lng] as [number, number]),
        { color: "#059669", weight: 2, fillOpacity: 0.2 },
      ).addTo(group);
    }
    points.forEach((p) => {
      L.circleMarker([p.lat, p.lng], {
        radius: 6,
        color: "#059669",
        fillColor: "#ffffff",
        fillOpacity: 1,
        weight: 2,
      }).addTo(group);
    });
    group.addTo(map);
    layerRef.current = group;
  }, [points]);

  return (
    <div
      ref={containerRef}
      className="h-72 w-full rounded-xl overflow-hidden border border-zinc-300 dark:border-zinc-700 z-0"
    />
  );
}
