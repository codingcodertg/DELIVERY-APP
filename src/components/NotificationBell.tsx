"use client";

import { KIND_TOMADA_POR_CHOFER } from "@/lib/tomar-orden";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { stageInfo } from "@/lib/constants";
import { ASSIGNED_KIND, AYUDA_ATENDIDA_KIND } from "@/lib/notifications";
import type { AppNotification } from "@/lib/notifications";
import { AYUDA_MENSAJE_KIND, AYUDA_RESPUESTA_KIND } from "@/lib/help-thread";
import { AVISO_SOLICITUD_APROBADA, AVISO_SOLICITUD_NUEVA, AVISO_SOLICITUD_RECHAZADA } from "@/lib/solicitud-de-asignacion";
import { destinoDelAviso } from "@/lib/destino-del-aviso";
import { AVISO_CLIENTE_APROBADA, AVISO_CLIENTE_NUEVA, AVISO_CLIENTE_RECHAZADA, AVISO_CLIENTE_REVISAR, mensajeDelAviso } from "@/lib/customers/avisos-de-solicitud";
import { usePrefs } from "@/lib/prefs";

// Compact "3m", "2h", "4d" relative time for the notification list.
function ago(iso: string, t: (en: string, es: string) => string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return t("just now", "ahora");
  const mins = Math.round(secs / 60);
  if (mins < 60) return t(`${mins}m ago`, `hace ${mins} min`);
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t(`${hrs}h ago`, `hace ${hrs} h`);
  const dias = Math.round(hrs / 24);
  return t(`${dias}d ago`, `hace ${dias} d`);
}

/** Bell with an unread badge + dropdown of the current user's workflow alerts. */
export function NotificationBell() {
  const { notifications, markNotifRead, markAllNotifsRead } = useData();
  return <CampanaDeAvisos notifications={notifications} markNotifRead={markNotifRead} markAllNotifsRead={markAllNotifsRead} />;
}

/**
 * La campana en sí, sin saber de dónde salen los avisos (D-867): Entregas se los da desde su `DataProvider`; Clientes,
 * desde `useAvisosPropios` (`CampanaDeClientes`). La misma tabla (`public.notifications`), el mismo aspecto.
 */
export function CampanaDeAvisos({ notifications, markNotifRead, markAllNotifsRead }: {
  notifications: readonly AppNotification[];
  markNotifRead: (id: string) => unknown;
  markAllNotifsRead: () => unknown;
}) {
  const { t, lang } = usePrefs();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Mark read and jump to the order the notification is about.
  // Los de ayuda, a la conversación (D-311); las solicitudes de asignación, a la bandeja o a su orden (D-560); los de
  // Clientes, a su `link` (D-867). La regla está en `lib/destino-del-aviso.ts`.
  const onPick = (n: AppNotification) => {
    if (!n.read) markNotifRead(n.id);
    setOpen(false);
    const destino = destinoDelAviso(n);
    if (destino) router.push(destino);
  };

  const unread = notifications.filter((n) => !n.read).length;

  const toggle = () => {
    if (!open && btnRef.current) setAnchor(btnRef.current.getBoundingClientRect());
    setOpen((v) => !v);
  };

  // The panel renders in a portal (see below) — a topbar with many admin
  // tabs wraps onto multiple lines, so the bell isn't reliably near the
  // right edge, and a plain right:0 popover could land mostly off-screen.
  // Reposition on scroll/resize while open, and close on an outside click
  // (checking both the button and the portaled panel, since they're no
  // longer DOM descendants of each other).
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      // ONLY when it actually moved.
      //
      // The scroll listener below is registered in the CAPTURE phase on
      // window, so it also catches scrolling inside the panel's own list —
      // which is where a driver scrolls. getBoundingClientRect() hands back a
      // new object every call, so setting it unconditionally re-rendered the
      // top bar, the portal and the whole notification list on every scroll
      // event. At 60 events a second that locked the app up on a phone.
      //
      // The button doesn't move when an inner list scrolls, so this drops
      // almost all of those renders.
      setAnchor((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.right === r.right && prev.width === r.width
          ? prev
          : r);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const PANEL_WIDTH = 320;

  return (
    <div className="notif-wrap">
      <button
        ref={btnRef}
        className="tab tab-icon notif-btn"
        style={{ background: "rgba(255,255,255,.1)" }}
        onClick={toggle}
        title={t("Notifications", "Avisos")}
        aria-label={t("Notifications", "Avisos")}
      >
        🔔
        {unread > 0 && <span className="notif-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && anchor && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          className="notif-panel"
          style={{
            position: "fixed",
            right: "auto",
            top: anchor.bottom + 8,
            left: Math.max(8, Math.min(anchor.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8)),
          }}
        >
          <div className="notif-head">
            <b>{t("Notifications", "Avisos")}</b>
            {unread > 0 && (
              <button className="notif-clear" onClick={() => markAllNotifsRead()}>
                {t("Mark all read", "Marcar todo leído")}
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="notif-empty">{t("You're all caught up 🎉", "Estás al día 🎉")}</div>
          ) : (
            <div className="notif-list">
              {notifications.map((n) => {
                // `stageInfo` cae a la PRIMERA etapa cuando la clave no es una etapa, así que un
                // `kind` que no lo sea se pinta con un color prestado sin que nada chirríe. Los que
                // no son etapas llevan el suyo, explícito.
                const dotColor =
                  n.kind === ASSIGNED_KIND ? "var(--accent)"
                  : n.kind === AYUDA_ATENDIDA_KIND ? "var(--green)"
                  : n.kind === AYUDA_RESPUESTA_KIND || n.kind === AYUDA_MENSAJE_KIND ? "var(--amber)"
                  : n.kind === AVISO_SOLICITUD_NUEVA ? "var(--amber)"
                  : n.kind === AVISO_SOLICITUD_APROBADA ? "var(--green)"
                  : n.kind === AVISO_SOLICITUD_RECHAZADA ? "var(--red)"
                  : n.kind === KIND_TOMADA_POR_CHOFER ? "var(--amber)"
                  : n.kind === AVISO_CLIENTE_NUEVA || n.kind === AVISO_CLIENTE_REVISAR ? "var(--amber)"
                  : n.kind === AVISO_CLIENTE_APROBADA ? "var(--green)"
                  : n.kind === AVISO_CLIENTE_RECHAZADA ? "var(--red)"
                  : stageInfo(n.kind).color;
                return (
                  <button
                    key={n.id}
                    className={"notif-item" + (n.read ? "" : " unread")}
                    onClick={() => onPick(n)}
                  >
                    <span className="notif-dot" style={{ background: dotColor }} />
                    <span className="notif-body">
                      <span className="notif-msg">{mensajeDelAviso(n, lang)}</span>
                      <span className="notif-time">{ago(n.created_at, t)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
