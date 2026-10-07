import type { clockIn, clockOut, getMyDay } from "@/app/timetracker/clock-in/actions/clock";
import type { endLeave, startLeave } from "@/app/timetracker/clock-in/actions/leave";
import type { endTrip, finishStop, getMyTrip, logStop, startTrip } from "@/app/timetracker/clock-in/actions/runner";
import type { countUnread, getMyNotes, getMyNotifications } from "@/app/timetracker/clock-in/actions/myday";
import type { addNote } from "@/app/timetracker/clock-in/actions/notes";
import type { markAllRead } from "@/app/timetracker/clock-in/actions/notifications";
import type { getMyTimeOff, submitTimeOff } from "@/app/timetracker/clock-in/actions/timeoff";
import type { subirFotoDeFichaje } from "@/lib/clockin/sube-foto";
import { diaConPractica, viajeConPractica, type EventoDeFichar, type Practica } from "./capacitacion";

/**
 * Las acciones de fichar de la pantalla del empleado, en real o en práctica (modo capacitación, D-NEXT).
 *
 * `PunchPanel`, `TripPanel`, «Notas del día», «Tiempo libre», «Fichajes de hoy» y la campana ya no
 * importan las acciones de servidor: piden este juego a `useAccionesDeFichar()`. Con la práctica
 * apagada es el juego real, tal cual. Encendida, es el de abajo:
 *
 * - **lo que escribe no llama a nadie**: apunta lo hecho en la práctica (fichar, comida, salir, viaje,
 *   parada, nota, tiempo libre, avisos leídos) y contesta `ok` como contestaría el servidor;
 * - **lo que lee pregunta lo real y le pinta la práctica encima** (`diaConPractica`, `viajeConPractica`),
 *   así la persona ve su día de verdad y, sobre él, lo que está practicando;
 * - **la foto no se sube**: se devuelve una ruta de práctica, y la parada se apunta igual.
 *
 * El juego es un objeto con TODAS las claves de `AccionesDeFichar`: TypeScript no deja dejar fuera una,
 * así que una acción nueva en el juego obliga a decidir aquí su práctica. Las pruebas comprueban que
 * ninguna versión de práctica de algo que escribe toca la real.
 */
export type AccionesDeFichar = {
  getMyDay: typeof getMyDay;
  getMyTrip: typeof getMyTrip;
  clockIn: typeof clockIn;
  clockOut: typeof clockOut;
  startLeave: typeof startLeave;
  endLeave: typeof endLeave;
  startTrip: typeof startTrip;
  endTrip: typeof endTrip;
  logStop: typeof logStop;
  finishStop: typeof finishStop;
  subirFoto: typeof subirFotoDeFichaje;
  getMyNotes: typeof getMyNotes;
  addNote: typeof addNote;
  getMyTimeOff: typeof getMyTimeOff;
  submitTimeOff: typeof submitTimeOff;
  getMyNotifications: typeof getMyNotifications;
  countUnread: typeof countUnread;
  markAllRead: typeof markAllRead;
};

/** Qué es cada una. Las `escribe` nunca llegan a la real en práctica; las `lee` sí, y se les pinta encima. */
export const CLASE_DE_ACCION: Record<keyof AccionesDeFichar, "lee" | "escribe"> = {
  getMyDay: "lee",
  getMyTrip: "lee",
  clockIn: "escribe",
  clockOut: "escribe",
  startLeave: "escribe",
  endLeave: "escribe",
  startTrip: "escribe",
  endTrip: "escribe",
  logStop: "escribe",
  finishStop: "escribe",
  subirFoto: "escribe",
  getMyNotes: "lee",
  addNote: "escribe",
  getMyTimeOff: "lee",
  submitTimeOff: "escribe",
  getMyNotifications: "lee",
  countUnread: "lee",
  markAllRead: "escribe",
};

