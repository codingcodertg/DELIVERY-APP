"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import {
  APP_SETTINGS, dateISO, effBreaks, effTrackMode, effWorkerType, fmtClock, fmtClockSinSegundos, fmtHrs, fmtTime, money,
  projectWeekStart, timeAgo, weekStartISO,
} from "@/lib/timetracker/helpers";
import {
  DESKTOP_SHOT_MIN, desktopGetActivity, desktopGetContext, desktopNotifyShotStatus,
  desktopHeartbeat, desktopOnPower, desktopOnShot, desktopStart, desktopStop, isDesktop,
} from "@/lib/timetracker/desktop";
import { ackDiscarded, queueSession, queueShot, subscribeOfflineStatus } from "@/lib/timetracker/offlineQueue";
import { horaDelNegocio, pasoElCorte, tocaAvisar } from "@/lib/session-cutoff";
import { consultarExencion, useCutoffExempt } from "@/lib/use-cutoff-exempt";
import type { Assignment, BreakEvent, Session } from "@/lib/timetracker/types";
import { isOverlapError } from "@/lib/timetracker/overlap";
import { isSessionExpired, isAlreadyRunning, isAuthDenied } from "@/lib/session-guard";
import { horaCorta, minutosSinGuardar } from "@/lib/timetracker/save-state";
import {
  backoffMs, CIERRES_AUTOMATICOS, cierreHuerfana, decisionReabrir, esHuerfana, markCovers, PAGE_ORPHAN_CLOSE_NOTE, parseResumeMark, resumeKey, RESUME_MAX_MS,
  ultimoLatidoDe,
  tickContinuo,
} from "@/lib/timetracker/live-session";
import { PunchPanel } from "@/components/timetracker/PunchPanel";
import { necesitaProyecto } from "@/lib/timetracker/tienda-y-puesto";
import {
  estadoVigia, parcheDeStop, pararPorCorteSiToca, tocaReintentar, tocaSonar, VIGIA_CADA_MS,
} from "@/lib/timetracker/vigia";
import { avisoDeSistema, sonarAlarma } from "@/lib/timetracker/alarma";
import { accionDeEnergia } from "@/lib/timetracker/pausa-de-energia";
import {
  filasPendientesKey, inicioDeContinuacion, inicioSinSolape, leerFilasPendientes, nuevoPendiente, planTrasLatido,
  tocaReintentarPendiente, trasFallo, type FilaPendiente, type Pendiente,
} from "@/lib/timetracker/no-perder-tiempo";
import {
  conTope, estadoVivoAplica, estadoVivoKey, LATIDO_TIMEOUT_MS, parcheDeAlcance, parseEstadoVivo, RACHA_LIMPIA, registrarExito,
  registrarFallo, segundosHastaSanar, tocaAvisarSistema, tocaRecargar, tocaSanar, type EstadoVivo, type Racha,
} from "@/lib/timetracker/recuperacion";
import Link from "next/link";

// ============================================================
// Track Time — the core screen. Ported (D-066) from timetracker-clean's
// employee/Tracker.jsx, mechanically: same tick loop, same break/idle/
// weekly-limit logic, same live-session-conflict handling, so the already
// battle-tested behavior (44 versions of real-world fixes) carries over
// unchanged rather than being redesigned from scratch.
//
// Desktop-only branches (system-wide activity + smart-idle screen-motion via
// the Electron bridge, native screenshot capture, lock/sleep auto-stop) were
// deliberately deferred out of the first pass (D-066) — this route used to
// render only in the web build. D-074 ported them in, once the desktop
// shell's Electron main.js was repointed at this same hosted route instead
// of a locally-bundled Vite build: isDesktop() (lib/timetracker/desktop.ts)
// checks window.ttDesktop at runtime, so the exact same page now runs both
// contexts — desktop branches are simply absent (no-ops) in a plain browser
// tab, same page either way.
//
// D-074 also closed the other gaps this module comment used to list: a
// dropped connection now buffers locally (lib/timetracker/offlineQueue.ts,
// flushed on reconnect) instead of just alerting after 3 failed retries; the
// desktop shell's own auto-update banner (TtUpdateBanner, wired in
// layout.tsx) reports electron-updater's state; and notify() (weekly-limit
// warnings, "tracking started") now fires a real OS notification on web, not
// just an in-app toast — skipped on desktop, where main.js's own floating
// toast already covers the same events (see the comment on notify() in
// timetracker-data-provider.tsx).
// ============================================================

const METER_BARS = 20;
const ACTIVE_WINDOW_SEC = 12; // one input keeps you "active" this many seconds (gentler meter)
const MOVEMENT_THRESHOLD = 0.005; // >=0.5% of the sampled screen changed = "moving" (sensitive: a meeting/video counts)

/**
 * El cronómetro. Ya NO es la página (D-470): lo monta `CronometroAnfitrion` desde el layout
 * del módulo y sigue vivo —oculto— en todas las pantallas de Time Tracker. `visible` dice si
 * se está en «Registrar tiempo»; con `false` no pinta nada salvo el aviso de «no se guarda».
 * El tick, el latido, la actividad y el receptor de capturas son los mismos de antes: lo que
 * cambia es que dejar la pantalla ya no los mata.
 */
