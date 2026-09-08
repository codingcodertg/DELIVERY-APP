"use client";

import { GoogleMapView } from "@/components/GoogleMapView";
import { LeafletMap, type LiveDriver, type MapLine, type MapPoint, type StoreMarker } from "@/components/LeafletMap";
import { googleMapsEnabled } from "@/lib/google-maps-loader";

// ============================================================
// The one map component the app uses.
//
// Google Maps when a browser key is configured; the OpenStreetMap/Leaflet
// map otherwise. Same props either way, so pages don't know or care which is
// rendering — and a missing/blocked key degrades to a working map instead of
// an empty box.
// ============================================================

export type { LiveDriver, MapLine, MapPoint, StoreMarker };

export interface MapViewProps {
  points?: MapPoint[];
  /** Contorno de la zona local en verde (D-NEXT). Lo pintan los DOS mapas: `MapView` elige
   *  Google o Leaflet según haya llave, y la zona tiene que verse en cualquiera de los dos. */
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
}

export function MapView(props: MapViewProps) {
  return googleMapsEnabled() ? <GoogleMapView {...props} /> : <LeafletMap {...props} />;
}
