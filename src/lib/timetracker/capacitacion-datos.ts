import type { DataState } from "@/lib/timetracker-data-provider";
import type { Screenshot, Session, TimeRequest } from "./types";
import { esIdDePractica, mensajeDeCapacitacion, type Practica } from "./capacitacion";
import type { Libreta } from "./capacitacion-fichar";
import type { Idioma } from "@/lib/idioma";

/**
 * El proveedor de datos de Time Tracker en modo capacitación (D-NEXT).
 *
 * Todo lo que el proveedor ofrece está clasificado aquí, función por función, y el objeto de práctica
 * se CONSTRUYE desde esta tabla: no se copia el real y se tapan huecos, que es justo como una función
 * nueva se colaría sin querer. `satisfies` hace que TypeScript no compile si una función del proveedor
 * no tiene clase.
 *
 * - **pasa**: lee, o no toca datos (avisar en pantalla, cerrar sesión en todos los equipos).
 * - **practica**: el cronómetro (sus sesiones viven solo en la práctica), «Mis solicitudes» y las
 *   capturas del escritorio (se hacen, no se suben). El registro de auditoría tampoco se escribe.
 * - **bloqueada**: todo lo demás que escribe —la cuenta, las pantallas del gerente—. Lanza el error de
 *   «esto no se guardó» y cada pantalla lo enseña como enseña cualquier fallo al guardar.
 */
type FuncionesDe<T> = { [K in keyof T]: T[K] extends (...a: never[]) => unknown ? K : never }[keyof T];
export type ClaseDeDato = "pasa" | "practica" | "bloqueada";

export const CLASE_DE_DATO = {
  ensureSessionsSince: "pasa",
  addRequest: "practica",
  notify: "pasa",
  listLiveSessions: "practica",
  getSession: "practica",
  startSession: "practica",
  updateSession: "practica",
  updateLiveSession: "practica",
  screenshotSignedUrl: "pasa",
  deleteScreenshot: "bloqueada",
  uploadScreenshot: "practica",
  insertBlankScreenshot: "practica",
  updateMyAccount: "bloqueada",
  signOutEverywhere: "pasa",
  logAudit: "practica",
  sessionsSince: "pasa",
  sessionsByProject: "pasa",
  insertSession: "bloqueada",
  removeSession: "bloqueada",
  payrollsForWeek: "pasa",
  insertPayroll: "bloqueada",
  updatePayroll: "bloqueada",
  removePayroll: "bloqueada",
  insertProject: "bloqueada",
  updateProject: "bloqueada",
  insertAssignment: "bloqueada",
  updateAssignment: "bloqueada",
  removeAssignment: "bloqueada",
  claimRequest: "bloqueada",
  resetRequestToPending: "bloqueada",
  updateEmployeeSettings: "bloqueada",
  updateSettings: "bloqueada",
} as const satisfies Record<FuncionesDe<DataState>, ClaseDeDato>;

/** Una sesión completa a partir de lo que manda el cronómetro, con los valores de una fila nueva. */
function sesionNueva(id: string, meId: string, ahoraIso: string, payload: Partial<Session>): Session {
  return {
    employeeName: null, projectId: null, assignmentId: null, payrollId: null, memo: "", weekOf: null, date: null,
    startMs: null, endMs: null, durationSeconds: 0, activeSeconds: 0, idleSeconds: 0, screenSeconds: 0,
    keystrokes: 0, clicks: 0, lunchSeconds: 0, breakSeconds: 0, breakEvents: [], manual: false, source: "tracked",
    isLive: false, liveNote: null, createdAt: ahoraIso,
    ...payload,
    id,
    employeeUid: meId,
  };
}

const sesionesDe = (p: Practica) => p.sesiones as unknown as Session[];
const solicitudesDe = (p: Practica) => p.solicitudes as unknown as TimeRequest[];

/** Todas las funciones del proveedor, en práctica: las que pasan, las que se practican y las que se bloquean. */
export type FuncionesDeDatos = { [K in keyof typeof CLASE_DE_DATO]: DataState[K] };

/**
 * Las funciones de práctica, construidas desde la tabla. Leen el proveedor real **al llamarlas**
 * (`leerReal`), no al crearlas: así el proveedor las crea una vez por práctica (`useMemo`) y cada
 * función conserva su identidad entre pintados. Si cambiaran en cada pintado, los efectos del
 * cronómetro que dependen de ellas se volverían a montar en cada pintado.
 */