export type Libreta = {
  /** Lo practicado AHORA. Un ref, no el estado de React: tras apuntar algo, la lectura siguiente ya lo ve. */
  leer: () => Practica;
  cambia: (f: (p: Practica) => Practica) => void;
  ahora: () => number;
  nuevoId: () => string;
};

const apunta = (l: Libreta, ev: EventoDeFichar) => l.cambia((p) => ({ ...p, fichar: [...p.fichar, ev] }));

export function accionesDePractica(reales: AccionesDeFichar, l: Libreta): AccionesDeFichar {
  const iso = () => new Date(l.ahora()).toISOString();
  return {
    getMyDay: async () => {
      const r = await reales.getMyDay();
      return r.ok ? diaConPractica(r, l.leer().fichar, l.ahora()) : r;
    },
    getMyTrip: async () => {
      const r = await reales.getMyTrip();
      return r.ok ? viajeConPractica(r, l.leer().fichar) : r;
    },
    clockIn: async () => {
      const id = l.nuevoId();
      const at = iso();
      apunta(l, { k: "entrada", id, at });
      return { ok: true, entryId: id, clockInAt: at, onSite: true };
    },
    clockOut: async () => {
      apunta(l, { k: "salida", at: iso() });
      return { ok: true, onSite: true };
    },
    startLeave: async (input) => {
      const id = l.nuevoId();
      const at = iso();
      apunta(l, { k: "descanso", id, at, reason: input.reason });
      return { ok: true, leave: { id, reason: input.reason, leftAt: at, expectedReturnAt: null } };
    },
    endLeave: async () => {
      apunta(l, { k: "fin-descanso", at: iso() });
      return { ok: true };
    },
    startTrip: async (input) => {
      apunta(l, { k: "viaje", id: l.nuevoId(), at: iso(), vehicleId: input.personal ? null : (input.vehicleId ?? null) });
      return { ok: true };
    },
    endTrip: async () => {
      apunta(l, { k: "fin-viaje", at: iso() });
      return { ok: true };
    },
    logStop: async (input) => {
      apunta(l, { k: "parada", id: l.nuevoId(), at: iso(), label: input.label ?? null });
      return { ok: true };
    },
    finishStop: async () => {
      apunta(l, { k: "fin-parada", at: iso() });
      return { ok: true };
    },
    // La foto se hace (la cámara se abre igual: es parte de lo que se aprende) pero no sale del equipo.
    subirFoto: async () => ({ ok: true, path: `practica/${l.nuevoId()}.jpg` }),
    getMyNotes: async () => {
      const r = await reales.getMyNotes();
      return r.ok ? { ...r, notes: [...l.leer().notas, ...r.notes] } : r;
    },
    addNote: async (texto) => {
      const nota = { id: l.nuevoId(), note: texto, created_at: iso() };
      l.cambia((p) => ({ ...p, notas: [nota, ...p.notas] }));
      return { ok: true };
    },
    getMyTimeOff: async () => {
      const r = await reales.getMyTimeOff();
      return r.ok ? { ...r, rows: [...l.leer().tiempoLibre, ...r.rows] } : r;
    },
    submitTimeOff: async (input) => {
      const fila = {
        id: l.nuevoId(), type: input.type, start_date: input.startDate, end_date: input.endDate,
        note: input.note ?? null, status: "pending", manager_comment: null,
      };
      l.cambia((p) => ({ ...p, tiempoLibre: [fila, ...p.tiempoLibre] }));
      return { ok: true };
    },
    getMyNotifications: async () => {
      const r = await reales.getMyNotifications();
      if (!r.ok || !l.leer().avisosLeidos) return r;
      return { ...r, items: r.items.map((it) => ({ ...it, read: true })) };
    },
    countUnread: async () => (l.leer().avisosLeidos ? 0 : reales.countUnread()),
    markAllRead: async () => {
      l.cambia((p) => ({ ...p, avisosLeidos: true }));
      return { ok: true };
    },
  };
}
