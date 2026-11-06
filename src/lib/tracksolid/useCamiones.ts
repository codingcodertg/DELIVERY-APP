"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CamionDeTracksolid } from "./camiones";

// ============================================================
// Los camiones de TrackSolid, para una pantalla (D-NEXT).
//
// Pregunta al entrar y luego cada ~60 s **mientras la pestaña se ve**. Con la pestaña oculta no pregunta
// nada; al volver, pregunta enseguida si lo que tiene ya es viejo. El servidor además guarda 30 s, así que
// diez pantallas abiertas no son diez llamadas a TrackSolid.
//
// `disponible: false` — la instalación no tiene TrackSolid, o quien mira no tiene permiso: la capa se
// esconde entera, sin aviso. Y deja de preguntar.
// ============================================================

export const REFRESCO_DE_CAMIONES_MS = 60_000;

/** ¿Toca preguntar? Aparte para probarlo: nunca con la pestaña oculta, y no antes de que pase el intervalo. */
export function tocaRefrescar(visible: boolean, ultimaMs: number | null, ahoraMs: number, cadaMs: number = REFRESCO_DE_CAMIONES_MS): boolean {
  if (!visible) return false;
  return ultimaMs == null || ahoraMs - ultimaMs >= cadaMs;
}

export type EstadoDeCamiones = {
  /** `null` mientras no se sabe; `false` esconde la capa. */
  disponible: boolean | null;
  camiones: CamionDeTracksolid[];
  /** El servidor no pudo leer ahora y manda lo último que tenía. */
  atrasado: boolean;
  /** Sube con cada respuesta y cada minuto: para recalcular «hace X min» aunque no cambie nada. */
  pulso: number;
  recarga: () => void;
};

export function useCamionesDeTracksolid(activo: boolean): EstadoDeCamiones {
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [camiones, setCamiones] = useState<CamionDeTracksolid[]>([]);
  const [atrasado, setAtrasado] = useState(false);
  const [pulso, setPulso] = useState(0);
  const ultima = useRef<number | null>(null);
  const enCurso = useRef(false);
  const apagado = useRef(false);

  const pide = useCallback(async (forzar = false) => {
    if (apagado.current || enCurso.current) return;
    if (!forzar && !tocaRefrescar(typeof document === "undefined" || document.visibilityState === "visible", ultima.current, Date.now())) return;
    enCurso.current = true;
    ultima.current = Date.now();
    try {
      const r = await fetch("/api/tracksolid/trucks", { cache: "no-store" });
      if (r.status === 401 || r.status === 403) { apagado.current = true; setDisponible(false); return; }
      if (!r.ok) return; // un 503 pasajero: se queda lo que había y se reintenta al minuto
      const j = (await r.json()) as { enabled?: boolean; trucks?: CamionDeTracksolid[]; delayed?: boolean };
      if (!j.enabled) { apagado.current = true; setDisponible(false); return; }
      setDisponible(true);
      // Una respuesta vacía por un fallo pasajero no borra los camiones que ya se veían.
      if (!(j.delayed && !(j.trucks ?? []).length)) setCamiones(j.trucks ?? []);
      setAtrasado(!!j.delayed);
    } catch { /* sin red: se queda lo que había */ } finally {
      enCurso.current = false;
      setPulso((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    if (!activo) return;
    void pide();
    const reloj = setInterval(() => { void pide(); }, REFRESCO_DE_CAMIONES_MS);
    const alVolver = () => { if (document.visibilityState === "visible") void pide(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { clearInterval(reloj); document.removeEventListener("visibilitychange", alVolver); };
  }, [activo, pide]);

  const recarga = useCallback(() => { void pide(true); }, [pide]);
  return { disponible: activo ? disponible : false, camiones, atrasado, pulso, recarga };
}