export function funcionesDePractica(leerReal: () => DataState, l: Libreta, idioma: Idioma): FuncionesDeDatos {
  const iso = () => new Date(l.ahora()).toISOString();
  const bloquea = async (): Promise<never> => { throw new Error(mensajeDeCapacitacion(idioma)); };
  const cambiaSesion = (id: string, patch: Partial<Session>) =>
    l.cambia((p) => ({ ...p, sesiones: sesionesDe(p).map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s)) as unknown as Record<string, unknown>[] }));
  const captura = (rec: { employeeUid: string; sessionId: string | null; date: string | null }, vacia: boolean): Screenshot => ({
    id: l.nuevoId(), employeeUid: rec.employeeUid, sessionId: rec.sessionId, path: null, url: null,
    takenAt: iso(), date: rec.date, activityPercent: 0, noActivity: vacia,
  });
  return {
    // ---- pasa: la del proveedor real, tal cual ----
    ensureSessionsSince: (...a) => leerReal().ensureSessionsSince(...a),
    notify: (...a) => leerReal().notify(...a),
    screenshotSignedUrl: (...a) => leerReal().screenshotSignedUrl(...a),
    signOutEverywhere: (...a) => leerReal().signOutEverywhere(...a),
    sessionsSince: (...a) => leerReal().sessionsSince(...a),
    sessionsByProject: (...a) => leerReal().sessionsByProject(...a),
    payrollsForWeek: (...a) => leerReal().payrollsForWeek(...a),
    // ---- practica ----
    addRequest: async (type, payload) => {
      const fila: TimeRequest = {
        id: l.nuevoId(), employeeUid: leerReal().me.id, type, payload, status: "pending",
        resolvedAt: null, resolvedBy: null, createdAt: iso(),
      };
      l.cambia((p) => ({ ...p, solicitudes: [fila as unknown as Record<string, unknown>, ...p.solicitudes] }));
    },
    // Solo las de práctica: el cronómetro de práctica no debe ver —ni cerrar— una sesión real viva.
    listLiveSessions: async () => sesionesDe(l.leer()).filter((s) => s.isLive),
    getSession: async (id) => (esIdDePractica(id) ? (sesionesDe(l.leer()).find((s) => s.id === id) ?? null) : leerReal().getSession(id)),
    startSession: async (payload) => {
      const s = sesionNueva(l.nuevoId(), leerReal().me.id, iso(), payload);
      l.cambia((p) => ({ ...p, sesiones: [s as unknown as Record<string, unknown>, ...p.sesiones] }));
      return s;
    },
    // Una fila real no se toca en práctica: se ignora sin error, como si ya estuviera hecho.
    updateSession: async (id, patch) => { if (esIdDePractica(id)) cambiaSesion(id, patch); },
    updateLiveSession: async (id, patch) => {
      const s = esIdDePractica(id) ? sesionesDe(l.leer()).find((x) => x.id === id) : undefined;
      if (!s || !s.isLive) return false;
      cambiaSesion(id, patch);
      return true;
    },
    uploadScreenshot: async (rec) => captura(rec, false),
    insertBlankScreenshot: async (rec) => captura(rec, true),
    logAudit: async () => {},
    // ---- bloqueada ----
    deleteScreenshot: bloquea,
    updateMyAccount: bloquea,
    insertSession: bloquea,
    removeSession: bloquea,
    insertPayroll: bloquea,
    updatePayroll: bloquea,
    removePayroll: bloquea,
    insertProject: bloquea,
    updateProject: bloquea,
    insertAssignment: bloquea,
    updateAssignment: bloquea,
    removeAssignment: bloquea,
    claimRequest: bloquea,
    resetRequestToPending: bloquea,
    updateEmployeeSettings: bloquea,
    updateSettings: bloquea,
  };
}

/**
 * El proveedor en práctica: el real con TODAS sus funciones sustituidas por las de la tabla, y lo
 * practicado delante de lo real en «mis sesiones» y «mis solicitudes» (lo último, arriba).
 */
export function conPractica(real: DataState, f: FuncionesDeDatos, practica: Practica): DataState {
  return {
    ...real,
    ...f,
    mySessions: [...sesionesDe(practica), ...real.mySessions],
    myRequests: [...solicitudesDe(practica), ...real.myRequests],
  };
}

/** Las dos cosas de una vez, con el proveedor de ese momento. Para las pruebas. */
export function datosDePractica(real: DataState, l: Libreta, idioma: Idioma): DataState {
  return conPractica(real, funcionesDePractica(() => real, l, idioma), l.leer());
}
