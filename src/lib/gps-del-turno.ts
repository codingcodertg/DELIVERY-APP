import { installedApkVersion } from "@/lib/app-update";
import type { LocationStatus } from "@/lib/useLiveLocation";

// ============================================================
// Lo que el turno dice de su GPS (D-714).
//
// La auditoría del 2026-10-27: Máximo marcaba entrada todos los días y no llegaba NI UN punto desde el 2 de
// septiembre; Julio nunca marcó entrada. La app sabía por qué (el rastreo devuelve «denied», «unavailable», o ni
// siquiera corre porque es un navegador y no la APK) y lo tiraba: `LocationTracker` descartaba el estado. Esto lo
// escribe en el turno (migración 206: `app`, `gps`, `gps_at`), se lo enseña al chofer cuando puede arreglarlo, y se
// lo pone a la oficina al lado del nombre en «no están reportando».
//
// Puro: sin React, sin red.
// ============================================================

/** Desde qué app se marcó la entrada: la APK con su versión («apk/6») o un navegador. */
export function appDelTurno(userAgent: string | null | undefined, nativa: boolean): string {
  const v = installedApkVersion(userAgent);
  if (nativa || v != null) return `apk/${v ?? "?"}`;
  return "navegador";
}

export type AvisoDeGps =
  /** Marcó entrada desde Chrome: ese teléfono no reporta, por diseño (G-26). La salida es abrir la APK. */
  | { tipo: "navegador" }
  /** En la APK, pero Android no da la ubicación. La salida son los permisos. */
  | { tipo: "sin_permiso" }
  /** En la APK, con permiso, y aun así no hay GPS (sin plugin, sin Play Services, sin hardware). */
  | { tipo: "sin_gps" };

/**
 * Qué se le dice al chofer en turno, o nada. Solo lo que puede arreglar él: «starting» y «live» no son avisos, y
 * fuera de turno no hay nada que reportar.
 */
export function avisoDeGps(args: { enTurno: boolean; nativa: boolean; estado: LocationStatus }): AvisoDeGps | null {
  if (!args.enTurno) return null;
  if (!args.nativa) return { tipo: "navegador" };
  if (args.estado === "denied") return { tipo: "sin_permiso" };
  if (args.estado === "unavailable") return { tipo: "sin_gps" };
  return null;
}

/** Lo que va entre paréntesis junto al nombre del chofer que no reporta: la app y el último estado, si se saben. */
export function porQueNoReporta(turno: { app?: string | null; gps?: string | null } | null | undefined, es: boolean): string | null {
  if (!turno) return null;
  const partes: string[] = [];
  if (turno.app === "navegador") partes.push(es ? "navegador, no la app" : "browser, not the app");
  else if (turno.app) partes.push(turno.app);
  if (turno.gps === "denied") partes.push(es ? "sin permiso de ubicación" : "location permission denied");
  else if (turno.gps === "unavailable") partes.push(es ? "sin GPS" : "no GPS");
  else if (turno.gps === "starting") partes.push(es ? "arrancando" : "starting");
  return partes.length ? partes.join(", ") : null;
}
