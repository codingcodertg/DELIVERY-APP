"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { stageInfo } from "@/lib/constants";
import { ASSIGNED_KIND, AYUDA_ATENDIDA_KIND } from "@/lib/notifications";
import { AYUDA_MENSAJE_KIND, AYUDA_RESPUESTA_KIND, destinoDelAvisoDeAyuda } from "@/lib/help-thread";

// Compact "3m", "2h", "4d" relative time for the notification list.
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Bell with an unread badge + dropdown of the current user's workflow alerts. */
export function NotificationBell() {
  const { notifications, markNotifRead, markAllNotifsRead } = useData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Mark read and jump to the order the notification is about.
  const onPick = (id: string, read: boolean, deliveryId: string | null, kind: string) => {
    if (!read) markNotifRead(id);
    setOpen(false);
    // Los avisos de ayuda no son de una orden y no llevaban a ningún sitio, tampoco el de «atendida»
    // de D-301. Ahora llevan a la conversación: a «Mis solicitudes», o a la vista del admin (D-311).
    const ayuda = destinoDelAvisoDeAyuda(kind);
    if (ayuda) router.push(ayuda);
    else if (deliveryId) router.push(`/?order=${deliveryId}`);
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
        title="Notifications"
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
            <b>Notifications</b>
            {unread > 0 && (
              <button className="notif-clear" onClick={() => markAllNotifsRead()}>
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="notif-empty">You&apos;re all caught up 🎉</div>
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
                  : stageInfo(n.kind).color;
                return (
                  <button
                    key={n.id}
                    className={"notif-item" + (n.read ? "" : " unread")}
                    onClick={() => onPick(n.id, n.read, n.delivery_id, n.kind)}
                  >
                    <span className="notif-dot" style={{ background: dotColor }} />
                    <span className="notif-body">
                      <span className="notif-msg">{n.message}</span>
                      <span className="notif-time">{ago(n.created_at)}</span>
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
