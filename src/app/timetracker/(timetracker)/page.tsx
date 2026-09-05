"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import {
  APP_SETTINGS, dateISO, effBreaks, effTrackMode, effWorkerType, fmtClock, fmtHrs, fmtTime, money,
  projectWeekStart, timeAgo, weekStartISO,
} from "@/lib/timetracker/helpers";
import {
  DESKTOP_SHOT_MIN, desktopGetActivity, desktopGetContext, desktopNotifyShotStatus,
  desktopOnPower, desktopOnShot, desktopStart, desktopStop, isDesktop,
} from "@/lib/timetracker/desktop";
import { queueSession, queueShot } from "@/lib/timetracker/offlineQueue";
import type { Assignment, BreakEvent, Session } from "@/lib/timetracker/types";
import { isOverlapError } from "@/lib/timetracker/overlap";
import { isSessionExpired, isAlreadyRunning } from "@/lib/session-guard";
import {
  backoffMs, cierreHuerfana, decisionReabrir, esHuerfana, markCovers, parseResumeMark, resumeKey, RESUME_MAX_MS,
  tickContinuo,
} from "@/lib/timetracker/live-session";
import { PunchPanel } from "@/components/timetracker/PunchPanel";

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

export default function TrackTimePage() {
  const {
    me, myAssignments: assignments, mySessions: sessions, listLiveSessions, getSession, startSession, updateSession, updateLiveSession,
    latestScreenshot, screenshotSignedUrl, uploadScreenshot, insertBlankScreenshot, notify,
  } = useData();
  const t = useT();
  // Qué mira un admin: su cronómetro o su reloj de fichaje. Para todos los demás lo decide
  // `worker_type` y no hay nada que elegir.
  const [vista, setVista] = useState<"timer" | "punch">("timer");
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
  const idleRef = useRef(0); // kept at 0 in this pass — no idle-limit auto-stop yet
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

  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current); }, []);

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

  // Auto-stop on lock/sleep (desktop): if the machine locks or sleeps while
  // tracking, stop the timer so away-from-keyboard time isn't counted. Live
  // refs (updated every render, below) avoid both a stale closure and
  // re-subscribing on every render.
  const stopRef = useRef<() => void>(() => {});
  // Live mirror of remoteOwner, for the callbacks that run outside React's render (the lock/sleep
  // hook and the tick) and would otherwise close over a stale value.
  const remoteOwnerRef = useRef<"desktop" | "web" | null>(null);
  remoteOwnerRef.current = remoteOwner;
  useEffect(() => {
    return desktopOnPower((reason) => {
      if (reason !== "suspend" && reason !== "lock-screen") return;
      if (runningRef.current) {
        notify("Tracking stopped — your screen locked or the computer went to sleep.");
        stopRef.current();
      }
    });
  }, [notify]);

  function netSeconds(el: number): number { return Math.max(0, el - lunchRef.current - brkRef.current - idleRef.current); }
  function breakEventsPayload() { return breakEventsRef.current.map((e) => ({ kind: e.kind, start: e.start, end: e.end || null })); }

  // Persist a session update. Retries a few times on transient failures; if
  // every retry fails (offline, or a transient server error), the patch is
  // buffered locally via the offline queue and synced on reconnect — the
  // tracker keeps counting from local refs regardless, so the buffered patch
  // always carries the full up-to-date duration once it flushes.
  // `soloViva` (D-197): el tick escribe con updateLiveSession, que filtra por is_live = true, para
  // no retocar end_ms/duration_seconds de una fila que el cron ya cerró (tras despertar, por
  // ejemplo). Stop escribe is_live = false a propósito y sigue por updateSession. Lo que cae a la
  // cola offline se reenvía por el updateSession del proveedor, sin filtro: límite conocido,
  // anotado en la decisión.
  async function writeSession(id: string, patch: Partial<Session>, tries = 3, soloViva = false): Promise<boolean | "queued" | "overlap"> {
    const write = soloViva ? updateLiveSession : updateSession;
    for (let i = 0; i < tries; i++) {
      try { await write(id, patch); return true; }
      catch (e) {
        // Un solape (082) no se arregla esperando: la base lo va a rechazar igual
        // dentro de una hora. Encolarlo sería reintentar en silencio para siempre
        // mientras el reloj sigue en pantalla como si estuviera guardando.
        if (isOverlapError(e)) return "overlap";
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
  useEffect(() => {
    if (adoptedRef.current || !me?.id) return;
    adoptedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        // listLiveSessions() is already scoped to this employee (employee_uid = me.id in the
        // provider), so the first row is ours by construction — no need to re-filter on a
        // camel-cased field and risk a silent no-op if that mapping ever changes.
        const [mine] = await listLiveSessions();
        if (cancelled) return;
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
        if (esHuerfana(mine, Date.now())) {
          await updateSession(mine.id, cierreHuerfana(mine)).catch(() => {});
          try { localStorage.removeItem(LS_LIVE); localStorage.removeItem(LS_RESUME); } catch { /* ignore */ }
          setRunning(false);
          setWorked(0);
          notify(t("track.orphanClosed"));
          return;
        }

        sessionIdRef.current = mine.id;
        startMsRef.current = mine.startMs || Date.now();
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
        if (cancelled || stoppedRef.current || !liveHint) return;
        if (markCovers(resumeMark, liveHint.id) && !remoteOwnerRef.current) reanudarConMarca(liveHint.id, liveHint.startMs);
        else watchRemote(liveHint.startMs, liveHint.id);
      }
    })();
    return () => { cancelled = true; };
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
    const h = () => { const id = sessionIdRef.current; if (id && runningRef.current && !remoteOwnerRef.current) void intentarReabrirRef.current(id); };
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
    startMsRef.current = startMs;
    setRemoteOwner(null);
    setWorked(Math.floor((Date.now() - startMs) / 1000));
    setRunning(true);
    notify(t("track.resumed"));
    desktopStart({ sessionId: id, intervalMin: shotMin });
    reiniciarContinuidad();
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
      tickRef.current = setInterval(async () => {
        const ahora = Date.now();
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
        if (isDesktopClient) {
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
        if (smartIdle && isDesktopClient && !onBreakRef.current && !windowedActive) {
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
        if (idleNow !== isIdle) setIsIdle(idleNow);
        if (appLabel !== ctxApp) setCtxApp(appLabel);
  
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
          void writeSession(id, {
            endMs: Date.now(),
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
            // La fila ha crecido hasta chocar con otra ya fichada (082). Es justo la
            // forma que tenía el fantasma de 25.75 h: contando sobre un tramo que ya
            // existía. Se para aquí, en vez de seguir enseñando un reloj que ya no
            // guarda nada.
            if (r === "overlap" && !stoppedRef.current) {
              notify(t("track.overlap"));
              void stop();
            }
          });
        }
      }, 1000);
  }

  const arrancandoRef = useRef(false);

  async function start() {
    if (!selected) return;
    // El doble clic era la causa real de las dos tarjetas (D-138): dos intentos con 129 ms de
    // diferencia, ninguno viendo todavía al otro. La comprobación de sesiones vivas de abajo no
    // podía salvarlo — cuando corre, la otra fila aún no existe.
    if (arrancandoRef.current) return;
    arrancandoRef.current = true;
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
    try {
      const row = await startSession(payload);
      sessionIdRef.current = row.id;
      try { localStorage.setItem(LS_LIVE, JSON.stringify({ id: row.id, startMs: startMsRef.current, source: payload.source })); } catch { /* ignore */ }
      setRunning(true);
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
      if (isSessionExpired(e)) return;
      // Doble clic: la base ya rechazó la segunda (092). No es un fallo que contarle a nadie —
      // se recoge la que sí quedó corriendo y la pantalla sigue como si nada.
      if (isAlreadyRunning(e)) {
        const [viva] = await listLiveSessions();
        if (viva) {
          sessionIdRef.current = viva.id;
          startMsRef.current = viva.startMs || Date.now();
          try { localStorage.setItem(LS_LIVE, JSON.stringify({ id: viva.id, startMs: startMsRef.current, source: payload.source })); } catch { /* ignore */ }
          setRunning(true);
          setRemoteOwner(null);
          desktopStart({ sessionId: viva.id, intervalMin: shotMin });
          reiniciarContinuidad();
          beginTicking();
        }
        return;
      }
      const err = e as { message?: string } | null;
      alert("Could not start tracking: " + (err?.message || "unknown error"));
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
    const patch = {
      endMs: Date.now(),
      durationSeconds: netSeconds(el),
      activeSeconds: activeSecondsRef.current,
      idleSeconds: idleRef.current,
      liveNote: null,
      keystrokes: keystrokesRef.current,
      clicks: clicksRef.current,
      lunchSeconds: lunchRef.current,
      breakSeconds: brkRef.current,
      breakEvents: breakEventsPayload(),
      isLive: false,
    };

    // Stopped on screen first, saved after. The clock stopping is a local fact and the button has
    // to show it now: this used to flip only in a `finally`, so a slow or retrying write left the
    // view saying "running" for seconds and Stop read as dead. Safe to be optimistic because
    // writeSession never gives up — it falls back to the offline queue, which flushes on reconnect.
    desktopStop();
    sessionIdRef.current = null;
    try { localStorage.removeItem(LS_LIVE); localStorage.removeItem(LS_RESUME); } catch { /* ignore */ }
    setRunning(false); onBreakRef.current = null; setOnBreak(null); setIsIdle(false); setCtxApp("");
    setWorked(0); setBreaks({ lunch: 0, brk: 0 }); setBreakList([]);
    setActivePct(0); setMeter(new Array(METER_BARS).fill(false));

    if (!id) return;
    const ok = await writeSession(id, patch);
    // `if (!ok)` used to guard an alert here that could never fire: writeSession returns true or
    // the string "queued", both truthy. What can really happen is the queue, and that is worth
    // saying once — the entry is not lost, it just is not on the server yet.
    if (ok === "queued") notify(t("track.savedOffline"));
    if (ok === "overlap") notify(t("track.overlap"));
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
  if (presencial && !esAdmin) return <PunchPanel />;

  if (esAdmin && vista === "punch") {
    return (
      <>
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button onClick={() => setVista("timer")}>{t("track.viewTimer")}</button>
          <button className="active">{t("track.viewPunch")}</button>
        </div>
        <PunchPanel />
      </>
    );
  }

  return (
    <>
      {esAdmin && (
        // Las dos vistas, y las dos de verdad: ninguna se va a otra pantalla.
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button className="active">{t("track.viewTimer")}</button>
          <button onClick={() => setVista("punch")}>{t("track.viewPunch")}</button>
        </div>
      )}
      {assignments.length === 0 && (
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

        <div className="hr" />

        <div className="row between">
          <div>
            <div className="timer-big">{fmtClock(worked)}</div>
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
