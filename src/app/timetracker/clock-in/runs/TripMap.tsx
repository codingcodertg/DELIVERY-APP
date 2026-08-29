"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type MapPoint = { lat: number; lng: number; kind: "start" | "stop" | "end"; label?: string };

// A per-trip mini-map: plots start → stops → end as pins joined by a line, so a
// manager can see the shape of the day. Mounts Leaflet only when opened (keeps a
// week of trips from spinning up dozens of maps at once). Read-only.
export default function TripMap({
  points,
  label,
  hideLabel = "Hide map",
}: {
  points: MapPoint[];
  label: string;
  hideLabel?: string;
}) {
  const [shown, setShown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shown) return;
    let cancelled = false;
    let map: import("leaflet").Map | undefined;
    (async () => {
      const mod = await import("leaflet");
      const L = (mod as unknown as { default?: typeof import("leaflet") }).default ?? mod;
      if (cancelled || !containerRef.current) return;
      map = L.map(containerRef.current, { scrollWheelZoom: false });
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 21, attribution: "Imagery © Esri" },
      ).addTo(map);

      const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);
      if (latlngs.length >= 2) {
        L.polyline(latlngs, { color: "#059669", weight: 3, opacity: 0.85 }).addTo(map);
      }
      points.forEach((p, i) => {
        const color = p.kind === "start" ? "#059669" : p.kind === "end" ? "#dc2626" : "#f59e0b";
        const tip = p.label || (p.kind === "start" ? "Start" : p.kind === "end" ? "End" : `Stop ${i}`);
        L.circleMarker([p.lat, p.lng], {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: color,
          fillOpacity: 1,
        })
          .addTo(map!)
          .bindTooltip(tip, { direction: "top" });
      });

      if (latlngs.length >= 2) map.fitBounds(latlngs, { padding: [28, 28] });
      else map.setView(latlngs[0], 16);
      setTimeout(() => map?.invalidateSize(), 150);
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [shown, points]);

  if (points.length === 0) return null;

  // Once open there was no way back — the map just stayed, pushing everything
  // below it off screen for the rest of the session.
  return shown ? (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => setShown(false)}
        className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:underline self-start"
      >
        ✕ {hideLabel}
      </button>
      <div
        ref={containerRef}
        className="h-56 w-full rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 z-0"
      />
    </div>
  ) : (
    <button onClick={() => setShown(true)} className="text-xs font-medium text-brand-600 hover:underline self-start">
      🗺️ {label}
    </button>
  );
}