export function Cronometro({ visible = true }: { visible?: boolean }) {
  const {
    me, myAssignments: assignments, mySessions: sessions, listLiveSessions, getSession, startSession, updateSession, updateLiveSession,
    latestScreenshot, screenshotSignedUrl, uploadScreenshot, insertBlankScreenshot, notify, refrescarSesion,
  } = useData();
  const t = useT();
  // Qué mira un admin: su cronómetro o su reloj de fichaje. Para todos los demás lo decide
  // `worker_type` y no hay nada que elegir. Un admin PRESENCIAL abre en su reloj de fichaje (D-493):
  // no necesita proyecto, y abrirle el cronómetro era abrirle «Proyecto» vacío y el aviso de pedirlo.
  // El selector sigue arriba para quien quiera el cronómetro.
  const [vista, setVista] = useState<"timer" | "punch">(() => (necesitaProyecto(me) ? "timer" : "punch"));
  // Matches SSR (no window) on first render, flips true on mount if the page
  // is running inside the Electron shell — see the module comment.
  const [isDesktopClient, setIsDesktopClient] = useState(false);
  useEffect(() => { setIsDesktopClient(isDesktop()); }, []);
  const trackMode = effTrackMode(me);
  const breaksOn = effBreaks(me);
  const isInOut = trackMode === "inout";
  const LS_A = "tt_lastAssign_" + me.id;
  const LS_M = "tt_lastMemo_" + me.id;
  // A breadcrumb of the session that is still open, written on start and cleared on stop.
  // Read SYNCHRONOUSLY below so the first paint after a remount already shows Stop and a
  // running clock. Without it the view rendered "stopped" for the moment the network round
  // trip took, which reads as the timer having been lost.
  const LS_LIVE = "tt_liveSession_" + me.id;
  // A breadcrumb older than this is not a shift anyone is still in; it is one this device never
  // saw closed. Showing it produced the 25-hour clock in the screenshot: yesterday's start, still
  // counting, because the confirming call had failed and the seed was trusted anyway.
  const HINT_MAX_AGE_MS = 18 * 3600_000;
  const liveHint = (() => {
    try {
      const raw = localStorage.getItem(LS_LIVE);
      if (!raw) return null;
      const h = JSON.parse(raw) as { id: string; startMs: number; source?: string };
      if (!h || !h.id || !h.startMs) return null;
      if (Date.now() - h.startMs > HINT_MAX_AGE_MS) {
        try { localStorage.removeItem(LS_LIVE); } catch { /* ignore */ }
        return null;
      }
      return h;
    } catch { return null; }
  })();

  // La marca de reanudación (D-195): la deja este mismo cliente justo antes de descargar la
  // página (recarga del banner de actualización, pagehide) MIENTRAS conducía la sesión. Con
  // ella, si la confirmación contra el servidor falla al volver, se sigue contando y grabando
  // en vez de entrar en el modo mirón: hace un momento esta sesión era nuestra, en este
  // aparato. Caduca a los 15 minutos (RESUME_MAX_MS); sin marca, D-096 tal cual.
  const LS_RESUME = resumeKey(me.id);
  const resumeMark = (() => {
    try { return parseResumeMark(localStorage.getItem(LS_RESUME), Date.now()); } catch { return null; }
  })();

  /**
   * El estado vivo que sobrevive a una recarga suave (D-916, `recuperacion.ts`): lo escribe cada
   * latido y la propia recarga. Solo vale si es de hace menos de dos minutos: entonces esta misma
   * app estuvo contando hasta hace un momento y sus números son los buenos. Más viejo, se ignora y
   * manda D-246 (el hueco no se paga).
   */
  const LS_ESTADO_VIVO = estadoVivoKey(me.id);
  const estadoVivoGuardado = (() => {
    try { return parseEstadoVivo(localStorage.getItem(LS_ESTADO_VIVO), Date.now()); } catch { return null; }
  })();

  const [assignmentId, setAssignmentId] = useState(() => {
    try { return localStorage.getItem(LS_A) || ""; } catch { return ""; }
  });
  const [memo, setMemo] = useState(() => {
    try { return localStorage.getItem(LS_M) || ""; } catch { return ""; }
  });
  // Seeded from the breadcrumb, not false — the adoption effect below confirms it against the
  // server and clears it if the session turns out to be closed. Optimistic, then reconciled.
  const [running, setRunning] = useState(!!liveHint);
  /**
   * The session is running, but on the OTHER client — desktop when you are on the web, or the web
   * when you are on the desktop.
   *
   * Both clients used to treat any live session as theirs to drive: the tick writes endMs,
   * durationSeconds, activeSeconds, keystrokes and clicks to the row every ten seconds. With the
   * desktop app and a browser tab both open on one account, the two took turns overwriting each
   * other, and the browser wins the ones it cannot measure — a tab cannot see input to other
   * windows, so it was posting 0% activity over the desktop's real numbers.
   *
   * So a client only drives a session that its own kind started (`source`). The other one watches:
   * same clock, from the same startMs, and no writes at all.
   */
  // isDesktop() and not the isDesktopClient state: that state is false until its own effect runs,
  // which would make the desktop app announce that the desktop app is tracking. The breadcrumb is
  // read the same way one line above, so both agree about SSR (no window, no hint, no banner).
  const [remoteOwner, setRemoteOwner] = useState<"desktop" | "web" | null>(() => {
    if (!liveHint?.source) return null;
    const mine = isDesktop() ? "desktop" : "timer";
    return liveHint.source === mine ? null : (liveHint.source === "desktop" ? "desktop" : "web");
  });
  const [worked, setWorked] = useState(liveHint ? Math.floor((Date.now() - liveHint.startMs) / 1000) : 0);
  const [onBreak, setOnBreak] = useState<"lunch" | "break" | null>(null);
  const [breaks, setBreaks] = useState({ lunch: 0, brk: 0 });
  const [breakList, setBreakList] = useState<BreakEvent[]>([]);
  const [activePct, setActivePct] = useState(0);
  const [meter, setMeter] = useState<boolean[]>(() => new Array(METER_BARS).fill(false));

  const breakEventsRef = useRef<BreakEvent[]>([]);
  // Seeded from the breadcrumb for the same reason `running` is, and for one more: Stop needs an
  // id. The adoption effect below fills these from the server, but it is a round trip, and Stop
  // pressed before it lands used to find a null id, write nothing, and leave the row open forever.
  const sessionIdRef = useRef<string | null>(liveHint?.id ?? null);
  const startMsRef = useRef(liveHint?.startMs ?? 0);
  /**
   * ¿Esta página CONDUCE la sesión? (D-470)
   *
   * Tener el id no es conducirla: recién montada, la pantalla solo tiene la miga de
   * `localStorage` (id y hora de arranque) y sus contadores valen cero. Se pone a `true` al
   * arrancar, al adoptar con la fila delante, al reabrir y al reanudar con marca; a `false` al
   * parar y en el modo mirón. Lo leen Stop (`parcheDeStop`) y el vigía.
   */
  const conduceRef = useRef(false);
  /**
   * Que el reloj nunca cuente en el vacío (D-875, `lib/timetracker/no-perder-tiempo.ts`).
   *
   *  · `pendienteRef` — un INSERT que todavía no entró: el reloj ya cuenta desde `desdeMs` y
   *    la fila se reintenta con espera creciente hasta que la base la acepte.
   *  · `guardadoHastaRef` / `guardadoNetoRef` — el `endMs` y la duración del último latido que
   *    SÍ entró: hasta ahí la fila actual lo tiene, y desde ahí continúa la siguiente.
   *  · `filaBaseRef` — proyecto, asignación y nota de la fila en curso, para abrir la que la
   *    continúa sin depender del estado de React (el tick corre con un cierre viejo).
   *  · `arrastre` — los segundos ya guardados en filas anteriores de esta misma tanda: el reloj
   *    de pantalla no vuelve a 0:00 cuando una fila cerrada se continúa en otra.
   */
  const pendienteRef = useRef<Pendiente | null>(null);
  const insertandoRef = useRef(false);
  const guardadoHastaRef = useRef<number | null>(null);
  const guardadoNetoRef = useRef(0);
  const filaBaseRef = useRef<Partial<Session> | null>(null);
  const arrastreRef = useRef(0);
  const [arrastre, setArrastre] = useState(0);
  const misSesionesRef = useRef<Session[]>([]);
  misSesionesRef.current = sessions;
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Continuidad del tick (CAMBIOS del auditor sobre D-197). `lastTickRef` es el instante del
  // último tick; si el siguiente llega más de LATIDO_MAX_MS después, el reloj estuvo parado
  // (equipo suspendido, pestaña estrangulada) y `continuoRef` se apaga: la marca de reanudación
  // deja de refrescarse y se borra, y sin marca no hay reapertura. Vuelve a `true` solo al
  // arrancar, al adoptar con confirmación del servidor, y en la reanudación con marca.
  const lastTickRef = useRef<number | null>(null);
  const continuoRef = useRef(true);
  const reiniciarContinuidad = () => { lastTickRef.current = null; continuoRef.current = true; };
  const onBreakRef = useRef<"lunch" | "break" | null>(null);
  const lunchRef = useRef(0);
  const brkRef = useRef(0);

  const keystrokesRef = useRef(0);
  const clicksRef = useRef(0);
  const activeSecondsRef = useRef(0);
  const secHadEventRef = useRef(false);
  const lastActTotalRef = useRef(0); // last keystrokes+clicks+moves total (desktop delta)
  // Segundos que no se pagan sin ser comida ni descanso. Sigue sin haber límite de inactividad
  // que pare solo; lo único que lo mueve es una pausa de energía (D-510), y `netSeconds` lo resta.
  const idleRef = useRef(0);
  const activeWindowRef = useRef(0);
  const [isIdle, setIsIdle] = useState(false);
  const [ctxApp, setCtxApp] = useState(""); // app recognized via on-screen motion (desktop smart-idle)
  const ctxRef = useRef<{ app: string; title: string; movement: number } | null>(null);
  const ctxProbeRef = useRef(0); // countdown to next context probe

  const selected = assignments.find((a) => a.id === assignmentId);
  const wsd = selected ? projectWeekStart(selected.project) : undefined;
  const wStart = weekStartISO(new Date(), wsd);
  const weekSecThisProj = useMemo(() => {
    if (!selected) return 0;
    return sessions
      .filter((s) => weekStartISO(s.date ?? "", wsd) === wStart && s.assignmentId === selected.id)
      .reduce((n, s) => n + (s.durationSeconds || 0), 0);
  }, [sessions, selected, wStart, wsd]);
  const wLimitSec = selected && selected.weeklyLimit !== null && selected.weeklyLimit !== undefined
    ? Number(selected.weeklyLimit) * 3600 : Infinity;
  const overLimit = weekSecThisProj + worked > wLimitSec;

  useEffect(() => {
    if (assignmentId && assignments.length && !assignments.find((a) => a.id === assignmentId)) setAssignmentId("");
  }, [assignments, assignmentId]);

  // reset the weekly-limit notification latches when the project changes
  const limitHitRef = useRef(false);
  const nearHitRef = useRef(false);
  useEffect(() => { limitHitRef.current = false; nearHitRef.current = false; }, [assignmentId]);

  // notify when the employee reaches (or nears 90% of) their weekly limit —
  // the banner already shows this on screen; notify() additionally reaches
  // them via a real OS notification if they've alt-tabbed away (D-074).
  useEffect(() => {
    if (!selected || wLimitSec === Infinity) return;
    const usedSec = weekSecThisProj + worked;
    if (usedSec >= wLimitSec && !limitHitRef.current) {
      limitHitRef.current = true; nearHitRef.current = true;
      notify(t("notify.limitTitle") + ": " + t("notify.limitBody", { limit: (wLimitSec / 3600).toFixed(2), project: selected.project.name }));
    } else if (usedSec >= wLimitSec * 0.9 && usedSec < wLimitSec && !nearHitRef.current) {
      nearHitRef.current = true;
      notify(t("notify.nearTitle") + ": " + t("notify.nearBody", { used: (usedSec / 3600).toFixed(2), limit: (wLimitSec / 3600).toFixed(2), project: selected.project.name }));
    }
  }, [worked, weekSecThisProj, selected, wLimitSec, notify, t]);

  useEffect(() => { try { if (assignmentId) localStorage.setItem(LS_A, assignmentId); } catch { /* ignore */ } }, [assignmentId, LS_A]);
  useEffect(() => { try { localStorage.setItem(LS_M, memo); } catch { /* ignore */ } }, [memo, LS_M]);

  // Hasta D-195 aquí había un `beforeunload` que pedía confirmación al navegador si el reloj
  // corría. Con el último latido y la marca de reanudación de abajo ya no protegía nada, y
  // podía enseñar el diálogo "¿salir?" justo cuando el banner de actualización recarga: lo
  // contrario de lo que pidió el dueño ("sí quiero poder actualizar"). Se quitó a propósito.

  /**
   * Antes de descargar la página, dejarlo todo grabado (D-195).
   *
   * El tick escribe cada diez segundos; en una recarga o un cierre esos segundos se perdían y,
   * peor, sin latido reciente la siguiente apertura podía dar la sesión por huérfana. Aquí va
   * el último latido por `sendBeacon` —lo único que el navegador garantiza durante `pagehide`—
   * a la ruta /timetracker/api/heartbeat (misma cookie de sesión, solo la fila propia y viva),
   * y la marca de reanudación local. Solo si ESTE cliente conduce la sesión: un mirón no graba.
   *
   * Se escucha `pagehide` (recarga, cierre de pestaña, F5 del escritorio: `webContents.reload()`
   * también lo dispara) y `rtg:before-reload`, que el banner de actualización emite justo antes
   * de recargar. Es un aviso, no un freno: la actualización se hace igual.
   */
  const grabarAntesDeSalir = () => {
    const id = sessionIdRef.current;
    if (!runningRef.current || remoteOwnerRef.current || !id) return;
    const el = Math.floor((Date.now() - startMsRef.current) / 1000);
    const patch = {
      id,
      endMs: Date.now(),
      durationSeconds: netSeconds(el),
      activeSeconds: activeSecondsRef.current,
      idleSeconds: idleRef.current,
      liveNote: onBreakRef.current ? "break" : "active",
      keystrokes: keystrokesRef.current,
      clicks: clicksRef.current,
      lunchSeconds: lunchRef.current,
      breakSeconds: brkRef.current,
      breakEvents: breakEventsPayload(),
    };
    // La marca solo se escribe mientras la continuidad se conserve (CAMBIOS del auditor sobre
    // D-197): tras un hueco, `pagehide` no la fabrica de nuevo; si no, dormir 8 h, despertar sin
    // red y recargar la habría resucitado, y `reanudarConMarca` la habría dado por buena. El
    // beacon sí sale igual: la ruta filtra por is_live y no puede hacer daño.
    if (continuoRef.current) {
      try { localStorage.setItem(LS_RESUME, JSON.stringify({ sessionId: id, at: Date.now() })); } catch { /* ignore */ }
    } else {
      try { localStorage.removeItem(LS_RESUME); } catch { /* ignore */ }
    }
    try {
      if (typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/timetracker/api/heartbeat", new Blob([JSON.stringify(patch)], { type: "text/plain" }));
      }
    } catch { /* el beacon es lo mejor que hay; si no sale, la marca y la base siguen ahí */ }
  };
  const grabarRef = useRef(grabarAntesDeSalir);
  grabarRef.current = grabarAntesDeSalir;
  useEffect(() => {
    const h = () => grabarRef.current();
    window.addEventListener("pagehide", h);
    window.addEventListener("rtg:before-reload", h);
    return () => { window.removeEventListener("pagehide", h); window.removeEventListener("rtg:before-reload", h); };
  }, []);

  // Web metering: focus-gated input listeners — only count while this tab is
  // focused (browser limitation, same as the original's web build).
  useEffect(() => {
    if (!running) return;
    const onKey = () => { if (document.hasFocus()) { keystrokesRef.current++; secHadEventRef.current = true; } };
    const onClick = () => { if (document.hasFocus()) { clicksRef.current++; secHadEventRef.current = true; } };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, [running]);

  // Al desmontarse (salir del módulo con una navegación de cliente) también se deja grabado
  // el último latido y la marca: `pagehide` no dispara en ese caso (D-470).
  useEffect(() => () => { grabarRef.current(); if (tickRef.current) clearInterval(tickRef.current); }, []);

  const shotMin = Number(APP_SETTINGS.screenshotIntervalMin) || DESKTOP_SHOT_MIN;
  const smartIdle = APP_SETTINGS.smartIdle !== false;

  // Desktop screenshot pipeline: main.js captures the screen and hands us a
  // dataUrl over IPC; the renderer (here) owns the authenticated Supabase
  // client, so it does the upload. Registered once — not tied to `running`,
  // so a shot that arrives right at stop() is never dropped.
  const runningRef = useRef(false);
  runningRef.current = running;
  useEffect(() => {
    return desktopOnShot(async (data) => {
      const at = Date.now();
      if (data?.blank) {
        try { await insertBlankScreenshot({ employeeUid: me.id, sessionId: data.sessionId, date: dateISO(at) }); }
        catch (e) { console.error("blank slot insert failed", e); }
        return;
      }
      if (!data?.dataUrl) return;
      const res = await fetch(data.dataUrl);
      const blob = await res.blob();
      const rec = { employeeUid: me.id, sessionId: data.sessionId, blob, date: dateISO(at), activityPercent: data.activityPercent || 0 };
      try {
        if (!navigator.onLine) throw new Error("offline");
        await uploadScreenshot(rec);
        desktopNotifyShotStatus("saved");
      } catch (e) {
        // Offline or the upload failed — buffer the image locally and sync
        // later, instead of losing the capture.
        console.error("screenshot upload failed, queueing", e);
        const queued = await queueShot(rec);
        desktopNotifyShotStatus(queued ? "queued" : "error");
      }
    });
  }, [me.id, uploadScreenshot, insertBlankScreenshot]);

  // Bloqueo y suspensión (escritorio): el tiempo fuera del teclado no se paga, pero un parpadeo
  // de energía NO termina la jornada (D-510). La regla, con sus medidas, está en
  // `src/lib/timetracker/pausa-de-energia.ts`; aquí solo se obedece. Live refs (updated every
  // render, below) avoid both a stale closure and re-subscribing on every render.
  const stopRef = useRef<() => void>(() => {});
  // Live mirror of remoteOwner, for the callbacks that run outside React's render (the lock/sleep
  // hook and the tick) and would otherwise close over a stale value.
  const remoteOwnerRef = useRef<"desktop" | "web" | null>(null);
  remoteOwnerRef.current = remoteOwner;
  const pausaDeEnergiaRef = useRef<number | null>(null);
  useEffect(() => {
    return desktopOnPower((reason) => {
      const accion = accionDeEnergia({
        evento: reason,
        ahoraMs: Date.now(),
        pausadoDesdeMs: pausaDeEnergiaRef.current,
        corriendo: runningRef.current,
      });
      if (accion.tipo === "nada") return;
      if (accion.tipo === "pausa") { pausaDeEnergiaRef.current = accion.desdeMs; return; }

      pausaDeEnergiaRef.current = null;
      if (accion.tipo === "sigue") {
        // Misma fila: los segundos de fuera van a inactividad, que `netSeconds` resta.
        idleRef.current += accion.fueraSegundos;
        notify(`Welcome back — ${accion.fueraSegundos}s away wasn't counted. Still on the clock.`);
        return;
      }
      // Más allá de la gracia YA NO SE PARA (2026-11-05): parar en silencio al despertar costó
      // al dueño 8 y 35 minutos el mismo día, con la pantalla en apariencia «corriendo». La fila
      // vieja se queda como quedó en su último latido antes de dormir y el reloj sigue en una
      // fila nueva que empieza AHORA: el sueño no cae en ninguna fila (D-098).
      continuarTrasDormirRef.current(accion.fueraSegundos);
    });
  }, [notify]);

  /**
   * Lo que puede pasarle a un latido. `true` guardó; `"queued"` es la red y se recupera sola;
   * `"overlap"`, `"auth"` y `"cerrada"` NO se recuperan solos y por eso se ven en pantalla.
   */
  type EscrituraLatido = boolean | "queued" | "overlap" | "auth" | "cerrada";

  function netSeconds(el: number): number { return Math.max(0, el - lunchRef.current - brkRef.current - idleRef.current); }
  function breakEventsPayload() { return breakEventsRef.current.map((e) => ({ kind: e.kind, start: e.start, end: e.end || null })); }

  // Persist a session update. Retries a few times on transient failures; if
  // every retry fails (offline, or a transient server error), the patch is
  // buffered locally via the offline queue and synced on reconnect — the
  // tracker keeps counting from local refs regardless, so the buffered patch
  // always carries the full up-to-date duration once it flushes.
  // `soloViva` (D-197): el tick escribe con updateLiveSession, que filtra por is_live = true, para
  // no retocar end_ms/duration_seconds de una fila que el cron ya cerró (tras despertar, por
  // ejemplo). Stop escribe is_live = false a propósito y sigue por updateSession: cerrar tiene
  // que funcionar. Y desde D-241 la cola también reenvía por la vía viva, así que el límite que
  // aquí se daba por conocido —un parche encolado pisando una fila ya cerrada— ya no existe.
  // Por ref (D-916): el tick corre con un cierre viejo, y si la recuperación rehace el cliente de
  // Supabase, el latido tiene que salir por el nuevo, no por el atascado.
  const opsRef = useRef({ updateSession, updateLiveSession });
  opsRef.current = { updateSession, updateLiveSession };
  async function writeSession(id: string, patch: Partial<Session>, tries = 3, soloViva = false): Promise<EscrituraLatido> {
    for (let i = 0; i < tries; i++) {
      try {
        const { updateSession, updateLiveSession } = opsRef.current;
        if (!soloViva) { await updateSession(id, patch); return true; }
        // La vía viva dice ADEMÁS si había fila que actualizar (D-241). Cero filas no es un
        // error para PostgREST, así que sin esta respuesta un latido contra una sesión ya
        // cerrada —o ya en nómina— volvía «bien» y el reloj seguía como si guardara.
        // Con tope (D-916): un `fetch` que se queda colgado tras un cambio de red no es un latido
        // en vuelo, es un latido perdido, y tiene que contar como fallo para que la racha sane.
        return (await conTope(updateLiveSession(id, patch), LATIDO_TIMEOUT_MS)) ? true : "cerrada";
      }
      catch (e) {
        // Un solape (082) no se arregla esperando: la base lo va a rechazar igual
        // dentro de una hora. Encolarlo sería reintentar en silencio para siempre
        // mientras el reloj sigue en pantalla como si estuviera guardando.
        if (isOverlapError(e)) return "overlap";
        // Una sesión caducada tampoco se arregla esperando (D-241). El proveedor ya reintentó
        // con token fresco antes de llegar aquí, así que esto es un no definitivo: reintentar
        // tres veces más con medio segundo entre medias no va a resucitar el JWT.
        //
        // El parche SÍ se encola, y esa parte de D-074 estaba bien: si la persona vuelve a
        // entrar, el `flush` lo aplica con la duración completa y el tramo se recupera. Lo que
        // estaba mal era devolver `"queued"` y callar, porque una cola se vacía sola cuando lo
        // que falló es la red y NO se vacía sola cuando lo que falló es la sesión. Se encola y
        // se dice, que son dos cosas distintas.
        if (isAuthDenied(e)) { queueSession(id, patch); return "auth"; }
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    queueSession(id, patch);
    return "queued";
  }


  // Re-adopt a session that is still running server-side.
  //
  // The bug this fixes: `running` starts false and nothing rehydrated it, so leaving the Time view
  // and coming back showed Start instead of Stop — while the row in the database was still
  // isLive. Pressing Start then found that row via listLiveSessions(), did not recognise it as
  // ours (sessionIdRef was null after the remount), and asked whether to close "another" session.
  // The clock had never stopped; only this component had forgotten about it.
  //
  // Runs once on mount. Every accumulator is restored from the row rather than reset, so the
  // seconds, breaks and input counts continue from where they were instead of restarting at zero.
  // Elapsed time needs no restoring: the tick derives it from startMs.
  const adoptedRef = useRef(false);
  // Set the instant Stop is pressed. The adoption effect is async, so without this it could land
  // AFTER a stop and set running=true again from the row it had already fetched — the button
  // looking like it did nothing, because a second later the session came back.
  const stoppedRef = useRef(false);
  /**
   * La adopción, como función que se puede volver a llamar (D-470).
   *
   * Antes era el cuerpo de un efecto que corría una vez: si esa única llamada fallaba, la
   * pantalla se quedaba enseñando un reloj que no grababa nada hasta que alguien recargara.
   * Ahora el vigía la repite (`reintento = true`) mientras nadie conduzca la sesión.
   */
  const adoptandoRef = useRef(false);
  async function adoptar(estaCancelado: () => boolean, reintento = false) {
    if (adoptandoRef.current) return;
    adoptandoRef.current = true;
    {
      try {
        // listLiveSessions() is already scoped to this employee (employee_uid = me.id in the
        // provider), so the first row is ours by construction — no need to re-filter on a
        // camel-cased field and risk a silent no-op if that mapping ever changes.
        const [mine] = await listLiveSessions();
        if (estaCancelado()) return;
        if (stoppedRef.current) {
          // Stopped while this was in flight. If a row is still open it is one Stop could not
          // reach — close it here rather than adopting it, which would undo the stop on screen.
          if (mine && mine.id !== sessionIdRef.current) {
            updateSession(mine.id, { endMs: Date.now(), isLive: false }).catch(() => {});
          }
          return;
        }
        if (!mine) {
          // The breadcrumb was stale — stopped on another device, or the row was closed for us.
          // Undo the optimistic seed rather than leaving a clock running against nothing.
          try { localStorage.removeItem(LS_LIVE); } catch { /* ignore */ }
          if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
          conduceRef.current = false;
          sessionIdRef.current = null;
          setRunning(false);
          setWorked(0);
          return;
        }

        // ¿Sigue viva de verdad, o es un huérfano? El tick escribe endMs cada diez
        // segundos mientras corre, así que una sesión "viva" cuyo último latido es de hace
        // horas es una que perdió a su cliente: la computadora se apagó, el navegador se
        // cerró, la app se cayó. Nadie la va a parar nunca.
        //
        // Adoptarla es lo que hacía que abrir la app al día siguiente mostrara el
        // cronómetro corriendo desde ayer. Y peor: seguía contando desde su arranque, así
        // que una noche con la máquina apagada entraba en la nómina como trabajada — 10.42 h
        // en el caso que destapó esto, con cero segundos de actividad.
        //
        // Se cierra en su ÚLTIMO LATIDO, no ahora: lo que grabó es lo que se le paga, y las
        // horas que la máquina pasó apagada no son suyas.
        //
        // El umbral y la aritmética del cierre viven en lib/timetracker/live-session.ts, que
        // comparten esta pantalla y el cron que cierra huérfanas (D-195). Eran 5 minutos;
        // son 15 para que un cierre corto (reinicio, actualización) no corte la sesión.
        // La recarga suave de la recuperación (D-916): si el estado vivo guardado es de ESTA fila y
        // de hace un momento, se continúa la misma sesión con los números que la app tenía en memoria
        // —sea la fila viva o huérfana— y el primer latido los lleva a la base. Nada que medir se
        // perdió: la app estuvo viva contando hasta que se recargó.
        if (estadoVivoAplica(estadoVivoGuardado, mine.id) && !theirsDe(mine)) {
          if (await continuarConEstadoVivo(mine, estadoVivoGuardado)) return;
        }

        if (esHuerfana(mine, Date.now())) {
          // **Antes de cerrar, mirar si hay que reabrir** (D-246). Este orden es el arreglo
          // entero: hasta aquí se cerraba y se borraba la marca en el mismo paso, así que la
          // reapertura tras una recarga era imposible aunque D-241 dijera que estaba permitida
          // — la prueba se destruía antes de consultarla. El dueño perdió cuatro horas por esto.
          //
          // La marca es la evidencia en este caso, y no el tick: la página acaba de arrancar,
          // así que no hay tick, ni `running`, ni id en memoria. Ver `ContextoReapertura`.
          // La marca se lee **sin el tope de 15 minutos**: aquí el límite es la jornada, y lo
          // aplica `decisionReabrir`. Con el tope de siempre la ventana era vacía —cuando la
          // fila es huérfana la marca tiene la misma edad, porque las escribe el mismo tick—.
          let marca = null;
          try { marca = parseResumeMark(localStorage.getItem(LS_RESUME), Date.now(), Number.POSITIVE_INFINITY); } catch { marca = null; }
          // La fila **tal como está en la base**: viva, con el `live_note` del último tick. Pasar
          // aquí una nota de cierre que todavía no existe era preguntar por algo que la página
          // escribe dos líneas más abajo, y por eso no se reabría nunca.
          const dec = decisionReabrir({
            fila: { id: mine.id, employeeUid: me.id, isLive: !!mine.isLive, liveNote: mine.liveNote ?? null, startMs: mine.startMs ?? null },
            me: me.id, mark: marca, evidenciaLocal: false, otrasVivas: [], contexto: "tras-carga",
          });

          if (dec.reabrir) {
            const desdeMs = ultimoLatidoDe(mine);
            const reabierta = await reabrirTrasCarga(mine, desdeMs);
            if (reabierta) return;
            // Si la base la rechaza (solape, otra viva), se sigue al cierre de siempre.
          }

          // Con marca propia (D-241): este cierre lo decide una máquina, igual que el del
          // cron, y `decisionReabrir` tiene que poder distinguirlo de un Stop. Sin ella, la
          // fila se quedaba con el `live_note` del último latido —`active` en el caso del
          // dueño— y se leía como «la cerró una persona».
          await updateSession(mine.id, { ...cierreHuerfana(mine), liveNote: PAGE_ORPHAN_CLOSE_NOTE }).catch(() => {});
          // La marca se borra **aquí**, cuando ya se decidió que no se reabre. Borrarla antes
          // era tirar la prueba antes de leerla.
          try { localStorage.removeItem(LS_LIVE); localStorage.removeItem(LS_RESUME); } catch { /* ignore */ }
          if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
          conduceRef.current = false;
          sessionIdRef.current = null;
          setRunning(false);
          setWorked(0);
          notify(t("track.orphanClosed"));
          return;
        }

        sessionIdRef.current = mine.id;
        startMsRef.current = mine.startMs || Date.now();
        filaBaseRef.current = baseDe(mine);
        guardadoHastaRef.current = mine.endMs ?? null;
        guardadoNetoRef.current = mine.durationSeconds || 0;
        ponerArrastre(0);
        // Whose session is it? A client drives only what its own kind started; see remoteOwner.
        const mineKind = isDesktop() ? "desktop" : "timer";
        const theirs = (mine.source === "desktop" || mine.source === "timer") && mine.source !== mineKind;
        setRemoteOwner(theirs ? (mine.source === "desktop" ? "desktop" : "web") : null);
        try { localStorage.setItem(LS_LIVE, JSON.stringify({ id: mine.id, startMs: startMsRef.current, source: mine.source })); } catch { /* ignore */ }
        // Confirmada contra el servidor: la marca de reanudación ya cumplió.
        try { localStorage.removeItem(LS_RESUME); } catch { /* ignore */ }
        lunchRef.current = mine.lunchSeconds || 0;
        brkRef.current = mine.breakSeconds || 0;
        breakEventsRef.current = mine.breakEvents || [];
        keystrokesRef.current = mine.keystrokes || 0;
        clicksRef.current = mine.clicks || 0;
        activeSecondsRef.current = mine.activeSeconds || 0;
        onBreakRef.current = null;

        if (mine.assignmentId) setAssignmentId(mine.assignmentId);
        setMemo(mine.memo || "");
        setBreaks({ lunch: mine.lunchSeconds || 0, brk: mine.breakSeconds || 0 });
        setBreakList(mine.breakEvents || []);
        setWorked(Math.floor((Date.now() - (mine.startMs || Date.now())) / 1000));
        setOnBreak(null);
        setRunning(true);

        if (theirs) {
          // Somebody else's clock. Show it, do not drive it: no screenshot timer, no activity
          // metering, and above all none of beginTicking()'s ten-second writes, which would post
          // this client's blind numbers over the owner's real ones. watchRemote() below just keeps
          // the elapsed time moving and notices when the owner stops.
          watchRemote(mine.startMs || Date.now(), mine.id);
          return;
        }

        // The desktop shell lost its screenshot timer with the old renderer; re-arm it against
        // the same session so shots keep landing on the row that is actually open.
        desktopStart({ sessionId: mine.id, intervalMin: shotMin });
        reiniciarContinuidad();
        // Confirmada con la fila delante: desde aquí esta página la conduce, y el suelo del
        // vigía es ahora (el primer latido llega en diez segundos).
        conduceRef.current = true;
        ultimoGuardadoRef.current = Date.now();
        beginTicking();
      } catch {
        // Offline, or the call failed. Two wrong answers were tried here before this one: doing
        // nothing froze the clock at the second the page mounted, and beginTicking() unfroze it by
        // WRITING every ten seconds to a session nothing had confirmed — which is how a browser
        // tab came to post its blind numbers over a session the desktop app was running.
        //
        // So: show the clock, write nothing, and let the poll settle it. Within twenty seconds it
        // either finds the session still live and keeps counting, or clears it.
        //
        // Salvo con marca de reanudación reciente para ESTA sesión (D-195): entonces sí se
        // conduce. La marca la dejó este cliente hace menos de 15 min mientras conducía esta
        // misma sesión, así que no es la "blind tab" del párrafo de arriba: es la misma pestaña
        // tras la actualización. Se sigue contando y grabando (writeSession encola si no hay
        // red) y se confirma con backoff; si la confirmación dice que ya no está viva, se para.
        if (estaCancelado() || stoppedRef.current || !liveHint) return;
        // En un reintento no se rearma nada: el modo en que quedó (mirón o reanudado con marca)
        // ya tiene su propio reloj, y el vigía volverá a llamar dentro de veinte segundos.
        if (reintento) return;
        if (markCovers(resumeMark, liveHint.id) && !remoteOwnerRef.current) reanudarConMarca(liveHint.id, liveHint.startMs);
        else watchRemote(liveHint.startMs, liveHint.id);
      } finally {
        adoptandoRef.current = false;
      }
    }
  }
  const adoptarRef = useRef(adoptar);
  adoptarRef.current = adoptar;
  useEffect(() => {
    if (adoptedRef.current || !me?.id) return;
    adoptedRef.current = true;
    let cancelado = false;
    // Con miga, el suelo del vigía es este momento: si en un minuto nadie ha confirmado ni
    // grabado nada, el reloj que se ve no corresponde a nada y hay que decirlo.
    if (liveHint) ultimoGuardadoRef.current = Date.now();
    void adoptar(() => cancelado);
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  /**
   * The read-only clock, for a session the other client owns.
   *
   * Deliberately almost nothing: a second hand derived from the owner's startMs — which is what
   * keeps the two screens showing the same number — and a poll for whether the owner has stopped.
   * No activity sampling and no writes, because everything this client could measure about a
   * session running elsewhere would be wrong.
   */
  function watchRemote(startMs: number, id: string) {
    conduceRef.current = false;
    startMsRef.current = startMs;
    setWorked(Math.floor((Date.now() - startMs) / 1000));
    if (tickRef.current) clearInterval(tickRef.current);
    let sinceCheck = 0;
    tickRef.current = setInterval(async () => {
      setWorked(Math.floor((Date.now() - startMsRef.current) / 1000));
      sinceCheck += 1;
      if (sinceCheck < 20) return;          // ask every 20s, not every second
      sinceCheck = 0;
      try {
        const live = await listLiveSessions();
        if (live.some((x) => x.id === id)) return;
        // The owner stopped. Clear rather than leave a clock running against nothing.
        if (tickRef.current) clearInterval(tickRef.current);
        tickRef.current = null;
        sessionIdRef.current = null;
        try { localStorage.removeItem(LS_LIVE); } catch { /* ignore */ }
        setRemoteOwner(null);
        setRunning(false);
        setWorked(0);
      } catch { /* offline — keep showing the clock, ask again in 20s */ }
    }, 1000);
  }

  /** ¿La fila la conduce el otro cliente? (D-096) */
  function theirsDe(s: Session): boolean {
    const mineKind = isDesktop() ? "desktop" : "timer";
    return (s.source === "desktop" || s.source === "timer") && s.source !== mineKind;
  }

  /**
   * Continuar la MISMA sesión tras una recarga suave (D-916).
   *
   * La fila puede estar viva (los latidos fallaban pero el cron aún no la cerró) o cerrada por
   * el cron (`closed:cron`); un Stop no se deshace nunca. Los contadores salen del estado vivo
   * guardado, no de la fila: la fila tiene lo de la última escritura buena, y el estado tiene lo
   * que se midió después. El arranque es el de siempre, así que `Date.now() - startMs` sigue
   * valiendo lo que marcaba el reloj de arriba. Y el latido de alcance sale ya, no a los diez
   * segundos. Si la base rechaza la reapertura (092/082), se sigue por el camino de siempre.
   */
  async function continuarConEstadoVivo(mine: Session, e: EstadoVivo): Promise<boolean> {
    if (!mine.isLive && !CIERRES_AUTOMATICOS.includes(mine.liveNote ?? "")) return false;
    const ahora = Date.now();
    const alcance = parcheDeAlcance(e, ahora);
    try {
      await updateSession(mine.id, { ...alcance, isLive: true });
    } catch {
      return false;
    }
    sessionIdRef.current = mine.id;
    filaBaseRef.current = baseDe(mine);
    startMsRef.current = e.startMs;
    guardadoHastaRef.current = ahora;
    guardadoNetoRef.current = alcance.durationSeconds;
    ponerArrastre(e.arrastre);
    setRemoteOwner(null);
    try { localStorage.setItem(LS_LIVE, JSON.stringify({ id: mine.id, startMs: e.startMs, source: mine.source })); } catch { /* ignore */ }
    try { localStorage.removeItem(LS_RESUME); } catch { /* ignore */ }
    lunchRef.current = e.lunchSeconds;
    brkRef.current = e.breakSeconds;
    idleRef.current = e.idleSeconds;
    breakEventsRef.current = e.breakEvents.map((b) => ({ ...b }));
    keystrokesRef.current = e.keystrokes;
    clicksRef.current = e.clicks;
    activeSecondsRef.current = e.activeSeconds;
    lastActTotalRef.current = 0;
    onBreakRef.current = null;
    if (mine.assignmentId) setAssignmentId(mine.assignmentId);
    setMemo(mine.memo || "");
    setBreaks({ lunch: e.lunchSeconds, brk: e.breakSeconds });
    setBreakList(breakEventsRef.current);
    setWorked(alcance.durationSeconds);
    setOnBreak(null);
    setRunning(true);
    desktopStart({ sessionId: mine.id, intervalMin: shotMin });
    reiniciarContinuidad();
    conduceRef.current = true;
    ultimoGuardadoRef.current = ahora;
    rachaRef.current = registrarExito();
    setRacha(rachaRef.current);
    limpiarSinGuardar();
    beginTicking();
    notify(t("track.healCaughtUp", { min: String(Math.max(0, Math.round((ahora - (e.guardadoHastaMs ?? ahora)) / 60_000))) }));
    return true;
  }

  /**
   * Reabrir una sesión que el cron cerró mientras se trabajaba SIN INTERNET (D-197).
   *
   * El tick sigue contando sin red (desde startMs; las escrituras van a la cola offline). Si
   * pasan más de 15 min sin latido en la base, el cron de D-195 la cierra en su último latido.
   * Al volver la red, hoy la confirmación la encontraba cerrada y paraba: el tramo trabajado
   * sin red se perdía. Esto lo deshace SOLO cuando se cumplen las cuatro condiciones de
   * `decisionReabrir` (es mi fila, la cerró el cron, hay marca reciente para ella y el tick de
   * esta página sigue corriendo, y no hay otra viva). Si la cerró una persona o un Stop, no.
   *
   * La base tiene la última palabra: una sola viva por persona (092) y sin solapes (082).
   * Si el UPDATE choca con cualquiera de las dos, no se reabre y se avisa.
   */
  /**
   * Reabrir una sesión que la propia pantalla iba a cerrar al arrancar (D-246).
   *
   * El caso: crash o «Reload app» a media jornada. La fila queda viva sin latidos, al cargar se
   * ve huérfana, y hasta ahora se cerraba en su último latido — perdiendo todo lo trabajado
   * después. Cuatro horas, en el incidente que lo destapó.
   *
   * **El tramo sin latidos NO se inventa.** Del último latido a ahora no hay ninguna evidencia
   * de que se estuviera trabajando —ni actividad, ni capturas, nada— y rellenarlo sería pagar
   * un hueco por si acaso, que es exactamente lo que D-098 prohibió. Así que el reloj sigue
   * desde donde se quedó: se adelanta el arranque tantos milisegundos como duró el hueco, y el
   * tiempo que se enseña no lo incluye. La pantalla lo dice con las dos horas.
   */
  async function reabrirTrasCarga(mine: Session, ultimoLatido: number): Promise<boolean> {
    const hueco = Math.max(0, Date.now() - ultimoLatido);
    try {
      await updateSession(mine.id, { isLive: true, liveNote: "reopened" });
    } catch {
      return false; // solape, otra viva, o sin red: se sigue al cierre de siempre
    }

    sessionIdRef.current = mine.id;
    filaBaseRef.current = baseDe(mine);
    // El hueco no se paga: si esta fila vuelve a cerrarse, la siguiente arranca entonces.
    guardadoHastaRef.current = null;
    guardadoNetoRef.current = mine.durationSeconds || 0;
    ponerArrastre(0);
    // El arranque se corre hacia delante lo que duró el hueco: así `Date.now() - startMs` sigue
    // valiendo lo mismo que valía en el último latido, más lo que se cuente desde ahora.
    startMsRef.current = (mine.startMs || Date.now()) + hueco;
    setRemoteOwner(null);
    try { localStorage.setItem(LS_LIVE, JSON.stringify({ id: mine.id, startMs: startMsRef.current, source: mine.source })); } catch { /* ignore */ }
    lunchRef.current = mine.lunchSeconds || 0;
    brkRef.current = mine.breakSeconds || 0;
    breakEventsRef.current = mine.breakEvents || [];
    keystrokesRef.current = mine.keystrokes || 0;
    clicksRef.current = mine.clicks || 0;
    activeSecondsRef.current = mine.activeSeconds || 0;
    onBreakRef.current = null;
    if (mine.assignmentId) setAssignmentId(mine.assignmentId);
    setMemo(mine.memo || "");
    setBreaks({ lunch: mine.lunchSeconds || 0, brk: mine.breakSeconds || 0 });
    setBreakList(mine.breakEvents || []);
    setWorked(Math.floor((Date.now() - startMsRef.current) / 1000));
    setOnBreak(null);
    setRunning(true);
    desktopStart({ sessionId: mine.id, intervalMin: shotMin });
    reiniciarContinuidad();
    conduceRef.current = true;
    ultimoGuardadoRef.current = Date.now();
    beginTicking();

    const minutos = Math.round(hueco / 60_000);
    notify(t("track.reopenedAfterReload", {
      min: String(minutos),
      desde: horaCorta(ultimoLatido),
      hasta: horaCorta(Date.now()),
    }));
    return true;
  }

  const reabriendoRef = useRef(false);
  async function intentarReabrir(id: string): Promise<boolean> {
    if (reabriendoRef.current) return false;
    reabriendoRef.current = true;
    try {
      let fila: Session | null = null;
      let vivas: Session[] = [];
      try { [fila, vivas] = await Promise.all([getSession(id), listLiveSessions()]); }
      catch { return false; } // sigue sin red: se vuelve a intentar en el próximo `online`
      let mark = null;
      try { mark = parseResumeMark(localStorage.getItem(LS_RESUME), Date.now()); } catch { mark = null; }
      const evidenciaLocal = continuoRef.current && tickRef.current !== null && sessionIdRef.current === id && runningRef.current && !remoteOwnerRef.current;
      const d = decisionReabrir({ fila, me: me.id, mark, evidenciaLocal, otrasVivas: vivas.map((v) => v.id) });
      if (!d.reabrir) {
        if (d.motivo === "otra-viva") notify(t("track.notReopened"));
        return false;
      }
      const el = Math.floor((Date.now() - startMsRef.current) / 1000);
      try {
        await updateSession(id, {
          isLive: true,
          endMs: Date.now(),
          durationSeconds: netSeconds(el),
          activeSeconds: activeSecondsRef.current,
          idleSeconds: idleRef.current,
          liveNote: onBreakRef.current ? "break" : "active",
          keystrokes: keystrokesRef.current,
          clicks: clicksRef.current,
          lunchSeconds: lunchRef.current,
          breakSeconds: brkRef.current,
          breakEvents: breakEventsPayload(),
        });
      } catch (e) {
        // 092 (otra viva) u 082 (solape con un tramo posterior): la base manda. No se reabre.
        if (isAlreadyRunning(e) || isOverlapError(e)) notify(t("track.notReopened"));
        return false;
      }
      try { localStorage.setItem(LS_LIVE, JSON.stringify({ id, startMs: startMsRef.current, source: fila?.source })); } catch { /* ignore */ }
      notify(t("track.reopened"));
      return true;
    } finally {
      reabriendoRef.current = false;
    }
  }
  const intentarReabrirRef = useRef(intentarReabrir);
  intentarReabrirRef.current = intentarReabrir;
  useEffect(() => {
    // Al volver la red. Si la sesión sigue viva, `decisionReabrir` dice "sigue-viva" y no pasa
    // nada más: dos lecturas.
    const h = () => {
      const id = sessionIdRef.current;
      if (id && runningRef.current && !remoteOwnerRef.current) void intentarReabrirRef.current(id);
      // Y si había racha de fallos, sanar ya (D-916): la red volvió.
      if (rachaRef.current.fallos > 0) void sanarRef.current();
    };
    window.addEventListener("online", h);
    return () => window.removeEventListener("online", h);
  }, []);

  /**
   * Reanudar tras una recarga cuando el servidor no contesta (D-195).
   *
   * Igual que la adopción normal pero sin esperar la confirmación: se arma el tick y la captura
   * de escritorio contra la sesión de la marca, y la confirmación se reintenta con backoff
   * (2, 4, 8, 16, 30 s…) mientras la marca siga siendo reciente. Tres salidas: el servidor la
   * da por viva → se limpia la marca y se sigue; la da por cerrada → se para como cuando el
   * dueño para desde el otro cliente; la marca caduca sin respuesta → se cae al modo mirón
   * (D-096), que es el comportamiento sin marca.
   */
  function reanudarConMarca(id: string, startMs: number) {
    sessionIdRef.current = id;
    // Sin la fila delante: si hay que continuarla, `intentarPendiente` la lee por su id.
    filaBaseRef.current = null;
    filaAnteriorIdRef.current = id;
    guardadoHastaRef.current = null;
    guardadoNetoRef.current = 0;
    ponerArrastre(0);
    startMsRef.current = startMs;
    setRemoteOwner(null);
    setWorked(Math.floor((Date.now() - startMs) / 1000));
    setRunning(true);
    notify(t("track.resumed"));
    desktopStart({ sessionId: id, intervalMin: shotMin });
    reiniciarContinuidad();
    conduceRef.current = true;
    ultimoGuardadoRef.current = Date.now();
    beginTicking();
    let intento = 0;
    const desde = Date.now();
    const confirmar = async () => {
      if (stoppedRef.current || sessionIdRef.current !== id) return;
      try {
        const live = await listLiveSessions();
        if (sessionIdRef.current !== id) return;
        if (live.some((x) => x.id === id)) {
          try { localStorage.removeItem(LS_RESUME); } catch { /* ignore */ }
          return; // confirmada: el tick ya corre
        }
        // Cerrada en el servidor mientras no había red. Si la cerró el cron y este reloj no se
        // detuvo, se reabre (D-197); si no, parar sin escribir más.
        if (await intentarReabrir(id)) { try { localStorage.removeItem(LS_RESUME); } catch { /* ignore */ } return; }
        if (sessionIdRef.current !== id) return;
        if (tickRef.current) clearInterval(tickRef.current);
        tickRef.current = null;
        desktopStop();
        sessionIdRef.current = null;
        try { localStorage.removeItem(LS_LIVE); localStorage.removeItem(LS_RESUME); } catch { /* ignore */ }
        setRunning(false);
        setWorked(0);
      } catch {
        if (Date.now() - desde > RESUME_MAX_MS) {
          // Sin respuesta en todo el margen de la marca: deja de conducir, mira (D-096).
          if (tickRef.current) clearInterval(tickRef.current);
          tickRef.current = null;
          desktopStop();
          watchRemote(startMs, id);
          return;
        }
        setTimeout(confirmar, backoffMs(intento++));
      }
    };
    setTimeout(confirmar, backoffMs(0));
  }

  /** The 1s clock. Extracted from start() so a session adopted on mount can resume it too. */
  function beginTicking() {
      // Nunca dos ticks a la vez (D-470): la adopción ahora puede repetirse.
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = setInterval(async () => {
        const ahora = Date.now();
        // Se pregunta AHORA y no se lee el estado de React (D-470). El tick que arma la
        // adopción nace en el primer render, donde ese estado todavía vale `false`: toda sesión
        // adoptada en la app de escritorio (tras una recarga, o al reabrir la app) medía la
        // actividad como un navegador —solo teclas y clics DENTRO de esta ventana— y salía con
        // 0 % mientras las capturas decían 40 o 60.
        const enEscritorio = isDesktop();
        if (!tickContinuo(lastTickRef.current, ahora)) {
          // Hueco mayor que el que la base tolera sin latido: el reloj local se paró. La noche
          // de la máquina dormida no se paga por la puerta de atrás (D-098).
          continuoRef.current = false;
          try { localStorage.removeItem(LS_RESUME); } catch { /* ignore */ }
        }
        lastTickRef.current = ahora;
        const el = Math.floor((ahora - startMsRef.current) / 1000);
        if (onBreakRef.current === "lunch") lunchRef.current++;
        else if (onBreakRef.current === "break") brkRef.current++;
  
        // an "active second" = a second with >=1 input event, not on break. On
        // desktop, read system-wide counters from the bridge; on web, use the
        // focus-gated flag (a browser tab can't see input elsewhere).
        let hadEvent: boolean;
        if (enEscritorio) {
          const act = await desktopGetActivity();
          let moves = 0;
          if (act) {
            keystrokesRef.current = act.keystrokes;
            clicksRef.current = act.clicks;
            moves = act.moves || 0;
          }
          const total = keystrokesRef.current + clicksRef.current + moves;
          hadEvent = total > lastActTotalRef.current;
          lastActTotalRef.current = total;
        } else {
          hadEvent = secHadEventRef.current;
          secHadEventRef.current = false;
        }
        if (hadEvent) activeWindowRef.current = ACTIVE_WINDOW_SEC;
        const windowedActive = activeWindowRef.current > 0;
        if (activeWindowRef.current > 0) activeWindowRef.current -= 1;
  
        // On-screen motion counts as activity even without keyboard/mouse
        // input: a meeting, a video, a running Claude session all move the
        // screen. Probed periodically (capture isn't free) only when there's
        // no recent input to fill in. Desktop-only — the browser can't see it.
        let productiveNow = false;
        let appLabel = "";
        if (smartIdle && enEscritorio && !onBreakRef.current && !windowedActive) {
          ctxProbeRef.current -= 1;
          if (ctxProbeRef.current <= 0) {
            ctxProbeRef.current = 4;
            desktopGetContext().then((c) => { if (c) ctxRef.current = c; }).catch(() => {});
          }
          const c = ctxRef.current;
          if (c && (c.movement || 0) >= MOVEMENT_THRESHOLD) {
            productiveNow = true; appLabel = c.app || c.title || "";
          }
        }
  
        const activeThisSec = (windowedActive || productiveNow) && !onBreakRef.current;
        if (activeThisSec) activeSecondsRef.current += 1;
        const idleNow = !activeThisSec && !onBreakRef.current;
        // Sin comparar contra el estado: este callback puede ser de un render viejo, y React
        // ya descarta por su cuenta un `set` con el mismo valor.
        setIsIdle(idleNow);
        setCtxApp(appLabel);
  
        const net = netSeconds(el);
        setWorked(net);
        setBreaks({ lunch: lunchRef.current, brk: brkRef.current });
        setActivePct(net > 0 ? Math.round((activeSecondsRef.current / net) * 100) : 0);
        setMeter((prev) => { const m = prev.slice(1); m.push(activeThisSec); return m; });
  
        const liveNote = onBreakRef.current ? "break" : productiveNow ? (appLabel || "screen") : idleNow ? "idle" : "active";
  
        if (el > 0 && el % 10 === 0 && sessionIdRef.current) {
          const id = sessionIdRef.current;
          // La marca de reanudación se refresca con cada latido (D-197), no solo en pagehide:
          // es la evidencia local de que este reloj no se ha detenido, y es lo que autoriza a
          // reabrir una sesión que el cron cerró mientras no había red. localStorage funciona
          // sin conexión, que es justo cuando importa.
          if (continuoRef.current) {
            try { localStorage.setItem(LS_RESUME, JSON.stringify({ sessionId: id, at: Date.now() })); } catch { /* ignore */ }
          }
          const finLatido = Date.now();
          // El estado vivo, por si hay que recargar (D-916): lo que esta app lleva medido, ahora.
          guardarEstadoVivo(id);
          void writeSession(id, {
            endMs: finLatido,
            durationSeconds: net,
            activeSeconds: activeSecondsRef.current,
            idleSeconds: idleRef.current,
            liveNote,
            keystrokes: keystrokesRef.current,
            clicks: clicksRef.current,
            lunchSeconds: lunchRef.current,
            breakSeconds: brkRef.current,
            breakEvents: breakEventsPayload(),
          }, 3, true).then((r) => {
            // Un latido de una fila que ya no es la actual (se continuó en otra mientras este
            // estaba en vuelo) no decide nada.
            if (sessionIdRef.current !== id) return;
            // La fila ya no acepta latidos: la cerró el cron o la pantalla (`cerrada`), o ha
            // crecido hasta chocar con tiempo ya fichado (`overlap`, 082). Antes, `cerrada`
            // dejaba el reloj contando en el vacío con un aviso, y `overlap` llamaba a `stop()`,
            // cuyo parche chocaba igual y se perdía con todo lo contado desde el último latido
            // bueno (D-875). Ahora se continúa en una fila nueva, recortada para no solapar.
            // La racha de fallos (D-916): un latido que no entró la alarga; tres seguidos sanan.
            if (r === true) { if (rachaRef.current.fallos) { rachaRef.current = registrarExito(); setRacha(rachaRef.current); } }
            else if (r === "queued" || r === "auth") {
              rachaRef.current = registrarFallo(rachaRef.current, Date.now());
              setRacha(rachaRef.current);
              if (tocaSanar(rachaRef.current, Date.now())) void sanarRef.current();
            }
            if (planTrasLatido(r) === "fila-nueva" && !stoppedRef.current) {
              marcarSinGuardar();
              notify(t(r === "overlap" ? "track.overlapContinued" : "track.rowContinued"));
              continuarEnFilaNueva();
              return;
            }
            // Sin sesión (auth) el parche queda en la cola y sale con la duración completa en
            // cuanto la persona vuelve a entrar (D-241). Se dice una vez; el reloj no se para.
            if (r === "auth") {
              if (sinGuardarDesdeRef.current === null) {
                marcarSinGuardar();
                notify(t("track.authLost"));
              }
              return;
            }
            // Y cualquier escritura buena borra el aviso y mueve el suelo: entre el fallo y
            // ahora puede haber entrado un reintento, y el minuto que se enseña tiene que ser
            // el del último guardado de verdad, no el del primer error.
            if (r === true) {
              ultimoGuardadoRef.current = Date.now();
              guardadoHastaRef.current = finLatido;
              guardadoNetoRef.current = net;
              // El cascarón de escritorio (versiones nuevas) vigila este pulso por su cuenta.
              desktopHeartbeat({ sessionId: id, at: ultimoGuardadoRef.current });
              if (sinGuardarDesdeRef.current !== null) {
                sinGuardarDesdeRef.current = null;
                setSinGuardarDesde(null);
              }
            }
          });
        }
      }, 1000);
  }

  // Desde cuándo el reloj de pantalla no corresponde a nada guardado (D-241). El ref es el
  // que lee el tick —corre dentro de un setInterval y no ve el estado nuevo— y el estado es el
  // que pinta el aviso. `ultimoGuardadoRef` es el suelo: la última escritura que sí entró.
  const ultimoGuardadoRef = useRef<number | null>(null);
  const sinGuardarDesdeRef = useRef<number | null>(null);
  const [sinGuardarDesde, setSinGuardarDesde] = useState<number | null>(null);

  function marcarSinGuardar(desdeMs?: number) {
    if (sinGuardarDesdeRef.current !== null) return;
    sinGuardarDesdeRef.current = desdeMs ?? ultimoGuardadoRef.current ?? Date.now();
    setSinGuardarDesde(sinGuardarDesdeRef.current);
  }
  function limpiarSinGuardar() {
    if (sinGuardarDesdeRef.current === null) return;
    sinGuardarDesdeRef.current = null;
    setSinGuardarDesde(null);
  }
  function ponerArrastre(seg: number) { arrastreRef.current = seg; setArrastre(seg); }

  // ---- La recuperación (D-916, `recuperacion.ts`) ---------------------------------------
  const rachaRef = useRef<Racha>(RACHA_LIMPIA);
  const [racha, setRacha] = useState<Racha>(RACHA_LIMPIA);
  const sanandoRef = useRef(false);
  const recargandoRef = useRef(false);
  const ultimoAvisoSistemaRef = useRef<number | null>(null);

  /** Lo que esta app lleva medido de la fila `id`, en `localStorage`, para que una recarga no lo pierda. */
  function guardarEstadoVivo(id: string) {
    // Solo mientras la continuidad se conserve (misma regla que la marca de reanudación): tras un
    // hueco del reloj local —máquina dormida— lo medido ya no es de fiar y el estado se borra.
    if (!continuoRef.current) { try { localStorage.removeItem(LS_ESTADO_VIVO); } catch { /* ignore */ } return; }
    const e: EstadoVivo = {
      sessionId: id,
      startMs: startMsRef.current,
      activeSeconds: activeSecondsRef.current,
      idleSeconds: idleRef.current,
      keystrokes: keystrokesRef.current,
      clicks: clicksRef.current,
      lunchSeconds: lunchRef.current,
      breakSeconds: brkRef.current,
      breakEvents: breakEventsPayload() as BreakEvent[],
      guardadoHastaMs: guardadoHastaRef.current,
      guardadoNeto: guardadoNetoRef.current,
      arrastre: arrastreRef.current,
      source: filaBaseRef.current?.source ?? null,
      at: Date.now(),
    };
    try { localStorage.setItem(LS_ESTADO_VIVO, JSON.stringify(e)); } catch { /* ignore */ }
  }

  /**
   * Sanar (D-916): se llama cuando la racha lo pide y al volver `online`.
   *
   *  (a) Sin red no hay nada que hacer: se espera al evento `online`, que vuelve a llamar aquí.
   *  (b) Se refresca la sesión de Supabase (el JWT caducó durante el corte); si el cliente no
   *      contesta, el proveedor lo rehace.
   *  (c) Se reintenta YA con un latido de alcance, con los números que la app tiene en memoria.
   *  (d) Si lleva más de cinco minutos fallando con red y el sitio contesta, lo roto es esta
   *      página: recarga suave con el estado vivo guardado (`continuarConEstadoVivo` al montar).
   */
  async function sanar() {
    const id = sessionIdRef.current;
    if (sanandoRef.current || recargandoRef.current || !id || !runningRef.current || remoteOwnerRef.current || stoppedRef.current) return;
    sanandoRef.current = true;
    const ahora = Date.now();
    rachaRef.current = { ...rachaRef.current, ultimoSanarMs: ahora, etapa: "reconectando" };
    setRacha(rachaRef.current);
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return; // (a)
      await refrescarSesion().catch(() => false);                                    // (b)
      const el = Math.floor((Date.now() - startMsRef.current) / 1000);
      const r = await writeSession(id, {                                              // (c)
        ...parcheDeAlcance({
          startMs: startMsRef.current, activeSeconds: activeSecondsRef.current, idleSeconds: idleRef.current,
          keystrokes: keystrokesRef.current, clicks: clicksRef.current, lunchSeconds: lunchRef.current,
          breakSeconds: brkRef.current, breakEvents: breakEventsRef.current,
        }, Date.now(), onBreakRef.current ? "break" : "active"),
        durationSeconds: netSeconds(el),
      }, 1, true);
      if (sessionIdRef.current !== id) return;
      if (r === true) {
        ultimoGuardadoRef.current = Date.now();
        guardadoHastaRef.current = ultimoGuardadoRef.current;
        guardadoNetoRef.current = netSeconds(el);
        rachaRef.current = registrarExito();
        setRacha(rachaRef.current);
        notify(t("track.healCaughtUp", { min: String(minutosSinGuardar(sinGuardarDesdeRef.current ?? ultimoGuardadoRef.current, Date.now())) }));
        limpiarSinGuardar();
        return;
      }
      if (planTrasLatido(r) === "fila-nueva") return; // el tick lo continúa en otra fila (D-875)
      rachaRef.current = registrarFallo(rachaRef.current, Date.now());
      setRacha(rachaRef.current);
      // (d) ¿Hay red de verdad? Un `fetch` fresco al propio sitio, sin caché ni socket reutilizado.
      let sitioResponde = false;
      try {
        const res = await conTope(fetch("/api/version", { cache: "no-store", keepalive: false }), 10_000);
        sitioResponde = res.ok;
      } catch { sitioResponde = false; }
      if (tocaRecargar(rachaRef.current, Date.now(), { online: navigator.onLine !== false, sitioResponde })) {
        recargandoRef.current = true;
        rachaRef.current = { ...rachaRef.current, etapa: "alcanzando" };
        setRacha(rachaRef.current);
        guardarEstadoVivo(id);
        notify(t("track.healReloading"));
        window.location.reload();
      }
    } finally {
      sanandoRef.current = false;
    }
  }
  const sanarRef = useRef(sanar);
  sanarRef.current = sanar;
  // El cascarón de escritorio (RTG Hub 1.3.0+, `desktop/main.js`) ve volver la red desde el proceso
  // principal y despacha `rtg:sanar` en la página. Se contesta SIEMPRE (`__rtgSanarAck`), haya o
  // no racha: la respuesta es «estoy viva»; sin ella en 60 s el cascarón recarga sin caché.
  useEffect(() => {
    const w = window as unknown as { __rtgSanarEscucha?: boolean; __rtgSanarAck?: number };
    w.__rtgSanarEscucha = true;
    const h = () => { w.__rtgSanarAck = Date.now(); if (rachaRef.current.fallos > 0) void sanarRef.current(); };
    window.addEventListener("rtg:sanar", h);
    return () => { window.removeEventListener("rtg:sanar", h); w.__rtgSanarEscucha = false; };
  }, []);
  /** Lo que hay que saber de una fila para abrir la que la continúa. */
  function baseDe(s: Partial<Session> | null | undefined): Partial<Session> | null {
    if (!s) return null;
    return { projectId: s.projectId, assignmentId: s.assignmentId, memo: s.memo ?? "", source: s.source };
  }

  // La fila de la que se continúa, por si `filaBaseRef` no está (sesión retomada solo con la miga).
  const filaAnteriorIdRef = useRef<string | null>(null);
  // Un Stop que llegó con el INSERT en vuelo: se aplica a la fila en cuanto exista.
  const pararTrasInsertRef = useRef<Partial<Session> | null>(null);
  // La fila anterior que todavía hay que cerrar antes de que la base acepte la continuación (092).
  const anteriorPorCerrarRef = useRef<string | null>(null);

  /**
   * La fila dejó de aceptar latidos: se continúa en otra (D-875). Arranca donde terminó lo
   * guardado si el reloj no se paró (si se paró, ahora: D-098), y el reloj de pantalla no
   * vuelve a cero —lo ya guardado pasa a `arrastre`—.
   */
  function continuarEnFilaNueva(desdeAhora = false) {
    const ahora = Date.now();
    const desde = inicioDeContinuacion({ guardadoHastaMs: guardadoHastaRef.current, continuo: continuoRef.current && !desdeAhora, ahoraMs: ahora });
    ponerArrastre(arrastreRef.current + guardadoNetoRef.current);
    guardadoNetoRef.current = 0;
    guardadoHastaRef.current = null;
    filaAnteriorIdRef.current = sessionIdRef.current;
    sessionIdRef.current = null;
    try { localStorage.removeItem(LS_RESUME); } catch { /* ignore */ }
    startMsRef.current = desde;
    lunchRef.current = 0; brkRef.current = 0; idleRef.current = 0; activeSecondsRef.current = 0;
    breakEventsRef.current = onBreakRef.current ? [{ kind: onBreakRef.current, start: desde, end: null }] : [];
    pendienteRef.current = nuevoPendiente(desde, ahora);
    // Tras un solape la fila vieja sigue viva, y con ella viva la base rechazaría la nueva (092:
    // una sola viva por persona). Se cierra tal como quedó en su último latido bueno —un PATCH
    // de solo `is_live` no toca lo guardado— y después se abre la siguiente. Sobre una fila que
    // ya cerró el cron no cambia nada.
    // El cierre ya NO es «fire-and-forget» (D-916): el 2026-11-07 salió con el JWT caducado, volvió
    // 401 en silencio y la fila nueva chocó con la vieja (092) cada 35 s durante 70 minutos. Ahora
    // `intentarPendiente` cierra la anterior ANTES de insertar, y vuelve a intentarlo hasta que entre.
    anteriorPorCerrarRef.current = filaAnteriorIdRef.current;
    void intentarPendiente();
  }

  /**
   * Volvió de un sueño o un bloqueo más largo que la gracia (pausa-de-energia.ts). Se sigue
   * contando en una fila nueva desde ahora, y se dice en pantalla Y con aviso del sistema: lo
   * que no puede volver a pasar es que cambie algo del reloj sin que la persona se entere.
   */
  function continuarTrasDormir(fueraSegundos: number) {
    if (!runningRef.current || stoppedRef.current) return;
    const mins = Math.max(1, Math.round(fueraSegundos / 60));
    const texto = t("track.resumedAfterSleep", { mins: String(mins) });
    notify(texto);
    avisoDeSistema(t("track.resumedAfterSleepTitle"), texto);
    // Sin fila guardada todavía: el aviso de «sin guardar» se ve hasta que entre el INSERT.
    ultimoGuardadoRef.current = Date.now();
    marcarSinGuardar(Date.now());
    // Con un INSERT pendiente ya hay fila en camino: no se abre otra encima.
    if (sessionIdRef.current) continuarEnFilaNueva(true);
  }
  const continuarTrasDormirRef = useRef(continuarTrasDormir);
  continuarTrasDormirRef.current = continuarTrasDormir;

  /**
   * Start no consiguió fila (red caída al despertar, token caducado tras la noche…). Antes:
   * `return` en silencio o un `alert`, y la persona trabajaba sin nada detrás. Ahora el reloj
   * cuenta desde que se pulsó, el aviso lo dice, y el INSERT se reintenta hasta que entre.
   */
  function entrarEnPendiente(desdeMs: number) {
    const ahora = Date.now();
    sessionIdRef.current = null;
    pendienteRef.current = { ...nuevoPendiente(desdeMs, ahora), proximoMs: ahora + 2_000 };
    conduceRef.current = true;
    setRemoteOwner(null);
    setRunning(true);
    ultimoGuardadoRef.current = desdeMs;
    marcarSinGuardar(desdeMs);
    notify(t("track.startPending"));
    beginTicking();
  }

  /** Un intento del INSERT pendiente. Lo llaman la continuación, Start y el vigía. */
  async function intentarPendiente() {
    const p = pendienteRef.current;
    if (!p || insertandoRef.current || stoppedRef.current) return;
    insertandoRef.current = true;
    const ahora = Date.now();
    try {
      if (!filaBaseRef.current && filaAnteriorIdRef.current) {
        try { filaBaseRef.current = baseDe(await getSession(filaAnteriorIdRef.current)); } catch { /* se reintenta */ }
      }
      const base = filaBaseRef.current;
      if (!base?.projectId && !base?.assignmentId) { pendienteRef.current = trasFallo(p, ahora); return; }
      // Primero cerrar la anterior, con reintento (D-916). Un PATCH de solo `is_live` no toca lo que
      // guardó su último latido bueno. Mientras no entre, no se inserta: chocaría (092).
      if (anteriorPorCerrarRef.current) {
        try { await updateSession(anteriorPorCerrarRef.current, { isLive: false }); anteriorPorCerrarRef.current = null; }
        catch { pendienteRef.current = trasFallo(p, ahora); return; }
      }
      // Recortar contra lo ya fichado en vez de chocar (082). Tras varios choques con lo que
      // esta pantalla no ve, el último recurso es arrancar ahora: lo de antes ya está fichado.
      const tramos = misSesionesRef.current
        .filter((s) => s.startMs != null && s.endMs != null)
        .map((s) => ({ startMs: Number(s.startMs), endMs: Number(s.endMs) }));
      const desde = (p.solapes ?? 0) >= 3 ? ahora : inicioSinSolape(p.desdeMs, ahora, tramos);
      if (desde === null) { pendienteRef.current = trasFallo(p, ahora); return; }
      if (desde !== startMsRef.current && desde > startMsRef.current) startMsRef.current = desde;
      const el = Math.max(0, Math.floor((ahora - desde) / 1000));
      const row = await startSession({
        ...base,
        employeeUid: me.id,
        employeeName: me.fullName,
        weekOf: weekStartISO(desde),
        date: dateISO(desde),
        startMs: desde,
        endMs: ahora,
        durationSeconds: netSeconds(el),
        activeSeconds: activeSecondsRef.current,
        idleSeconds: idleRef.current,
        keystrokes: keystrokesRef.current,
        clicks: clicksRef.current,
        lunchSeconds: lunchRef.current,
        breakSeconds: brkRef.current,
        breakEvents: breakEventsPayload(),
        manual: false,
        isLive: true,
        liveNote: "active",
      });
      pendienteRef.current = null;
      const parar = pararTrasInsertRef.current;
      if (parar || stoppedRef.current) {
        // Se pulsó Stop con el INSERT en vuelo: la fila existe, se cierra con lo contado.
        pararTrasInsertRef.current = null;
        await writeSession(row.id, { ...(parar ?? {}), isLive: false });
        return;
      }
      sessionIdRef.current = row.id;
      try { localStorage.setItem(LS_LIVE, JSON.stringify({ id: row.id, startMs: desde, source: base.source })); } catch { /* ignore */ }
      ultimoGuardadoRef.current = Date.now();
      guardadoHastaRef.current = ahora;
      guardadoNetoRef.current = netSeconds(el);
      limpiarSinGuardar();
      desktopStart({ sessionId: row.id, intervalMin: shotMin });
      notify(t("track.savingAgain"));
    } catch (e) {
      const sig = trasFallo(p, Date.now());
      pendienteRef.current = isOverlapError(e) ? { ...sig, solapes: (p.solapes ?? 0) + 1 } : sig;
      // 092: ya hay una viva mía (D-916). Si la abrió este mismo cliente se cierra en su último
      // latido bueno y el siguiente intento entra. Si la conduce el otro cliente, no se toca: se
      // deja de insertar y se mira (D-096).
      if (isAlreadyRunning(e)) {
        try {
          const vivas = await listLiveSessions();
          const ajena = vivas.find((v) => theirsDe(v));
          if (ajena) {
            pendienteRef.current = null;
            if (tickRef.current) clearInterval(tickRef.current);
            desktopStop();
            sessionIdRef.current = ajena.id;
            setRemoteOwner(ajena.source === "desktop" ? "desktop" : "web");
            watchRemote(ajena.startMs || Date.now(), ajena.id);
          } else {
            for (const v of vivas) await updateSession(v.id, { isLive: false }).catch(() => {});
            pendienteRef.current = { ...(pendienteRef.current ?? sig), proximoMs: Date.now() + 2_000 };
          }
        } catch { /* sin red: el vigía vuelve a intentar */ }
      }
    } finally {
      insertandoRef.current = false;
    }
  }
  const intentarPendienteRef = useRef(intentarPendiente);
  intentarPendienteRef.current = intentarPendiente;

  /**
   * Tramos que se pararon sin haber llegado a tener fila: viven en `localStorage` hasta que
   * entren. Si chocan con lo ya fichado se recorta el arranque; si ya está todo fichado, no
   * queda nada que guardar y se quita.
   */
  const LS_PENDING_ROWS = filasPendientesKey(me.id);
  const guardandoFilasRef = useRef(false);
  async function guardarFilasPendientes() {
    if (guardandoFilasRef.current) return;
    let filas: FilaPendiente[] = [];
    try { filas = leerFilasPendientes(localStorage.getItem(LS_PENDING_ROWS)); } catch { return; }
    if (!filas.length) return;
    guardandoFilasRef.current = true;
    const quedan: FilaPendiente[] = [];
    try {
      for (const f of filas) {
        const tramos = misSesionesRef.current
          .filter((s) => s.startMs != null && s.endMs != null)
          .map((s) => ({ startMs: Number(s.startMs), endMs: Number(s.endMs) }));
        const desde = inicioSinSolape(f.startMs, f.endMs, tramos);
        if (desde === null || desde >= f.endMs) continue; // todo ese tramo ya está fichado
        const recorte = Math.floor((desde - f.startMs) / 1000);
        try {
          await startSession({
            ...(f.payload as Partial<Session>),
            startMs: desde, endMs: f.endMs, durationSeconds: Math.max(0, f.durationSeconds - recorte), isLive: false, liveNote: null,
          });
        } catch (e) {
          if (isOverlapError(e)) quedan.push({ ...f, startMs: Math.min(f.endMs, desde + 60_000) });
          else quedan.push(f);
        }
      }
    } finally {
      try {
        if (quedan.length) localStorage.setItem(LS_PENDING_ROWS, JSON.stringify(quedan));
        else localStorage.removeItem(LS_PENDING_ROWS);
      } catch { /* ignore */ }
      guardandoFilasRef.current = false;
    }
  }
  const guardarFilasRef = useRef(guardarFilasPendientes);
  guardarFilasRef.current = guardarFilasPendientes;
  useEffect(() => { void guardarFilasRef.current(); }, []);

  /**
   * Esta pestaña ya se enteró, así que el indicador no lo repite (D-242).
   *
   * El aviso del contador de descartados es para el caso en que **ningún tick avisó**: otra
   * pestaña, otro dispositivo, la página cerrada. Pero `flush` corre en todas las pestañas y el
   * contador vive en `localStorage`, que las pestañas comparten, así que sin esta regla la
   * misma persona vería dos avisos por un solo descarte — el «cerrada» del tick, en el
   * momento, y el del recuadro de la esquina, después.
   *
   * La marca `sinGuardarDesde` es exactamente «esta pestaña ya se lo dijo». Cuando está puesta
   * y el contador sube, se reconoce en silencio: la noticia ya se dio, y darla dos veces con
   * palabras distintas se lee como dos problemas.
   */
  useEffect(() => subscribeOfflineStatus((st) => {
    if (st.discarded > 0 && sinGuardarDesdeRef.current !== null) ackDiscarded();
  }), []);

  /**
   * El cronómetro se para SOLO antes del cierre de las 18:30 (D-248).
   *
   * Si la sesión se cierra con el reloj corriendo, la fila queda viva sin nadie que la lata y
   * a los quince minutos la cierra el guardián de huérfanas — en su último latido, perdiendo
   * el tramo final, que es exactamente el incidente de D-241. Un Stop normal, antes, escribe
   * la duración de verdad.
   *
   * Se para en el minuto del corte, no unos minutos antes: el trabajo hecho hasta las 18:30 es
   * trabajo, y adelantarlo sería quitar minutos que alguien trabajó.
   *
   * **Y solo a quien va a perder la sesión.** La razón de arriba es la única razón que hay, y no
   * le aplica a un `admin` de Entregas ni a un `owner` de fichaje: a ellos no se les cierra, así
   * que su reloj puede seguir latiendo y no hay huérfana posible. Pararlo igual sería una regla
   * de nómina —«a las 18:30 cierra el negocio»— que nadie ha pedido, disfrazada de regla de
   * sesión.
   *
   * La exención se pregunta al servidor porque **aquí no se puede saber**: el `me.role` de esta
   * pantalla es `"admin" | "employee"` y sale de `profiles.timetracker_role`, que es otra
   * columna y otra pregunta. Un `admin` de Time Tracker no es un `admin` de Entregas.
   *
   * **El fichaje de clock-in no se toca**, y eso es decisión escrita: un fichaje abierto es el
   * registro de la jornada, y cerrarlo por una regla de sesión sería inventar una hora de
   * salida en la nómina. Si el dueño quiere que también se cierre, es otra decisión suya.
   */
  const paradoPorCorteRef = useRef(false);
  /** Hora de un paro automático (no lo pulsó la persona). Banner fijo hasta el próximo Start. */
  const [paradoSolo, setParadoSolo] = useState<number | null>(null);
  const preguntandoCorteRef = useRef(false);
  const [cerca, setCerca] = useState(false);
  // Se pregunta en la VENTANA PREVIA, no al llegar el corte, y esa diferencia es todo el
  // arreglo: pasado el corte, `/auth/cutoff` ya no contesta a un no exento —la puerta del
  // middleware corre también sobre ella y le devuelve la redirección al login—, así que
  // preguntar tarde no da «no exento», da un error.
  const exentoDelCorte = useCutoffExempt(cerca);
  useEffect(() => {
    const mirar = () => {
      if (paradoPorCorteRef.current) return;
      const ahora = horaDelNegocio();
      if (tocaAvisar(ahora) || pasoElCorte(ahora)) setCerca(true);
      if (!pasoElCorte(ahora)) return;
      // Solo un «sí» explícito libra del paro. `null` —sin respuesta, o pestaña abierta después
      // del corte— PARA, porque es el fallo recuperable: a un exento le cuesta un clic en
      // Empezar y no pierde nada, y al que no lo es le evita quedarse con la sesión muerta, el
      // reloj corriendo y una huérfana que el cron cierra a los quince minutos (D-241).
      if (exentoDelCorte === true) return;
      if (!runningRef.current || stoppedRef.current) return;
      // **Se pregunta antes de parar** (D-470). Montada pasado el corte, esta pantalla llegaba
      // aquí en su primer efecto con la respuesta todavía sin pedir, y `null` paraba: al dueño
      // —exento— se le paraba el reloj cada vez que volvía a «Registrar tiempo» después de las
      // 18:30, y con los contadores a cero. `null` DESPUÉS de preguntar sigue parando.
      if (preguntandoCorteRef.current) return;
      preguntandoCorteRef.current = true;
      void pararPorCorteSiToca({
        exentoConocido: exentoDelCorte,
        consultar: consultarExencion,
        sigueCorriendo: () => runningRef.current && !stoppedRef.current && !paradoPorCorteRef.current,
        parar: () => {
          paradoPorCorteRef.current = true;
          notify(t("track.closingForCutoff"));
          // Un paro que no pulsó la persona se queda escrito en pantalla hasta el próximo Start.
          setParadoSolo(Date.now());
          avisoDeSistema(t("track.notRecordingTitle"), t("track.stoppedAuto", { hora: horaCorta(Date.now()) }));
          stopRef.current();
        },
      }).finally(() => { preguntandoCorteRef.current = false; });
    };
    mirar();
    const id = setInterval(mirar, 30_000);
    return () => clearInterval(id);
  }, [notify, t, exentoDelCorte]);

  /**
   * El vigía (D-470): si el reloj enseña «corriendo» y no hay un guardado bueno desde hace más
   * de un minuto, se dice —aviso en pantalla, en TODAS las pantallas del módulo, y sonido— y se
   * reintenta retomar la sesión. Va en su propio intervalo a propósito: lo que vigila es
   * precisamente que el tick haya muerto o no esté armado.
   */
  const ultimaAlarmaRef = useRef<number | null>(null);
  const ultimoReintentoRef = useRef<number | null>(null);
  useEffect(() => {
    const vigilar = () => {
      const ahora = Date.now();
      // Lo pendiente se reintenta aquí, en el intervalo que no depende del tick (D-875).
      if (tocaReintentarPendiente(pendienteRef.current, ahora)) void intentarPendienteRef.current();
      if (ahora % 60_000 < VIGIA_CADA_MS) void guardarFilasRef.current();
      const estado = estadoVigia({
        corriendo: runningRef.current && !stoppedRef.current,
        ajeno: !!remoteOwnerRef.current,
        ultimoGuardadoMs: ultimoGuardadoRef.current,
        ahoraMs: ahora,
      });
      if (estado === "ok") { ultimaAlarmaRef.current = null; ultimoAvisoSistemaRef.current = null; return; }
      if (sinGuardarDesdeRef.current === null) {
        sinGuardarDesdeRef.current = ultimoGuardadoRef.current ?? ahora;
        setSinGuardarDesde(sinGuardarDesdeRef.current);
      }
      if (tocaSonar(ultimaAlarmaRef.current, ahora)) {
        ultimaAlarmaRef.current = ahora;
        sonarAlarma();
        notify(t("track.notRecording"));
      }
      // La notificación de Windows, como mucho una cada diez minutos (D-916): la de las 11:22
      // del incidente se repitió hasta cansar y no decía nada nuevo.
      if (tocaAvisarSistema(ultimoAvisoSistemaRef.current, ahora)) {
        ultimoAvisoSistemaRef.current = ahora;
        avisoDeSistema(t("track.notRecordingTitle"), t("track.notRecording"));
      }
      // Sin latido bueno y conduciendo: aunque los latidos no hayan vuelto con fallo (colgados), la
      // racha avanza por tiempo y la recuperación se intenta cada diez segundos.
      if (conduceRef.current && tickRef.current !== null && sessionIdRef.current) {
        if (rachaRef.current.fallos === 0) { rachaRef.current = registrarFallo(rachaRef.current, ahora); setRacha(rachaRef.current); }
        if (tocaSanar(rachaRef.current, ahora)) void sanarRef.current();
      }
      if (tocaReintentar({ conduce: conduceRef.current, tickArmado: tickRef.current !== null, ultimoIntentoMs: ultimoReintentoRef.current, ahoraMs: ahora })) {
        ultimoReintentoRef.current = ahora;
        void adoptarRef.current(() => false, true);
      }
    };
    const id = setInterval(vigilar, VIGIA_CADA_MS);
    return () => clearInterval(id);
  }, [notify, t]);

  const arrancandoRef = useRef(false);

  async function start() {
    if (!selected) return;
    // El doble clic era la causa real de las dos tarjetas (D-138): dos intentos con 129 ms de
    // diferencia, ninguno viendo todavía al otro. La comprobación de sesiones vivas de abajo no
    // podía salvarlo — cuando corre, la otra fila aún no existe.
    if (arrancandoRef.current) return;
    arrancandoRef.current = true;
    // Un arranque nuevo deja atrás el Stop anterior (D-470). Nadie bajaba esta marca, y no se
    // notaba porque la pantalla se desmontaba al cambiar de pestaña; ahora el cronómetro vive
    // todo el rato que el módulo esté abierto, y con la marca puesta el vigía y el paro por
    // solape darían la segunda sesión por parada.
    stoppedRef.current = false;
    setParadoSolo(null);
    try {
    try {
      const live = await listLiveSessions();
      const others = live.filter((s) => s.id !== sessionIdRef.current);
      if (others.length) {
        if (!window.confirm(t("track.liveConflict"))) return;
        for (const s of others) {
          await updateSession(s.id, { isLive: false, endMs: s.endMs || s.startMs || Date.now() }).catch(() => {});
        }
      }
    } catch { /* if the live-check fails (offline, etc.) fall through and start normally */ }
    lunchRef.current = 0; brkRef.current = 0; onBreakRef.current = null; breakEventsRef.current = [];
    keystrokesRef.current = 0; clicksRef.current = 0; activeSecondsRef.current = 0;
    secHadEventRef.current = false; lastActTotalRef.current = 0; idleRef.current = 0; activeWindowRef.current = 0;
    // Una pausa de energía que quedó abierta al parar la sesión anterior no se hereda: si se
    // heredara, el primer desbloqueo de ESTA jornada mediría el tiempo fuera desde la de ayer.
    pausaDeEnergiaRef.current = null;
    ctxRef.current = null; ctxProbeRef.current = 0; setCtxApp(""); setIsIdle(false);
    reiniciarContinuidad();
    startMsRef.current = Date.now();
    setWorked(0); setOnBreak(null); setBreaks({ lunch: 0, brk: 0 }); setBreakList([]);
    setActivePct(0); setMeter(new Array(METER_BARS).fill(false));
    const now = Date.now();
    const payload: Partial<Session> = {
      employeeUid: me.id,
      employeeName: me.fullName,
      projectId: selected.projectId,
      assignmentId: selected.id,
      memo: memo.trim(),
      weekOf: weekStartISO(now),
      date: dateISO(now),
      startMs: startMsRef.current,
      endMs: startMsRef.current,
      durationSeconds: 0,
      activeSeconds: 0,
      keystrokes: 0,
      clicks: 0,
      lunchSeconds: 0,
      breakSeconds: 0,
      breakEvents: [],
      manual: false,
      // Which client is driving this row. The other one reads it and stays out of the way rather
      // than overwriting numbers it cannot measure. "timer" is kept for the web so the reports'
      // existing `source` pills (manual / adjusted) are unaffected.
      source: isDesktop() ? "desktop" : "timer",
      isLive: true,
    };
    // Lo que hace falta para continuar esta tanda en otra fila si la base deja de aceptarla.
    filaBaseRef.current = baseDe(payload);
    filaAnteriorIdRef.current = null;
    pendienteRef.current = null;
    pararTrasInsertRef.current = null;
    guardadoHastaRef.current = startMsRef.current;
    guardadoNetoRef.current = 0;
    ponerArrastre(0);
    try {
      const row = await startSession(payload);
      sessionIdRef.current = row.id;
      try { localStorage.setItem(LS_LIVE, JSON.stringify({ id: row.id, startMs: startMsRef.current, source: payload.source })); } catch { /* ignore */ }
      setRunning(true);
      conduceRef.current = true;
      ultimoGuardadoRef.current = Date.now(); // la fila se acaba de insertar: ese es el suelo
      setRemoteOwner(null); // started here, so this client drives it
      // Confirm the clock started. On desktop the native floating toast
      // (fired from main.js on tt:start) is the primary cue; this covers web.
      notify(t("notify.startTitle") + ": " + t("notify.startBody", { project: selected.project?.name || "" }));
      desktopStart({ sessionId: row.id, intervalMin: shotMin });
    } catch (e) {
      if (isOverlapError(e)) { notify(t("track.overlap")); return; }
      // La sesión caducó (típicamente al despertar el ordenador). El proveedor ya está
      // enseñando el aviso con el botón de volver a entrar, así que aquí no se repite el
      // mensaje ni se suelta el error de Postgres en un alert — que es lo que salía antes:
      // "permission denied for schema timetracker", delante de alguien que solo quería fichar.
      //
      // Pero callar no puede ser lo mismo que no contar (D-875): la persona ya pulsó Start y
      // se pone a trabajar. Ese era el «0:00 · En marcha… · sin guardar desde las 08:43» del
      // dueño. Se cuenta desde ahora y el INSERT se reintenta hasta que entre.
      if (isSessionExpired(e)) { entrarEnPendiente(startMsRef.current); return; }
      // Doble clic: la base ya rechazó la segunda (092). No es un fallo que contarle a nadie —
      // se recoge la que sí quedó corriendo y la pantalla sigue como si nada.
      if (isAlreadyRunning(e)) {
        const [viva] = await listLiveSessions();
        if (viva) {
          sessionIdRef.current = viva.id;
          startMsRef.current = viva.startMs || Date.now();
          filaBaseRef.current = baseDe(viva);
          guardadoHastaRef.current = viva.endMs ?? null;
          guardadoNetoRef.current = 0;
          try { localStorage.setItem(LS_LIVE, JSON.stringify({ id: viva.id, startMs: startMsRef.current, source: payload.source })); } catch { /* ignore */ }
          setRunning(true);
          setRemoteOwner(null);
          desktopStart({ sessionId: viva.id, intervalMin: shotMin });
          reiniciarContinuidad();
          conduceRef.current = true;
          ultimoGuardadoRef.current = Date.now();
          beginTicking();
        }
        return;
      }
      // Red caída (lo normal justo al despertar el equipo) o un fallo pasajero del servidor.
      // Antes era un `alert` y nada contado; ahora se cuenta y se reintenta (D-875).
      entrarEnPendiente(startMsRef.current);
      return;
    }
    beginTicking();
    } finally {
      arrancandoRef.current = false;
    }
  }

  async function stop() {
    // The button is not rendered for a session the other client owns, but the lock/sleep hook
    // calls stopRef directly — locking this machine must not end a clock running on the other one.
    if (remoteOwnerRef.current) return;
    stoppedRef.current = true;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (onBreakRef.current) {
      const now = Date.now(), arr = breakEventsRef.current;
      for (let i = arr.length - 1; i >= 0; i--) { if (!arr[i].end) { arr[i].end = now; break; } }
      onBreakRef.current = null; setOnBreak(null);
    }
    const el = Math.floor((Date.now() - startMsRef.current) / 1000);
    const id = sessionIdRef.current;
    // Read every accumulator before the reset below touches the UI.
    //
    // Y solo si esta página CONDUJO la sesión (D-470). Recién montada, con solo la miga, los
    // contadores valen cero y `el` cuenta desde el arranque hasta ahora: escribirlos fue lo que
    // dejó la sesión del 2026-10-04 con 4,27 h y 0 s de actividad. `parcheDeStop` en ese caso
    // solo cierra, y la fila se queda como la dejó su último latido.
    const pendiente = pendienteRef.current;
    const enVuelo = insertandoRef.current;
    pendienteRef.current = null;
    const patch = parcheDeStop(conduceRef.current, {
      endMs: Date.now(),
      durationSeconds: netSeconds(el),
      activeSeconds: activeSecondsRef.current,
      idleSeconds: idleRef.current,
      keystrokes: keystrokesRef.current,
      clicks: clicksRef.current,
      lunchSeconds: lunchRef.current,
      breakSeconds: brkRef.current,
      breakEvents: breakEventsPayload(),
    }) as Partial<Session>;
    conduceRef.current = false;
    ultimoGuardadoRef.current = null;
    if (sinGuardarDesdeRef.current !== null) { sinGuardarDesdeRef.current = null; setSinGuardarDesde(null); }

    // Stopped on screen first, saved after. The clock stopping is a local fact and the button has
    // to show it now: this used to flip only in a `finally`, so a slow or retrying write left the
    // view saying "running" for seconds and Stop read as dead. Safe to be optimistic because
    // writeSession never gives up — it falls back to the offline queue, which flushes on reconnect.
    desktopStop();
    sessionIdRef.current = null;
    try { localStorage.removeItem(LS_LIVE); localStorage.removeItem(LS_RESUME); localStorage.removeItem(LS_ESTADO_VIVO); } catch { /* ignore */ }
    rachaRef.current = registrarExito(); setRacha(rachaRef.current);
    setRunning(false); onBreakRef.current = null; setOnBreak(null); setIsIdle(false); setCtxApp("");
    setWorked(0); setBreaks({ lunch: 0, brk: 0 }); setBreakList([]);
    setActivePct(0); setMeter(new Array(METER_BARS).fill(false));

    ponerArrastre(0);
    if (!id) {
      // El tramo contado todavía no tenía fila (D-875). No se tira: si el INSERT está en vuelo,
      // se cierra en cuanto exista; si no, la fila cerrada entera queda en `localStorage` y se
      // reintenta hasta que entre.
      if (enVuelo) { pararTrasInsertRef.current = patch; return; }
      if (pendiente && filaBaseRef.current) {
        const fila: FilaPendiente = {
          startMs: startMsRef.current,
          endMs: Date.now(),
          durationSeconds: netSeconds(el),
          payload: {
            ...filaBaseRef.current,
            ...patch,
            employeeUid: me.id,
            employeeName: me.fullName,
            weekOf: weekStartISO(startMsRef.current),
            date: dateISO(startMsRef.current),
            manual: false,
          },
        };
        try {
          const previas = leerFilasPendientes(localStorage.getItem(LS_PENDING_ROWS));
          localStorage.setItem(LS_PENDING_ROWS, JSON.stringify([...previas, fila]));
        } catch { /* sin almacenamiento: se intenta igual ahora mismo */ }
        notify(t("track.savedOffline"));
        void guardarFilasPendientes();
      }
      return;
    }
    const ok = await writeSession(id, patch);
    // `if (!ok)` used to guard an alert here that could never fire: writeSession returns true or
    // the string "queued", both truthy. What can really happen is the queue, and that is worth
    // saying once — the entry is not lost, it just is not on the server yet.
    if (ok === "queued") notify(t("track.savedOffline"));
    if (ok === "overlap") notify(t("track.overlap"));
    // Un Stop con la sesión caducada (D-241). El parche queda encolado, así que la entrada no
    // se pierde, pero no está en el servidor y no va a estarlo hasta que la persona vuelva a
    // entrar — que es justo lo que hay que decirle, y lo que antes no se decía.
    if (ok === "auth") notify(t("track.authLostOnStop"));
  }
  stopRef.current = stop;

  function toggleBreak(kind: "lunch" | "break") {
    const now = Date.now();
    if (onBreakRef.current === kind) {
      const arr = breakEventsRef.current;
      for (let i = arr.length - 1; i >= 0; i--) { if (arr[i].kind === kind && !arr[i].end) { arr[i].end = now; break; } }
      onBreakRef.current = null; setOnBreak(null);
    } else if (!onBreakRef.current) {
      breakEventsRef.current.push({ kind, start: now, end: null });
      onBreakRef.current = kind; setOnBreak(kind);
    }
    setBreakList(breakEventsRef.current.map((e) => ({ ...e })));
    if (sessionIdRef.current) updateSession(sessionIdRef.current, { breakEvents: breakEventsPayload() }).catch(() => {});
  }

  const startLabel = isInOut ? t("track.clockIn") : t("track.start");
  const stopLabel = isInOut ? t("track.clockOut") : t("track.stop");

  // ------------------------------------------------------------------
  // Quién ve qué en esta pantalla (D-123)
  // ------------------------------------------------------------------
  // "Registrar tiempo" es una sola entrada para dos formas de trabajar que no se parecen en
  // nada: quien cronometra un proyecto desde su sitio, y quien ficha entrada y salida en una
  // tienda con foto y ubicación. Lo decide `worker_type`, que ya se elige por persona en
  // Employees — no un menú nuevo ni una pregunta más al entrar.
  //
  // El presencial NO ve el cronómetro: no es suyo y ofrecérselo solo da ocasión de empezar
  // algo que después descuadra su nómina (las dos mitades no se suman, D-102).
  // El admin ve las dos porque le toca mirar las dos.
  const presencial = effWorkerType(me) === "inhouse";
  const esAdmin = me.role === "admin";

  // El fichaje se pinta AQUÍ, en la misma plantilla (D-125). Antes esto mandaba al presencial
  // a la app de fichaje: funcionaba, pero dejaba dos sitios donde trabajar y el objetivo es
  // retirar aquella app entera.
  if (presencial && !esAdmin) return visible ? <PunchPanel /> : null;

  /** Qué está haciendo la recuperación, al lado del «Sin guardar» (D-916). */
  const textoDeRacha = (r: Racha): string => {
    if (r.etapa === "alcanzando") return " " + t("track.healReloading");
    if (r.fallos === 0) return "";
    return " " + t("track.healReconnecting", { s: String(segundosHastaSanar(r, Date.now())) });
  };

  // Fuera de «Registrar tiempo» el cronómetro sigue montado pero no se ve (D-470). Lo único
  // que asoma es el aviso de que el reloj no se está guardando, con el camino de vuelta.
  const oculto = visible ? undefined : { display: "none" as const };
  const avisoFuera = !visible && sinGuardarDesde !== null ? (
    <div className="banner warn" role="alert">
      {t("track.unsaved", { hora: horaCorta(sinGuardarDesde), mins: String(minutosSinGuardar(sinGuardarDesde, Date.now())) })}
      {textoDeRacha(racha)}
      {" "}
      <Link href="/timetracker">{t("track.goToTimer")}</Link>
    </div>
  ) : !visible && paradoSolo !== null && !running ? (
    <div className="banner warn" role="alert">
      {t("track.stoppedAuto", { hora: horaCorta(paradoSolo) })}
      {" "}
      <Link href="/timetracker">{t("track.goToTimer")}</Link>
    </div>
  ) : null;

  if (esAdmin && vista === "punch") {
    return (
      <>
        {avisoFuera}
        <div style={oculto}>
          <div className="tabs" style={{ marginBottom: 12 }}>
            <button onClick={() => setVista("timer")}>{t("track.viewTimer")}</button>
            <button className="active">{t("track.viewPunch")}</button>
          </div>
          <PunchPanel />
        </div>
      </>
    );
  }

  return (
    <>
      {avisoFuera}
      <div style={oculto}>
      {esAdmin && (
        // Las dos vistas, y las dos de verdad: ninguna se va a otra pantalla.
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button className="active">{t("track.viewTimer")}</button>
          <button onClick={() => setVista("punch")}>{t("track.viewPunch")}</button>
        </div>
      )}
      {/* «Pídele a tu gerente que te asigne uno»: solo a quien necesita proyecto. El presencial no
          (D-493): su proyecto es su tienda y su puesto. */}
      {assignments.length === 0 && necesitaProyecto(me) && (
        <div className="banner info">{t("track.noProjects")}</div>
      )}
      <div className="card">
        <div className="between">
          <h2 style={{ margin: 0 }}>{t("track.title")}</h2>
          {running && isDesktopClient && (
            <span className="chip" style={{ background: "#3a2a12", color: "#ffcf8f" }}>
              {t("track.screenshotsOn", { n: shotMin })}
            </span>
          )}
          <span className="chip">{effWorkerType(me) === "remote" ? t("track.remote") : t("track.inhouse")}</span>
        </div>

        <label style={{ marginTop: 12 }}>{t("track.project")}</label>
        <div className="pbtns">
          {assignments.map((a) => (
            <button
              key={a.id}
              className={"pbtn" + (assignmentId === a.id ? " sel" : "")}
              disabled={running}
              onClick={() => setAssignmentId(a.id)}
            >
              <div className="pn">{a.project.name}</div>
              <div className="pm">
                {a.project.location ? a.project.location + " · " : ""}
                {money(a.hourlyRate)}/h
              </div>
            </button>
          ))}
        </div>

        <label style={{ marginTop: 14 }}>{t("track.memoLabel")}</label>
        <input value={memo} disabled={running} onChange={(e) => setMemo(e.target.value)} placeholder={t("track.memoPlaceholder")} />

        {selected && wLimitSec !== Infinity && (
          <LimitBar usedSec={weekSecThisProj + worked} limitHours={Number(selected.weeklyLimit)} />
        )}
        {overLimit && (
          <div className="banner warn">{t("track.overWarning")}</div>
        )}
        {/* El reloj puede seguir corriendo, pero no puede seguir pareciendo que guarda
            (D-241). El aviso dice la hora del último guardado bueno y cuántos minutos van sin
            salvar, que es lo que de verdad se juega quien lo lee. Se repinta cada segundo
            porque el tick actualiza el estado del reloj cada segundo. */}
        {paradoSolo !== null && !running && (
          <div className="banner warn" role="alert">
            {t("track.stoppedAuto", { hora: horaCorta(paradoSolo) })}
          </div>
        )}
        {sinGuardarDesde !== null && (
          <div className="banner warn" role="alert">
            {t("track.unsaved", { hora: horaCorta(sinGuardarDesde), mins: String(minutosSinGuardar(sinGuardarDesde, Date.now())) })}
            {textoDeRacha(racha)}
          </div>
        )}

        <div className="hr" />

        <div className="row between">
          <div>
            {/* D-829: sin segundos, como el panel de fichar (D-755; Roberto: «Employees don't need to see seconds that
                they're clocked in»). El tick de un segundo se queda: hace más que repintar (latido, vigía). */}
            <div className="timer-big">{fmtClockSinSegundos(worked + (running ? arrastre : 0))}</div>
            <div className="small muted">
              {remoteOwner
                ? t(remoteOwner === "desktop" ? "track.viaDesktop" : "track.viaWeb")
                : running
                ? ctxApp ? t("track.activeApp", { app: ctxApp })
                  : isIdle ? t("track.idle")
                  : onBreak === "lunch" ? t("track.onLunch") : onBreak === "break" ? t("track.onBreak") : isInOut ? t("track.clockedIn") : t("track.running")
                : t("track.stopped")}
              {running && !remoteOwner && (lunchRef.current > 0 || brkRef.current > 0)
                ? <> · lunch {fmtClock(breaks.lunch)} · break {fmtClock(breaks.brk)}</> : null}
            </div>
            {/* The meter and the activity source describe what THIS client is measuring. On a
                session the other one owns there is nothing to measure, and showing an empty meter
                next to "0% activity" is how the web ended up looking like the timer was broken. */}
            {running && !remoteOwner && (
              <div className="meter" style={{ maxWidth: 260 }}>
                {meter.map((on, i) => <i key={i} className={on ? "on" : ""} />)}
              </div>
            )}
            {running && !remoteOwner && !onBreak && (
              <div className="small muted" style={{ marginTop: 6, maxWidth: 320 }}>
                {ctxApp ? t("track.srcScreen", { app: ctxApp }) : isIdle ? t("track.srcIdle") : t("track.srcInput")}
              </div>
            )}
          </div>
          <div className="right">
            {remoteOwner
              ? <span className="pill on">{t(remoteOwner === "desktop" ? "track.viaDesktopPill" : "track.viaWebPill")}</span>
              : !running
              ? <button className="btn-ok" disabled={!selected} onClick={start}>{startLabel}</button>
              : <button className="btn-danger" onClick={stop}>{stopLabel}</button>}
          </div>
        </div>

        {running && !remoteOwner && breaksOn && (
          <div className="row" style={{ marginTop: 12 }}>
            <button className={onBreak === "lunch" ? "btn-warn" : "btn-ghost"} disabled={onBreak === "break"} onClick={() => toggleBreak("lunch")}>
              {onBreak === "lunch" ? "End lunch" : "🍽 Lunch"}
            </button>
            <button className={onBreak === "break" ? "btn-warn" : "btn-ghost"} disabled={onBreak === "lunch"} onClick={() => toggleBreak("break")}>
              {onBreak === "break" ? "End break" : "☕ Break"}
            </button>
          </div>
        )}

        {running && !remoteOwner && breakList.length > 0 && (
          <div className="box" style={{ marginTop: 10 }}>
            <div className="small muted" style={{ marginBottom: 4 }}>Lunches & breaks</div>
            {breakList.map((ev, i) => (
              <div key={i} className="small">
                {ev.kind === "lunch" ? "🍽 Lunch" : "☕ Break"} — out {fmtTime(ev.start)}
                {ev.end
                  ? <> · back {fmtTime(ev.end)} · <span className="muted">{fmtClock(Math.round((ev.end - ev.start) / 1000))}</span></>
                  : <span className="pill wait" style={{ marginLeft: 6 }}>ongoing</span>}
              </div>
            ))}
          </div>
        )}

        {running && (
          // Started and Worked both derive from the owner's startMs, so they match the other
          // screen. Activity and Lunch do not: they are this client's own counters, and on a
          // session it is not driving they would read 0% next to somebody working — which is
          // exactly what the web was showing beside the desktop's 79%.
          <div className={remoteOwner ? "grid g2" : "grid g4"} style={{ marginTop: 14 }}>
            <div className="stat"><div className="n">{fmtTime(startMsRef.current)}</div><div className="l">{t("track.started")}</div></div>
            <div className="stat"><div className="n">{fmtHrs(worked)}</div><div className="l">{t("track.worked")}</div></div>
            {!remoteOwner && <div className="stat"><div className="n">{activePct}%</div><div className="l">{t("track.activity")}</div></div>}
            {!remoteOwner && <div className="stat"><div className="n">{fmtClock(breaks.lunch + breaks.brk)}</div><div className="l">{t("track.lunchBreak")}</div></div>}
          </div>
        )}
      </div>

      <TrackedTotals sessions={sessions} selected={selected} />
      <LatestShot shot={latestScreenshot} signedUrl={screenshotSignedUrl} t={t} />
      </div>
    </>
  );
}

// Upwork-style "Total hours tracked" for the current contract (selected project).
function TrackedTotals({ sessions, selected }: { sessions: Session[]; selected: Assignment | undefined }) {
  const today = dateISO(new Date());
  const wsd = selected ? projectWeekStart(selected.project) : undefined;
  const wStart = weekStartISO(new Date(), wsd);
  const aid = selected?.id;
  const sumIf = (pred: (s: Session) => boolean) => sessions.filter(pred).reduce((n, s) => n + (s.durationSeconds || 0), 0);
  const todaySec = sumIf((s) => s.date === today && (!aid || s.assignmentId === aid));
  const weekSec = sumIf((s) => weekStartISO(s.date ?? "", wsd) === wStart && (!aid || s.assignmentId === aid));
  const limit = selected && selected.weeklyLimit !== null && selected.weeklyLimit !== undefined ? Number(selected.weeklyLimit) : null;
  const weekday = new Date().toLocaleDateString(undefined, { weekday: "short" });
  return (
    <div className="card">
      <h2 style={{ marginBottom: 4 }}>Total hours tracked</h2>
      {!selected && <p className="small muted" style={{ marginTop: 0 }}>Pick a project to see its today / this-week totals.</p>}
      <div className="grid g2" style={{ marginTop: 10 }}>
        <div className="stat">
          <div className="l">Today ({weekday})</div>
          <div className="n">{(todaySec / 3600).toFixed(2)} h</div>
        </div>
        <div className="stat">
          <div className="l">This week</div>
          <div className="n">
            {(weekSec / 3600).toFixed(2)} h
            {limit != null ? <span className="muted" style={{ fontSize: 14, fontWeight: 600 }}> of {limit.toFixed(0)} h</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// Weekly hour-limit progress bar. Green under 80%, amber 80-100%, red over.
function LimitBar({ usedSec, limitHours }: { usedSec: number; limitHours: number }) {
  const t = useT();
  const usedH = usedSec / 3600;
  const pct = Math.min(100, (usedH / limitHours) * 100);
  const over = usedH > limitHours;
  const near = !over && pct >= 80;
  const color = over ? "var(--tt-danger)" : near ? "var(--tt-warn)" : "var(--tt-accent2)";
  const remaining = Math.max(0, limitHours - usedH);
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <span className="small muted">{t("track.weeklyLimitOn")}</span>
        <span className="small">
          <b>{usedH.toFixed(2)} h</b> / {limitHours.toFixed(2)} h
          {over ? <span className="pill off" style={{ marginLeft: 6 }}>{t("track.over")}</span>
            : <span className="muted"> · {t("track.left", { h: remaining.toFixed(2) })}</span>}
        </span>
      </div>
      <div style={{ background: "var(--tt-line)", borderRadius: 999, height: 10, overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: color, transition: "width .3s, background .3s" }} />
      </div>
    </div>
  );
}

// Upwork-style "Latest screenshot" card — desktop-captured only (see the
// module comment). Empty for anyone who has only ever tracked from the web.
function LatestShot({ shot, signedUrl, t }: { shot: import("@/lib/timetracker/types").Screenshot | null; signedUrl: (path: string, expiresIn?: number) => Promise<string>; t: ReturnType<typeof useT> }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!shot?.path) { setUrl(""); return; }
    let ok = true;
    signedUrl(shot.path, 3600).then((u) => { if (ok) setUrl(u); }).catch(() => {});
    return () => { ok = false; };
  }, [shot?.path, signedUrl]);
  if (!shot) return null;
  const when = shot.takenAt ? timeAgo(new Date(shot.takenAt).getTime()) : "";
  if (!shot.path) {
    return (
      <div className="card">
        <div className="between">
          <h2 style={{ margin: 0 }}>{t("track.latestShot")}</h2>
          <span className="small muted">{when}</span>
        </div>
        <div className="shot-blank" style={{ height: 180, maxWidth: 360, marginTop: 10 }}>{t("track.noActivitySeg")}</div>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, shot.activityPercent || 0));
  const filled = Math.round(pct / 10);
  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("track.latestShot")}</h2>
        <span className="small muted">{when}</span>
      </div>
      <a className="shot" href={url || undefined} target="_blank" rel="noopener noreferrer" style={{ display: "block", maxWidth: 360, marginTop: 10 }}>
        {url ? <img src={url} alt="latest screenshot" style={{ height: "auto" }} /> : <div className="shot-loading" style={{ height: 180 }} />}
        <div className="meter" style={{ marginTop: 6 }}>
          {Array.from({ length: 10 }).map((_, i) => <i key={i} className={i < filled ? "on" : ""} />)}
        </div>
        <div className="small muted">{shot.takenAt ? fmtTime(new Date(shot.takenAt).getTime()) : ""} · {pct}% activity</div>
      </a>
    </div>
  );
}
