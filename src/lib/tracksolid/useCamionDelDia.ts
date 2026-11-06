"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { posicionesDeChoferes, type CamionDelChofer, type PosicionDeChofer } from "@/lib/posicion-del-chofer";
import { todayISO } from "@/lib/utils";
import { REFRESCO_DE_CAMIONES_MS, tocaRefrescar } from "./useCamiones";

// ============================================================
// El camión de cada chofer un día, para una pantalla (D-903). Habla con `/api/tracksolid/assignments`.
//
//   · `useCamionDelDia(fecha)`            — qué camión lleva cada chofer ESE día, y cambiarlo (el selector
//                                            de la cabecera de la ruta, la hoja PNG, «Mi ruta»).
//   · `usePosicionesDeChoferes()`         — dónde está cada chofer AHORA: lo del teléfono (el proveedor)
//                                            fundido con el rastreador de su camión de hoy. Devuelve la
//                                            misma forma que `driverLocations`, para ponerlo en su lugar.
//
// Igual que la capa de camiones (D-900): con la pestaña oculta no pregunta; si la instalación no tiene
// TrackSolid (`enabled: false`) o no hay permiso, deja de preguntar y todo queda como antes.
// ============================================================

export type CamionAsignado = {
  driverId: string;
  driver: string;
  /** `null`: ese día va sin camión, a propósito. */
  imei: string | null;
  truck: string | null;
  origin: "day" | "usual";
  usualImei: string | null;
  usualTruck: string | null;
};
export type CamionElegible = { imei: string; name: string; usualDriverId: string | null };
export type ConflictoDeCamion = { driverId: string; driver: string; imei: string; truck: string; inReturn: string | null };
export type ResultadoDeAsignar = { ok: true } | { ok: false; conflicto: ConflictoDeCamion } | { ok: false; error: string };

/** Lo avisa quien cambia un camión, para que las demás lecturas abiertas (otra fecha, el mapa en vivo) se refresquen. */
const AVISO_DE_CAMBIO = "rtg:camion-del-dia";

type Respuesta = { enabled?: boolean; canAssign?: boolean; assignments?: CamionAsignado[]; trucks?: CamionElegible[]; positions?: CamionDelChofer[] };

export type EstadoDelCamionDelDia = {
  /** `null` mientras no se sabe; `false`: no hay TrackSolid o no hay permiso. */
  disponible: boolean | null;
  asignaciones: CamionAsignado[];
  /** Los camiones para elegir. Vacío para quien no planifica. */
  camiones: CamionElegible[];
  /** Dónde está el camión de cada chofer (solo con `vivo`, solo hoy, solo lo que quien mira puede ver). */
  posiciones: CamionDelChofer[];
  puedeAsignar: boolean;
  /** Sube con cada respuesta: para recalcular «hace X min». */
  pulso: number;
  asigna: (driverId: string, imei: string | null | "usual", intercambia?: boolean) => Promise<ResultadoDeAsignar>;
};

