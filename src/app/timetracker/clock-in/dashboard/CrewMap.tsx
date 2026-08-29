"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type CrewPoint = { lat: number; lng: number; label: string; stale: boolean };

// "Who's where" — one labeled pin per person on the clock now, at their
// last-known location (a recent stop, else their clock-in spot). Not live
// tracking: locations are only as fresh as the last punch/stop. Mounts Leaflet
// on demand so the dashboard stays light.
export default function CrewMap({ points, label }: { points: CrewPoint[]; label: string }) {
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
      points.forEach((p) => {
        L.circleMarker([p.lat, p.lng], {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: p.stale ? "#a1a1aa" : "#059669",
          fillOpacity: 1,
        })
          .addTo(map!)
          .bindTooltip(p.label, { permanent: true, direction: "top", className: "crew-tip" });
      });

      if (latlngs.length >= 2) map.fitBounds(latlngs, { padding: [40, 40] });
      else if (latlngs.length === 1) map.setView(latlngs[0], 15);
      setTimeout(() => map?.invalidateSize(), 150);
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [shown, points]);

  if (points.length === 0) return null;

  return shown ? (
    <div
      ref={containerRef}
      className="mt-3 h-64 w-full rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 z-0"
    />
  ) : (
    <button onClick={() => setShown(true)} className="text-xs font-medium text-brand-600 hover:underline">
      🗺️ {label}
    </button>
  );
}
