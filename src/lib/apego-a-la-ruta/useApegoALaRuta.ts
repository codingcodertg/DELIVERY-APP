"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { todayISO } from "@/lib/utils";
import { tocaRefrescar } from "@/lib/tracksolid/useCamiones";
import { apegosDeLaRespuesta, type ApegoDelChofer } from "./apego";

// ============================================================
// «Plan contra real» de cada chofer un día, para una pantalla (D-NEXT). Habla con `/api/route-adherence`.
//
// Pregunta al entrar y al cambiar de día. Si el día es HOY, vuelve a preguntar cada 3 minutos mientras la pestaña se ve
// —el mismo latido con que el Recorrido vuelve a leer el rastro del camión (`useRastrosDeCamiones`, D-909)—, así los
// números van detrás de la línea. Un fallo pasajero no borra lo que ya se veía.
// ============================================================

export const REFRESCO_DEL_APEGO_MS = 3 * 60_000;

export type EstadoDelApego = {
  /** Por id de chofer. Vacío mientras carga o si no hay plan de nadie. */
  porChofer: ReadonlyMap<string, ApegoDelChofer>;
  cargando: boolean;
  /** `true` cuando la ruta contestó para ESTA fecha (aunque sin choferes). */
  listo: boolean;
};

const SIN_APEGOS: ReadonlyMap<string, ApegoDelChofer> = new Map();

export function useApegoALaRuta(fecha: string, activo: boolean): EstadoDelApego {
  const [leido, setLeido] = useState<{ fecha: string; apegos: ApegoDelChofer[] } | null>(null);
  const [cargando, setCargando] = useState(false);
  const ultima = useRef<{ fecha: string; en: number } | null>(null);
  const apagado = useRef(false);
  const turno = useRef(0);

  const pide = useCallback(async () => {
    if (apagado.current) return;
    const esHoy = fecha === todayISO();
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    const misma = ultima.current?.fecha === fecha ? ultima.current.en : null;
    if (!tocaRefrescar(visible, misma, Date.now(), esHoy ? REFRESCO_DEL_APEGO_MS : Infinity)) return;
    ultima.current = { fecha, en: Date.now() };
    const mio = ++turno.current;
    if (misma == null) setCargando(true);
    try {
      const r = await fetch(`/api/route-adherence?date=${encodeURIComponent(fecha)}`, { cache: "no-store" });
      if (mio !== turno.current) return;
      if (r.status === 401 || r.status === 403) { apagado.current = r.status === 401; setLeido({ fecha, apegos: [] }); return; }
      if (!r.ok) { ultima.current = null; return; }
      const j = (await r.json()) as unknown;
      if (mio !== turno.current) return;
      setLeido({ fecha, apegos: apegosDeLaRespuesta(j) });
    } catch { if (mio === turno.current) ultima.current = null; }
    finally { if (mio === turno.current) setCargando(false); }
  }, [fecha]);

  useEffect(() => {
    if (!activo) return;
    void pide();
    const reloj = setInterval(() => { void pide(); }, 30_000);
    const alVolver = () => { if (document.visibilityState === "visible") void pide(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { clearInterval(reloj); document.removeEventListener("visibilitychange", alVolver); };
  }, [activo, pide]);

  return useMemo(() => {
    const listo = !!leido && leido.fecha === fecha;
    if (!listo || !leido!.apegos.length) return { porChofer: SIN_APEGOS, cargando, listo };
    return { porChofer: new Map(leido!.apegos.map((a) => [a.driverId, a])), cargando, listo };
  }, [leido, fecha, cargando]);
}
