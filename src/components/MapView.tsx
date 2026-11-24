"use client";

import { useState } from "react";
import { GoogleMapView } from "@/components/GoogleMapView";
import { LeafletMap, type LiveDriver, type MapLine, type MapPoint, type StoreMarker } from "@/components/LeafletMap";
import { googleMapsEnabled } from "@/lib/google-maps-loader";
import { usePrefs } from "@/lib/prefs";
import type { TruckMarker } from "@/lib/tracksolid/marca";

// ============================================================
// The one map component the app uses.
//
// Google Maps when a browser key is configured; the OpenStreetMap/Leaflet
// map otherwise. Same props either way, so pages don't know or care which is
// rendering — and a missing/blocked key degrades to a working map instead of
// an empty box.
// ============================================================

export type { LiveDriver, MapLine, MapPoint, StoreMarker, TruckMarker };

export interface MapViewProps {
  points?: MapPoint[];
  /** Contorno de la zona local en verde (D-219). Lo pintan los DOS mapas: `MapView` elige
   *  Google o Leaflet según haya llave, y la zona tiene que verse en cualquiera de los dos. */
  zone?: { lat: number; lng: number }[];
  lines?: MapLine[];
  stores?: StoreMarker[];
  liveDrivers?: LiveDriver[];
  /** Los camiones por su rastreador GPS (TrackSolid, D-900). Solo el Gestor los pasa; no entran en el encuadre. */
  trucks?: TruckMarker[];
  onPointClick?: (id: string) => void;
  onLineClick?: (id: string) => void;
  fitTo?: [number, number][];
  center?: [number, number];
  zoom?: number;
  pickable?: boolean;
  onPick?: (lat: number, lng: number) => void;
  pickedPoint?: [number, number] | null;
  /** Píxeles, o un largo de CSS (el Gestor pasa `var(--alto-mapa-gestor)`, D-862). */
  height?: number | string;
}

/**
 * El botón «centrar» (D-1146). Julio Jijon (chofer), 2026-11-24, desde «Mi ruta» en su teléfono: «Have a recenter button on
 * the map». Después de mover o acercar el mapa con el dedo no había cómo volver a ver la ruta entera sin recargar. Va en
 * TODOS los mapas de la app (este componente es el único que las pantallas montan), arriba a la derecha, donde ninguno de
 * los dos mapas pone nada suyo (Leaflet tiene el zoom arriba a la izquierda; Google, abajo a la derecha). La foto de la
 * ruta (PNG) monta `LeafletMap` directo y no lo lleva.
 */
export function MapView(props: MapViewProps) {
  const { t } = usePrefs();
  const [recentrar, setRecentrar] = useState(0);
  const texto = t("Recenter the map", "Centrar el mapa");
  // Con un alto en porcentaje, el porcentaje es de la caja de fuera: la de dentro la llena.
  const enPorciento = typeof props.height === "string" && props.height.trim().endsWith("%");
  const dentro = enPorciento ? { ...props, height: "100%" } : props;
  return (
    <div data-mapa-con-centrar style={{ position: "relative", ...(enPorciento ? { height: props.height } : {}) }}>
      {googleMapsEnabled() ? <GoogleMapView {...dentro} recentrar={recentrar} /> : <LeafletMap {...dentro} recentrar={recentrar} />}
      {/* El aspecto, en globals.css (`.mapa-centrar`): con los colores del tema, sin colores a pelo aquí. */}
      <button type="button" className="mapa-centrar" data-centrar-el-mapa aria-label={texto} title={texto}
        onClick={(e) => { e.stopPropagation(); setRecentrar((n) => n + 1); }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </button>
    </div>
  );
}
