"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type CrewPoint = { lat: number; lng: number; label: string; offSite: boolean };

/**
 * Dónde está la cuadrilla ahora mismo (D-132).
 *
 * Es lo ÚNICO que Today's Crew respondía y ninguna pantalla de Time Tracker respondía todavía:
 * quién está dónde. El resto de aquella pantalla —quién está dentro, los fichajes de la semana,
 * las fotos— ya vive en Trabajando ahora, en Payroll y en Auditoría, así que portarla entera
 * habría sido duplicar tres pantallas para traerse un mapa.
 *
 * **No es seguimiento en vivo, y la pantalla lo dice.** Cada punto es donde esa persona FICHÓ,
 * no dónde está ahora: si salió a repartir, el punto se queda en la tienda. Dejar eso implícito
 * sería peor que no tener mapa — un mapa invita a creer que sigue a la gente.
 *
 * Se monta bajo demanda. Leaflet y su hoja de estilos pesan, y este mapa se mira de vez en
 * cuando; cargarlo siempre encarecería una pantalla que se deja abierta todo el día.
 */
export function CrewMap({ points }: { points: CrewPoint[] }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    let cancelado = false;
    let mapa: import("leaflet").Map | undefined;
    (async () => {
      const mod = await import("leaflet");
      const L = (mod as unknown as { default?: typeof import("leaflet") }).default ?? mod;
      if (cancelado || !caja.current) return;
      mapa = L.map(caja.current, { scrollWheelZoom: false });
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 21, attribution: "Imagery © Esri" },
      ).addTo(mapa);

      points.forEach((p) => {
        L.circleMarker([p.lat, p.lng], {
          radius: 8, color: "#ffffff", weight: 2,
          // Rojo el que fichó fuera del sitio: en un mapa, "fuera de la geocerca" es
          // precisamente lo que se viene a mirar.
          fillColor: p.offSite ? "#e5384a" : "#0a8f63",
          fillOpacity: 1,
        })
          .addTo(mapa!)
          .bindTooltip(p.label, { permanent: true, direction: "top" });
      });

      const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);
      if (latlngs.length === 1) mapa.setView(latlngs[0], 17);
      else if (latlngs.length > 1) mapa.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
      // Sin puntos no se centra en ningún sitio: el botón no se dibuja en ese caso.
    })();
    return () => { cancelado = true; mapa?.remove(); };
  }, [abierto, points]);

  if (points.length === 0) return null;

  return (
    <>
      <button className="btn-ghost btn-sm" onClick={() => setAbierto((v) => !v)} style={{ marginTop: 10 }}>
        {abierto ? "Hide map" : `🗺 Where they punched (${points.length})`}
      </button>
      {abierto && (
        <>
          <div
            ref={caja}
            style={{ height: 320, marginTop: 10, borderRadius: 12, overflow: "hidden", border: "1px solid var(--tt-line)" }}
          />
          <p className="small muted" style={{ marginTop: 6 }}>
            Each pin is where that person <strong>clocked in</strong> — not where they are now.
            Someone out on a delivery still shows at the store.
          </p>
        </>
      )}
    </>
  );
}
