"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Lang } from "@/lib/clockin/i18n";
import { markTutorialSeen } from "@/app/timetracker/clock-in/actions/tutorial";

export type TourRole = "employee" | "manager" | "owner";
const SEEN_KEY = "cadence_tour_v1";

type Step = { sel: string | null; title: string; body: string };

// Role-specific tours: an employee is oriented around clocking in / their own
// info; a manager/owner around the command center. Each targets elements by
// data-tour tags so a future restyle won't break it.
function steps(lang: Lang, role: TourRole): Step[] {
  const es = lang === "es";
  const welcome: Step = {
    sel: null,
    title: es ? "¡Bienvenido a RTG Clock-In!" : "Welcome to RTG Clock-In!",
    body: es
      ? "Un recorrido rápido. Puedes saltarlo cuando quieras."
      : "A quick tour. You can skip anytime.",
  };
  const clock: Step = {
    sel: '[data-tour="clock"]',
    title: es ? "Marca tu entrada aquí" : "Clock in here",
    body: es
      ? "Toca para marcar entrada. Tomas una foto rápida y confirmamos que estás en el sitio."
      : "Tap to clock in. You take a quick photo and we confirm you're on-site.",
  };
  const reminders: Step = {
    sel: '[data-tour="notifications"]',
    title: es ? "Recordatorios" : "Reminders",
    body: es
      ? "Aquí llegan tus recordatorios: marcar entrada/salida, fin de turno y más."
      : "Your reminders live here — clock-in nudges, shift-end alerts, and more.",
  };
  const done = (body: string): Step => ({
    sel: null,
    title: es ? "¡Todo listo!" : "You're all set!",
    body,
  });

  const menu: Step = { sel: '[data-tour="menu"]', title: "", body: "" };

  if (role === "employee") {
    return [
      welcome,
      clock,
      {
        sel: '[data-tour="shift"]',
        title: es ? "Tu turno y tus horas" : "Your shift & hours",
        body: es
          ? "Aquí ves tu turno de hoy y tus horas de la semana."
          : "Your shift today and your hours for the week show here.",
      },
      {
        ...menu,
        title: es ? "Todo lo demás está aquí" : "Everything else is here",
        body: es
          ? "Tu horario, recordatorios, tiempo libre y notas están en este menú."
          : "Your schedule, reminders, time off and notes live in this menu.",
      },
      done(es ? "Toca el botón ? cuando quieras repetir este recorrido." : "Tap the ? button anytime to replay this tour."),
    ];
  }

  // Manager / owner: oriented around the command center.
  const isOwner = role === "owner";
  return [
    {
      sel: null,
      title: es ? (isOwner ? "Bienvenido, dueño" : "Bienvenido, gerente") : isOwner ? "Welcome, owner" : "Welcome, manager",
      body: es ? "Un recorrido rápido de tus herramientas." : "A quick tour of your tools.",
    },
    { ...clock, body: es ? "Tú también marcas tu entrada aquí, igual que tu equipo." : "You clock in here too, just like your crew." },
    {
      ...menu,
      title: es ? "Tu centro de control" : "Your command center",
      body: isOwner
        ? es
          ? "En este menú abres el Panel: nómina de TODAS las tiendas, equipo, horarios y excepciones."
          : "This menu opens your Dashboard: payroll for ALL stores, team, schedules, and exceptions."
        : es
          ? "En este menú abres el Panel: nómina, horarios, hojas de tiempo, excepciones y equipo."
          : "This menu opens your Dashboard: payroll, schedules, timesheets, exceptions, and team.",
    },
    done(
      es
        ? "Los pendientes por aprobar aparecen arriba en tu pantalla de inicio. Toca ? para repetir."
        : "Anything needing approval shows at the top of your home screen. Tap ? to replay.",
    ),
  ];
}

type Rect = { top: number; left: number; width: number; height: number } | null;

