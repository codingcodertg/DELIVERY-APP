"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { shiftDateISO } from "@/lib/utils";
import type { Fix } from "@/lib/track-history";
import type { DriverLocation } from "@/lib/types";

/**
 * D-846: lo que cada chofer MANEJÓ ese día, para pintarlo encima de su ruta planeada (`recorrido-contra-plan`).
 *
 * Se lee el día una vez (como el Recorrido, `track/page.tsx`), y lo que llega en vivo por el proveedor (`driverLocations`,
 * la última de cada chofer) se cuelga al final si es más nuevo: la línea crece sola, sin volver a leer.
 *
 * Quién ve qué lo dice la base (migración 121): admin, logística, gerente y almacén ven a todos; el chofer, lo suyo; los
 * demás no reciben filas y no se pinta nada.
 */

/** Como el Recorrido (D-832): un día largo a 10 m / 5 s son miles de posiciones por chofer. */
const FIXES_POR_DIA = 20_000;

export function useRecorridoDelDia(
  choferes: readonly { id: string; nombre: string }[],
  fecha: string,
  activo: boolean,
  enVivo: readonly DriverLocation[],
  esHoy: boolean,
): Record<string, Fix[]> {
  const firma = choferes.map((c) => `${c.id}=${c.nombre}`).sort().join("|");
  const [leido, setLeido] = useState<{ firma: string; fecha: string; porId: Record<string, Fix[]> } | null>(null);

  useEffect(() => {
    if (!activo || !firma) { setLeido(null); return; }
    let cancelado = false;
    const ids = firma.split("|").map((x) => x.slice(0, x.indexOf("=")));
    (async () => {
      const from = centralWallToUtc(`${fecha}T00:00`);
      const to = centralWallToUtc(`${shiftDateISO(fecha, 1)}T00:00`);
      const { data } = await createClient().from("driver_locations").select("driver_id, lat, lng, accuracy_m, recorded_at")
        .in("driver_id", ids).gte("recorded_at", from).lt("recorded_at", to)
        .order("recorded_at", { ascending: true }).limit(FIXES_POR_DIA * Math.max(1, ids.length));
      if (cancelado) return;
      const porId: Record<string, Fix[]> = {};
      for (const id of ids) porId[id] = [];
      for (const r of (data ?? []) as { driver_id: string; lat: number; lng: number; accuracy_m: number | null; recorded_at: string }[]) {
        porId[r.driver_id]?.push({ lat: r.lat, lng: r.lng, accuracy_m: r.accuracy_m, at: r.recorded_at });
      }
      setLeido({ firma, fecha, porId });
    })();
    return () => { cancelado = true; };
  }, [firma, fecha, activo]);

  // En vivo: el proveedor solo guarda la ÚLTIMA de cada chofer, así que se va colgando aquí, una a una (como el Recorrido).
  useEffect(() => {
    if (!esHoy) return;
    setLeido((prev) => {
      if (!prev) return prev;
      let cambio = false;
      const porId = { ...prev.porId };
      for (const loc of enVivo) {
        const suyas = porId[loc.driver_id];
        if (!suyas) continue;
        const ultima = suyas[suyas.length - 1];
        if (ultima && new Date(loc.recorded_at).getTime() <= new Date(ultima.at).getTime()) continue;
        porId[loc.driver_id] = [...suyas, { lat: loc.lat, lng: loc.lng, accuracy_m: loc.accuracy_m, at: loc.recorded_at }];
        cambio = true;
      }
      return cambio ? { ...prev, porId } : prev;
    });
  }, [enVivo, esHoy, leido?.firma, leido?.fecha]);

  return useMemo(() => {
    if (!activo || !leido || leido.firma !== firma || leido.fecha !== fecha) return {};
    const nombrePorId = new Map(firma.split("|").map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)] as const));
    const out: Record<string, Fix[]> = {};
    for (const [id, fixes] of Object.entries(leido.porId)) {
      const nombre = nombrePorId.get(id);
      if (nombre && fixes.length) out[nombre] = fixes;
    }
    return out;
  }, [leido, firma, fecha, activo]);
}
