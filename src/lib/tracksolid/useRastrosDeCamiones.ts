"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Fix } from "@/lib/track-history";
import { todayISO } from "@/lib/utils";
import { colaConLoVivo, rastrosDeLaRespuesta, type CamionEnVivo, type RastroLeido } from "./rastro-en-mapa";
import { tocaRefrescar } from "./useCamiones";

// ============================================================
// El rastro del camión de cada chofer un día, para una pantalla (D-909). Habla con `/api/tracksolid/trails`.
//
// Pregunta al entrar y al cambiar de día. Si el día es HOY, vuelve a preguntar cada 3 minutos mientras la pestaña se
// ve (el servidor guarda una copia para todos: no es una llamada a TrackSolid por pantalla). Entre una lectura y la
// siguiente, la posición en vivo del camión (la que ya trae la marca, D-903) se cuelga al final de la línea, para que
// la línea llegue siempre hasta el camión.
//
// Sin TrackSolid (`enabled: false`), sin permiso, o si la petición falla: devuelve vacío y la pantalla dibuja el
// recorrido del teléfono, como antes. Un fallo pasajero no borra lo que ya se veía.
// ============================================================

export const REFRESCO_DEL_RASTRO_EN_PANTALLA_MS = 3 * 60_000;

export type RastroDeCamionDelChofer = {
  imei: string;
  /** Nombre del camión. Texto remoto: en React va como texto; en un tooltip de Leaflet, por `soloTexto()`. */
  camion: string;
  /** Puntos GPS que mandó el rastreador ese día (todos). */
  puntos: number;
  millas: number;
  /** La línea, ya con la cola en vivo. */
  fixes: Fix[];
};

type Leido = { fecha: string; rastros: RastroLeido[] };

const SIN_VIVO: readonly (CamionEnVivo & { driverId: string; imei: string })[] = [];
const SIN_RASTROS: ReadonlyMap<string, RastroDeCamionDelChofer> = new Map();

/**
 * `enVivo`: dónde está ahora el camión de cada chofer (`usePosicionesDeChoferes().camionesDeHoy.posiciones`). Solo se
 * usa si `fecha` es hoy. Devuelve un mapa por id de chofer; vacío si no hay nada que usar.
 */
export function useRastrosDeCamiones(
  fecha: string,
  activo: boolean,
  enVivo: readonly (CamionEnVivo & { driverId: string; imei: string })[] = SIN_VIVO,
): ReadonlyMap<string, RastroDeCamionDelChofer> {
  const [leido, setLeido] = useState<Leido | null>(null);
  const [colas, setColas] = useState<{ fecha: string; porChofer: Record<string, Fix[]> }>({ fecha, porChofer: {} });
  const ultima = useRef<{ fecha: string; en: number } | null>(null);
  const apagado = useRef(false);
  const turno = useRef(0);

  const pide = useCallback(async () => {
    if (apagado.current) return;
    const esHoy = fecha === todayISO();
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    const misma = ultima.current?.fecha === fecha ? ultima.current.en : null;
    // Un día pasado se lee una vez; hoy, cada 3 minutos.
    if (!tocaRefrescar(visible, misma, Date.now(), esHoy ? REFRESCO_DEL_RASTRO_EN_PANTALLA_MS : Infinity)) return;
    ultima.current = { fecha, en: Date.now() };
    const mio = ++turno.current;
    try {
      const r = await fetch(`/api/tracksolid/trails?date=${encodeURIComponent(fecha)}`, { cache: "no-store" });
      if (mio !== turno.current) return; // llegó tarde: ya se pidió otro día
      if (r.status === 401) { apagado.current = true; setLeido(null); return; }
      if (r.status === 403) { setLeido({ fecha, rastros: [] }); return; } // sin permiso para ESE día: se queda el teléfono
      if (!r.ok) { ultima.current = null; return; } // un fallo pasajero: se queda lo que había, y se reintenta en el siguiente latido
      const j = (await r.json()) as { enabled?: boolean; delayed?: boolean };
      if (mio !== turno.current) return;
      if (!j.enabled) { apagado.current = true; setLeido(null); return; }
      const rastros = rastrosDeLaRespuesta(j);
      // Una respuesta vacía por un fallo pasajero no borra las líneas que ya se veían.
      setLeido((antes) => (j.delayed && !rastros.length && antes?.fecha === fecha ? antes : { fecha, rastros }));
    } catch { if (mio === turno.current) ultima.current = null; /* sin red: se queda lo que había, y se reintenta */ }
  }, [fecha]);

  useEffect(() => {
    if (!activo) return;
    void pide();
    const reloj = setInterval(() => { void pide(); }, 30_000);
    const alVolver = () => { if (document.visibilityState === "visible") void pide(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { clearInterval(reloj); document.removeEventListener("visibilitychange", alVolver); };
  }, [activo, pide]);

  // La cola en vivo: solo hoy, y solo del MISMO camión del que es el rastro.
  const rastros = activo && leido?.fecha === fecha ? leido.rastros : null;
  useEffect(() => {
    if (!rastros || fecha !== todayISO()) return;
    setColas((prev) => {
      const antes = prev.fecha === fecha ? prev.porChofer : {};
      let cambio = prev.fecha !== fecha;
      const porChofer: Record<string, Fix[]> = {};
      for (const r of rastros) {
        const vivo = enVivo.find((v) => v.driverId === r.driverId && v.imei === r.imei) ?? null;
        const vieja = antes[r.driverId] ?? SIN_COLA;
        const nueva = colaConLoVivo(vieja, r.fixes, vivo);
        if (nueva !== vieja) cambio = true;
        if (nueva.length) porChofer[r.driverId] = nueva;
      }
      return cambio ? { fecha, porChofer } : prev;
    });
  }, [rastros, enVivo, fecha]);

  return useMemo(() => {
    if (!rastros?.length) return SIN_RASTROS;
    const out = new Map<string, RastroDeCamionDelChofer>();
    for (const r of rastros) {
      const cola = colas.fecha === fecha ? colas.porChofer[r.driverId] : undefined;
      // `colaConLoVivo` otra vez, sin posición nueva: quita de la cola lo que una lectura más nueva del rastro ya alcanzó.
      const limpia = cola ? colaConLoVivo(cola, r.fixes, null) : SIN_COLA;
      out.set(r.driverId, { imei: r.imei, camion: r.camion, puntos: r.puntos, millas: r.millas, fixes: limpia.length ? [...r.fixes, ...limpia] : r.fixes });
    }
    return out;
  }, [rastros, colas, fecha]);
}

const SIN_COLA: Fix[] = [];
