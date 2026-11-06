"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { leeRecorridoDelTelefono } from "@/lib/recorrido-del-telefono";
import { eligeRecorrido, type CamionEnVivo } from "@/lib/tracksolid/rastro-en-mapa";
import { useRastrosDeCamiones } from "@/lib/tracksolid/useRastrosDeCamiones";
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
 *
 * D-909: el chofer que ese día lleva un camión con rastreador se dibuja con el rastro DEL CAMIÓN (`useRastrosDeCamiones`),
 * que no depende de que tenga la app abierta; los demás, con el del teléfono — leído entero, de 1.000 en 1.000
 * (`leeRecorridoDelTelefono`): antes llegaban solo las primeras 1.000 posiciones del día entre todos.
 */

const SIN_CAMIONES_EN_VIVO: readonly (CamionEnVivo & { driverId: string; imei: string })[] = [];

export function useRecorridoDelDia(
  choferes: readonly { id: string; nombre: string }[],
  fecha: string,
  activo: boolean,
  enVivo: readonly DriverLocation[],
  esHoy: boolean,
  /** Dónde está ahora el camión de cada chofer (`usePosicionesDeChoferes().camionesDeHoy.posiciones`): la línea llega hasta él. */
  camionesEnVivo: readonly (CamionEnVivo & { driverId: string; imei: string })[] = SIN_CAMIONES_EN_VIVO,
): Record<string, Fix[]> {
  const firma = choferes.map((c) => `${c.id}=${c.nombre}`).sort().join("|");
  const [leido, setLeido] = useState<{ firma: string; fecha: string; porId: Record<string, Fix[]> } | null>(null);
  const rastrosDeCamion = useRastrosDeCamiones(fecha, activo && !!firma, camionesEnVivo);

  useEffect(() => {
    if (!activo || !firma) { setLeido(null); return; }
    let cancelado = false;
    const ids = firma.split("|").map((x) => x.slice(0, x.indexOf("=")));
    (async () => {
      const { porId: leidas } = await leeRecorridoDelTelefono(createClient(), ids, fecha);
      if (cancelado) return;
      const porId: Record<string, Fix[]> = {};
      for (const id of ids) porId[id] = leidas[id] ?? [];
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
    for (const [id, delTelefono] of Object.entries(leido.porId)) {
      const nombre = nombrePorId.get(id);
      const { fixes } = eligeRecorrido(delTelefono, rastrosDeCamion.get(id)?.fixes);
      if (nombre && fixes.length) out[nombre] = fixes;
    }
    return out;
  }, [leido, firma, fecha, activo, rastrosDeCamion]);
}
