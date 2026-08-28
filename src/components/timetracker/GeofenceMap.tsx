"use client";

import { useEffect, useRef, useState } from "react";
import { googleMapsEnabled, loadGoogleMaps } from "@/lib/google-maps-loader";

export type Fence = {
  id: string;
  name: string;
  active: boolean;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  padding_meters: number | null;
  boundary: { lat: number; lng: number }[] | null;
};

/**
 * Las geocercas de todas las tiendas, de una vez y de solo lectura.
 *
 * **Google Maps, que es lo que usa el resto de la app.** Fichaje dibuja con Leaflet sobre
 * imágenes de Esri porque llegó así de su repo de origen; el hub, el ERP y las entregas
 * llevan Google desde siempre. Para una vista nueva no había razón para heredar la
 * excepción, y además reutiliza el cargador compartido — un solo script por página, que es
 * lo que evita pagar dos veces la misma carga.
 *
 * No es el mapa de fichaje reutilizado, y la diferencia es de fondo: aquel es un EDITOR de
 * UNA geocerca —cada clic añade un vértice— y aquí hacen falta las seis a la vez sin que un
 * clic despistado mueva nada. Un editor puesto en modo lectura acaba siendo un editor con
 * un `if`, y ese `if` se rompe el día que alguien toca el editor.
 *
 * Si no hay clave de navegador configurada, se dice en vez de enseñar un rectángulo gris:
 * un mapa que no carga y un mapa sin datos se ven igual, y el primero se arregla poniendo
 * una variable de entorno.
 *
 * Las inactivas se dibujan igual, en gris: una geocerca apagada sigue explicando por qué los
 * fichajes de esa tienda salen "fuera del sitio", y esconderla convierte eso en un misterio.
 */
export function GeofenceMap({ fences, height = 320 }: { fences: Fence[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!googleMapsEnabled()) {
      setErr("Google Maps is not configured (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY).");
      return;
    }
    let cancelled = false;
    let shapes: { setMap: (m: google.maps.Map | null) => void }[] = [];

    (async () => {
      let maps: typeof google.maps;
      try {
        maps = await loadGoogleMaps();
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Google Maps failed to load.");
        return;
      }
      if (cancelled || !box.current) return;

      const map = new maps.Map(box.current, {
        mapTypeId: "hybrid", // satélite con nombres de calle: una geocerca se juzga contra el edificio
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "cooperative", // la rueda hace scroll de la página salvo con Ctrl
      });

      const bounds = new maps.LatLngBounds();
      let algo = false;

      for (const f of fences) {
        const color = f.active ? "#22c55e" : "#9aa6b8";
        const base = { strokeColor: color, strokeWeight: 2, fillColor: color, fillOpacity: f.active ? 0.18 : 0.08, clickable: false };
        if (f.boundary && f.boundary.length >= 3) {
          const path = f.boundary.map((p) => ({ lat: p.lat, lng: p.lng }));
          const poly = new maps.Polygon({ ...base, paths: path, map });
          path.forEach((p) => bounds.extend(p));
          shapes.push(poly);
          algo = true;
        } else if (f.latitude != null && f.longitude != null) {
          const center = { lat: f.latitude, lng: f.longitude };
          const circle = new maps.Circle({ ...base, center, radius: f.radius_meters ?? 100, map });
          const b = circle.getBounds();
          if (b) bounds.union(b);
          shapes.push(circle);
          algo = true;
        }
      }

      // Encuadra lo que haya. Sin geocercas, el Valle: no dejar el mapa en el Atlántico.
      if (algo && !bounds.isEmpty()) map.fitBounds(bounds, 24);
      else map.setCenter({ lat: 26.2, lng: -98.23 }), map.setZoom(10);
    })();

    return () => {
      cancelled = true;
      shapes.forEach((s) => s.setMap(null));
      shapes = [];
    };
  }, [fences]);

  if (err) {
    return (
      <div className="banner warn" style={{ marginTop: 0 }}>
        {err}
      </div>
    );
  }

  return (
    <div
      ref={box}
      style={{ height, width: "100%", borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }}
    />
  );
}