export default function Tour({
  lang,
  enabled,
  role,
  seen,
}: {
  lang: Lang;
  enabled: boolean;
  role: TourRole;
  seen: boolean;
}) {
  const es = lang === "es";
  const list = useMemo(() => steps(lang, role), [lang, role]);
  const [active, setActive] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect>(null);
  // The "?" replay button is for people who haven't finished the tutorial yet.
  // Once they have, it goes away for good — it floats over the bottom-left of
  // every screen, including the corner of the clock-out button.
  const [done, setDone] = useState(seen);

  // Auto-start only the first time this ACCOUNT is used. `seen` comes from the
  // server (profiles.tutorial_seen_at); localStorage is a fallback so it still
  // behaves before the migration runs.
  useEffect(() => {
    if (!enabled || seen) return;
    let localSeen = false;
    try {
      localSeen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {}
    if (!localSeen) {
      const timer = setTimeout(() => setActive(true), 700);
      return () => clearTimeout(timer);
    }
    setDone(true); // finished on this device before the server knew about it
  }, [enabled, seen]);

  // Read the target's position; only update state when it actually changed
  // (guards against a re-render loop from the polling interval).
  const measure = useCallback(() => {
    const step = list[i];
    const el = step?.sel ? (document.querySelector(step.sel) as HTMLElement | null) : null;
    if (!el) {
      setRect((prev) => (prev === null ? prev : null));
      return;
    }
    const b = el.getBoundingClientRect();
    const next = { top: b.top, left: b.left, width: b.width, height: b.height };
    setRect((prev) =>
      prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height
        ? prev
        : next,
    );
  }, [i, list]);

  // Scroll the target into view once per step (not on every measure).
  useEffect(() => {
    if (!active) return;
    const step = list[i];
    if (step?.sel) (document.querySelector(step.sel) as HTMLElement | null)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, i, list]);

  useEffect(() => {
    if (!active) return;
    measure();
    const onChange = () => measure();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    const t = setInterval(measure, 400); // catch layout settling
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      clearInterval(t);
    };
  }, [active, measure]);

  function finish() {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {}
    markTutorialSeen(); // persist per-account (best-effort)
    setActive(false);
    setDone(true); // and the "?" retires with it
    setI(0);
  }
  function start() {
    setI(0);
    setActive(true);
  }
  const next = () => (i >= list.length - 1 ? finish() : setI(i + 1));
  const back = () => setI(Math.max(0, i - 1));

  if (!enabled) return null;

  const step = list[i];
  const isLast = i === list.length - 1;
  const pad = 8;

  // Tooltip position: below the target if there's room, else above; centered if no target.
  let tipStyle: React.CSSProperties = {};
  if (rect) {
    const belowRoom = window.innerHeight - (rect.top + rect.height) > 200;
    const top = belowRoom ? rect.top + rect.height + pad + 6 : Math.max(12, rect.top - pad - 176);
    tipStyle = { top, left: "50%", transform: "translateX(-50%)" };
  } else {
    tipStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  return (
    <>
      {/* Replay button — disappears for good once the tutorial is finished */}
      {!done && (
        <button
          onClick={start}
          aria-label={es ? "Ver tutorial" : "Show tutorial"}
          className="fixed bottom-4 left-4 z-40 h-11 w-11 rounded-full bg-zinc-900/90 dark:bg-zinc-100/90 text-white dark:text-zinc-900 text-lg font-bold shadow-lg hover:scale-105 transition"
        >
          ?
        </button>
      )}

      {active && (
        <div className="fixed inset-0 z-[60]">
          {/* Click-blocking backdrop (dim handled by the cutout's box-shadow) */}
          <div className="absolute inset-0" />

          {/* Spotlight cutout around the target */}
          {rect && (
            <div
              className="absolute rounded-xl transition-all duration-200"
              style={{
                top: rect.top - pad,
                left: rect.left - pad,
                width: rect.width + pad * 2,
                height: rect.height + pad * 2,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
                pointerEvents: "none",
              }}
            />
          )}
          {/* Full dim when there's no target (welcome / done) */}
          {!rect && <div className="absolute inset-0 bg-black/70" />}

          {/* Tooltip card */}
          <div
            className="absolute w-[300px] max-w-[calc(100vw-24px)] rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl p-4"
            style={tipStyle}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-zinc-900 dark:text-zinc-100">{step.title}</h3>
              <span className="text-xs text-zinc-400">
                {i + 1}/{list.length}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-300">{step.body}</p>
            <div className="mt-4 flex items-center justify-between">
              <button onClick={finish} className="text-sm text-zinc-400 hover:text-zinc-600">
                {es ? "Saltar" : "Skip"}
              </button>
              <div className="flex items-center gap-2">
                {i > 0 && (
                  <button
                    onClick={back}
                    className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3.5 py-2 text-sm font-medium hover:border-emerald-500"
                  >
                    {es ? "Atrás" : "Back"}
                  </button>
                )}
                <button
                  onClick={next}
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-sm font-semibold active:scale-[0.98] transition"
                >
                  {isLast ? (es ? "Entendido" : "Got it") : i === 0 ? (es ? "Comenzar" : "Start") : es ? "Siguiente" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
