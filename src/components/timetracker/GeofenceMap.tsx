"use client";

import { useEffect, useRef, useState } from "react";
import { googleMapsEnabled, loadGoogleMaps, onMapsAuthFailure } from "@/lib/google-maps-loader";
import { estiloMarcador, type EstadoMarcador } from "@/lib/clockin/photo-map";

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
/** Un punto encima de las geocercas: dónde se tomó una foto. `label` va junto al marcador. */
export type MapPoint = { lat: number; lng: number; label: string; estado: EstadoMarcador };

/**
 * `points` (opcional, D-213 tras D-212): marcadores encima de las geocercas, y el encuadre los
 * incluye. Un punto fuera lleva su etiqueta de distancia junto al marcador —texto y no una línea
 * hasta el borde, porque la distancia es a la geocerca (D-212) y una línea al centro del sitio
 * diría otra cosa—. `fallback` (opcional): qué pintar si no hay clave o el script no carga, en
 * vez del aviso en inglés de Ajustes; la ventana de Auditoría pone ahí su texto y el enlace.
 * Sin `points` ni `fallback` es exactamente lo de antes: GeofenceSection no cambia.
 */
// Default ESTABLE, a nivel de módulo. Un `points = []` en la firma sería un array nuevo en cada
// render y, como `points` es dependencia del efecto que hace `new maps.Map`, cada setState de
// GeofenceSection reconstruiría el mapa: parpadeo y una carga de Maps facturable por re-render.
// Lo mismo vale para quien pase `points` o `fences`: memoízalos (PhotoMapModal lo hace).
const SIN_PUNTOS: MapPoint[] = [];

export function GeofenceMap({ fences, points = SIN_PUNTOS, height = 320, fallback }: {
  fences: Fence[]; points?: MapPoint[]; height?: number; fallback?: (message: string) => React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!googleMapsEnabled()) {
      setErr("Google Maps is not configured (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY).");
      return;
    }
    let cancelled = false;
    let shapes: { setMap: (m: google.maps.Map | null) => void }[] = [];

    // Una llave rechazada (dominio no autorizado, llave desactivada) NO rechaza la carga: Google
    // resuelve, pinta el mapa gris y avisa UNA vez por window.gm_authFailure. Quien lo captura y
    // lo recuerda es el cargador compartido (google-maps-loader): la primera vez avisa por aquí,
    // con el mapa ya pintado; las siguientes, loadGoogleMaps() rechaza directamente y cae en el
    // catch de abajo. Este componente solo escucha; no registra el callback global.
    const offAuth = onMapsAuthFailure((message) => { if (!cancelled) setErr(message); });

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

      // Los puntos (fotos): marcador clásico con la etiqueta al lado; nada de marcadores
      // avanzados, que exigen un Map ID. Color y tamaño por estado (estiloMarcador): verde
      // normal dentro, rojo y casi el doble fuera, gris sin sitio. La etiqueta va sobre una
      // pastilla blanca (.tt-map-label, timetracker.css) para leerse encima del satélite.
      for (const p of points) {
        const s = estiloMarcador(p.estado);
        const marker = new maps.Marker({
          map, position: { lat: p.lat, lng: p.lng }, title: p.label,
          label: { text: p.label, color: s.labelColor, fontSize: "12px", fontWeight: s.labelWeight, className: s.labelClass },
          icon: { path: maps.SymbolPath.CIRCLE, scale: s.scale, fillColor: s.fill, fillOpacity: 1, strokeColor: s.stroke, strokeWeight: s.strokeWeight },
        });
        bounds.extend({ lat: p.lat, lng: p.lng });
        shapes.push(marker);
        algo = true;
      }

      // Encuadra lo que haya. Sin geocercas, el Valle: no dejar el mapa en el Atlántico.
      if (algo && !bounds.isEmpty()) {
        // 24 como siempre en Ajustes; con puntos, 40 para que un marcador en el borde no quede
        // pegado al marco. Sin puntos, el encuadre de Ajustes no cambia.
        map.fitBounds(bounds, points.length ? 40 : 24);
        // Un solo punto sin geocerca: fitBounds sobre un punto acerca hasta el máximo; se frena.
        if (points.length === 1 && fences.length === 0) map.setZoom(Math.min(map.getZoom() ?? 17, 17));
      } else map.setCenter({ lat: 26.2, lng: -98.23 }), map.setZoom(10);
    })();

    return () => {
      cancelled = true;
      offAuth();
      shapes.forEach((s) => s.setMap(null));
      shapes = [];
    };
  }, [fences, points]);

  if (err) {
    if (fallback) return <>{fallback(err)}</>;
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