export function useCamionDelDia(fecha: string, opciones: { activo?: boolean; vivo?: boolean } = {}): EstadoDelCamionDelDia {
  const activo = opciones.activo ?? true, vivo = !!opciones.vivo;
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [datos, setDatos] = useState<{ fecha: string; r: Respuesta } | null>(null);
  const [pulso, setPulso] = useState(0);
  const ultima = useRef<{ fecha: string; en: number } | null>(null);
  const apagado = useRef(false);
  const turno = useRef(0);

  const pide = useCallback(async (forzar = false) => {
    if (apagado.current) return;
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    const misma = ultima.current?.fecha === fecha ? ultima.current.en : null;
    if (!forzar && !tocaRefrescar(visible, misma, Date.now(), vivo ? REFRESCO_DE_CAMIONES_MS : Infinity)) return;
    ultima.current = { fecha, en: Date.now() };
    const mio = ++turno.current;
    try {
      const r = await fetch(`/api/tracksolid/assignments?date=${encodeURIComponent(fecha)}${vivo ? "&live=1" : ""}`, { cache: "no-store" });
      if (mio !== turno.current) return; // llegó tarde: ya se pidió otra fecha
      if (r.status === 401 || r.status === 403) { apagado.current = true; setDisponible(false); return; }
      if (!r.ok) return; // un 503 pasajero: se queda lo que había
      const j = (await r.json()) as Respuesta;
      if (mio !== turno.current) return;
      if (!j.enabled) { apagado.current = true; setDisponible(false); return; }
      setDisponible(true);
      setDatos({ fecha, r: j });
    } catch { /* sin red: se queda lo que había */ } finally {
      setPulso((n) => n + 1);
    }
  }, [fecha, vivo]);

  useEffect(() => {
    if (!activo) return;
    void pide();
    const reloj = vivo ? setInterval(() => { void pide(); }, REFRESCO_DE_CAMIONES_MS) : null;
    const alVolver = () => { if (document.visibilityState === "visible") void pide(); };
    const alCambiar = () => { void pide(true); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener(AVISO_DE_CAMBIO, alCambiar);
    return () => { if (reloj) clearInterval(reloj); document.removeEventListener("visibilitychange", alVolver); window.removeEventListener(AVISO_DE_CAMBIO, alCambiar); };
  }, [activo, vivo, pide]);

  const asigna = useCallback(async (driverId: string, imei: string | null | "usual", intercambia = false): Promise<ResultadoDeAsignar> => {
    try {
      const r = await fetch("/api/tracksolid/assignments", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: fecha, driver_id: driverId, imei, swap: intercambia }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; conflict?: ConflictoDeCamion };
      if (r.status === 409 && j.conflict) return { ok: false, conflicto: j.conflict };
      if (!r.ok) return { ok: false, error: j.error ?? "Could not save the truck." };
      window.dispatchEvent(new Event(AVISO_DE_CAMBIO));
      return { ok: true };
    } catch {
      return { ok: false, error: "No connection. The truck was not changed." };
    }
  }, [fecha]);

  // Lo leído vale solo para SU fecha: al cambiar de día no se enseña el camión de ayer mientras llega el de hoy.
  const r = activo && datos?.fecha === fecha ? datos.r : null;
  return useMemo(() => ({
    disponible: activo ? disponible : false,
    asignaciones: r?.assignments ?? SIN_ASIGNACIONES,
    camiones: r?.trucks ?? SIN_CAMIONES,
    posiciones: r?.positions ?? SIN_POSICIONES,
    puedeAsignar: !!r?.canAssign,
    pulso, asigna,
  }), [activo, disponible, r, pulso, asigna]);
}

const SIN_ASIGNACIONES: CamionAsignado[] = [];
const SIN_CAMIONES: CamionElegible[] = [];
const SIN_POSICIONES: CamionDelChofer[] = [];

/**
 * Dónde está cada chofer AHORA, con la mejor fuente (teléfono o rastreador de su camión de hoy). Una fila por chofer,
 * en la forma de `driverLocations`: se pone en su lugar y la pantalla no tiene que saber nada más.
 *
 * `camionesDeHoy` va aparte para quien además quiera saber qué camión lleva cada uno (el Gestor lo usa para no pintar
 * dos veces el mismo camión).
 */
export function usePosicionesDeChoferes(activo: boolean = true): { posiciones: PosicionDeChofer[]; camionesDeHoy: EstadoDelCamionDelDia } {
  const { driverLocations } = useData();
  const camionesDeHoy = useCamionDelDia(todayISO(), { activo, vivo: true });
  // Un latido propio cada 30 s: «separados desde hace 3 min» y «el teléfono ya no está fresco» cambian con el reloj,
  // no solo cuando llega una posición.
  const [latido, setLatido] = useState(0);
  const hayCamiones = camionesDeHoy.posiciones.length > 0;
  useEffect(() => {
    if (!hayCamiones) return;
    const reloj = setInterval(() => setLatido((n) => n + 1), 30_000);
    return () => clearInterval(reloj);
  }, [hayCamiones]);
  const posiciones = useMemo(
    () => (hayCamiones ? posicionesDeChoferes(driverLocations, camionesDeHoy.posiciones) : driverLocations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [driverLocations, camionesDeHoy.posiciones, camionesDeHoy.pulso, latido, hayCamiones],
  );
  return { posiciones, camionesDeHoy };
}
