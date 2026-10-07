"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { clockIn, clockOut, getMyDay } from "@/app/timetracker/clock-in/actions/clock";
import { endLeave, startLeave } from "@/app/timetracker/clock-in/actions/leave";
import { endTrip, finishStop, getMyTrip, logStop, startTrip } from "@/app/timetracker/clock-in/actions/runner";
import { countUnread, getMyNotes, getMyNotifications } from "@/app/timetracker/clock-in/actions/myday";
import { addNote } from "@/app/timetracker/clock-in/actions/notes";
import { markAllRead } from "@/app/timetracker/clock-in/actions/notifications";
import { getMyTimeOff, submitTimeOff } from "@/app/timetracker/clock-in/actions/timeoff";
import { subirFotoDeFichaje } from "@/lib/clockin/sube-foto";
import { usePrefs } from "@/lib/prefs";
import { useT } from "@/lib/timetracker/i18n";
import type { Idioma } from "@/lib/idioma";
import {
  capacitacionDelNavegador, claveDePractica, cookieDeCapacitacion, practicaGuardada, practicaVacia,
  PREFIJO_DE_PRACTICA, type Practica,
} from "@/lib/timetracker/capacitacion";
import { accionesDePractica, type AccionesDeFichar, type Libreta } from "@/lib/timetracker/capacitacion-fichar";

/**
 * El modo capacitación en la pantalla (D-NEXT). La regla y las tres capas están en
 * `lib/timetracker/capacitacion.ts`; aquí vive lo que necesita React:
 *
 * - **el estado**: si está encendida (la cookie, que el layout ya leyó en el servidor) y lo practicado,
 *   guardado en el navegador por persona mientras dura;
 * - **el cambio de mundo**: todo Time Tracker se vuelve a montar al encender o apagar (`key`), así cada
 *   pantalla, el proveedor de datos y el cronómetro arrancan de cero en el modo nuevo. Es lo que hace
 *   que «al apagarlo todo vuelve a lo real» no dependa de que cada pantalla se acuerde de recargar;
 * - **las acciones de fichar** del empleado (`useAccionesDeFichar`), reales o de práctica;
 * - **el aviso fijo** de arriba.
 */

type Capacitacion = {
  /** El idioma de la práctica si está encendida; `null` si no. */
  activa: Idioma | null;
  encender: () => void;
  apagar: () => void;
  practica: Practica;
  libreta: Libreta;
};

const nuevoId = () =>
  PREFIJO_DE_PRACTICA + (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const vacia = practicaVacia();
const APAGADA: Capacitacion = {
  activa: null,
  encender: () => {},
  apagar: () => {},
  practica: vacia,
  libreta: { leer: () => vacia, cambia: () => {}, ahora: () => Date.now(), nuevoId },
};

const Ctx = createContext<Capacitacion>(APAGADA);

/** Fuera de Time Tracker (sin proveedor) la práctica está apagada: el proveedor de datos funciona igual. */
export function useCapacitacion(): Capacitacion {
  return useContext(Ctx);
}

/** Las acciones de servidor de verdad. Una sola vez, para que el juego real sea siempre el mismo objeto. */
const REALES: AccionesDeFichar = {
  getMyDay, getMyTrip, clockIn, clockOut, startLeave, endLeave, startTrip, endTrip, logStop, finishStop,
  subirFoto: subirFotoDeFichaje,
  getMyNotes, addNote, getMyTimeOff, submitTimeOff, getMyNotifications, countUnread, markAllRead,
};

/** Fichar, la comida, salir, los viajes, las notas, el tiempo libre y la campana: reales o de práctica. */
export function useAccionesDeFichar(): AccionesDeFichar {
  const { activa, libreta } = useCapacitacion();
  return useMemo(() => (activa ? accionesDePractica(REALES, libreta) : REALES), [activa, libreta]);
}

export function CapacitacionProvider({ inicial, uid, children }: { inicial: Idioma | null; uid: string; children: React.ReactNode }) {
  const { lang } = usePrefs();
  const [activa, setActiva] = useState<Idioma | null>(inicial);
  const [practica, setPractica] = useState<Practica>(vacia);
  // Lo practicado, al momento: tras «Fichar entrada», la lectura del día que va justo detrás ya lo ve.
  const actual = useRef<Practica>(vacia);
  const clave = claveDePractica(uid);

  const pon = useCallback((p: Practica) => {
    actual.current = p;
    setPractica(p);
  }, []);

  // Lo practicado sobrevive a recargar la página mientras dure la práctica.
  useEffect(() => {
    if (!activa) return;
    try { pon(practicaGuardada(localStorage.getItem(clave))); } catch { /* sin almacenamiento, en memoria */ }
  }, [activa, clave, pon]);

  const cambia = useCallback((f: (p: Practica) => Practica) => {
    const n = f(actual.current);
    pon(n);
    try { localStorage.setItem(clave, JSON.stringify(n)); } catch { /* en memoria */ }
  }, [clave, pon]);

  const olvida = useCallback(() => {
    pon(practicaVacia());
    try { localStorage.removeItem(clave); } catch { /* nada que borrar */ }
  }, [clave, pon]);

  const encender = useCallback(() => {
    document.cookie = cookieDeCapacitacion(lang);
    olvida();
    setActiva(lang);
  }, [lang, olvida]);

  const apagar = useCallback(() => {
    document.cookie = cookieDeCapacitacion(null);
    olvida();
    setActiva(null);
  }, [olvida]);

  // La cookie lleva el idioma de los avisos del servidor: si se cambia en el personalizador, se sigue.
  useEffect(() => {
    if (activa && activa !== lang) {
      document.cookie = cookieDeCapacitacion(lang);
      setActiva(lang);
    }
  }, [activa, lang]);

  // Otra pestaña pudo encenderla o apagarla: al volver a esta, manda la cookie. Si no, esta pestaña
  // enseñaría «real» mientras el navegador ya bloquea las escrituras, o al revés.
  useEffect(() => {
    const mira = () => {
      const c = capacitacionDelNavegador();
      setActiva((antes) => (!!antes === !!c ? antes : c));
    };
    window.addEventListener("focus", mira);
    document.addEventListener("visibilitychange", mira);
    return () => {
      window.removeEventListener("focus", mira);
      document.removeEventListener("visibilitychange", mira);
    };
  }, []);

  const libreta = useMemo<Libreta>(() => ({ leer: () => actual.current, cambia, ahora: () => Date.now(), nuevoId }), [cambia]);
  const valor = useMemo<Capacitacion>(() => ({ activa, encender, apagar, practica, libreta }), [activa, encender, apagar, practica, libreta]);

  return (
    <Ctx.Provider value={valor}>
      {/* Encender o apagar vuelve a montar TODO Time Tracker en el modo nuevo. */}
      <Fragment key={activa ? "practica" : "real"}>{children}</Fragment>
    </Ctx.Provider>
  );
}

/** El aviso fijo: mientras se vea, nada se guarda. Va pegado encima de la barra y se queda al bajar. */
export function AvisoDeCapacitacion() {
  const t = useT();
  const { activa, apagar } = useCapacitacion();
  if (!activa) return null;
  return (
    <div className="tt-capacitacion" role="status" data-aviso-capacitacion>
      <span>{t("training.banner")}</span>
      <button type="button" onClick={apagar}>{t("training.exit")}</button>
    </div>
  );
}
