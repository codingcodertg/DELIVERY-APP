"use client";

import { GoogleMapView } from "@/components/GoogleMapView";
import { LeafletMap, type LiveDriver, type MapLine, type MapPoint, type StoreMarker } from "@/components/LeafletMap";
import { googleMapsEnabled } from "@/lib/google-maps-loader";
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
  /** Los camiones por su rastreador GPS (TrackSolid, D-NEXT). Solo el Gestor los pasa; no entran en el encuadre. */
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

export function MapView(props: MapViewProps) {
  return googleMapsEnabled() ? <GoogleMapView {...props} /> : <LeafletMap {...props} />;
}
