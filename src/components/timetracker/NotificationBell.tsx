"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getMyNotifications, countUnread } from "@/app/timetracker/clock-in/actions/myday";
import { markAllRead } from "@/app/timetracker/clock-in/actions/notifications";

/**
 * 🔔 en la barra de Time Tracker (D-129).
 *
 * Las notificaciones eran una pantalla del módulo de fichaje, y estar en otra app es lo peor
 * que le puede pasar a un aviso: solo lo ves si vas a buscarlo, que es justo lo contrario de
 * para lo que sirve.
 *
 * El contador se pide con `head: true` — trae **cuántas** hay sin leer, no los textos. Los
 * mensajes se piden solo al abrir el panel. La campana está en todas las pantallas, así que
 * cobrar sesenta filas cada vez que alguien navega habría sido pagar mucho por un número.
 */
export function NotificationBell() {
  const [n, setN] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const [items, setItems] = useState<{ id: string; message: string; read: boolean; created_at: string }[] | null>(null);
  const caja = useRef<HTMLDivElement>(null);

  const contar = useCallback(() => { void countUnread().then(setN); }, []);

  useEffect(() => {
    contar();
    // Un minuto: un aviso que llega tarde un minuto sigue sirviendo, y preguntar cada segundo
    // por un número que casi nunca cambia es gasto sin nada a cambio.
    const id = setInterval(contar, 60_000);
    return () => clearInterval(id);
  }, [contar]);

  // Cerrar al pulsar fuera. Sin esto el panel se queda abierto tapando la pantalla y hay que
  // volver a la campana para quitarlo.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  async function alternar() {
    const siguiente = !abierto;
    setAbierto(siguiente);
    if (!siguiente) return;
    const r = await getMyNotifications();
    if (r.ok) setItems(r.items);
    // Se marcan leídas al ABRIR, no al cerrar: si alguien cierra la pestaña a media lectura,
    // no debería reencontrarse el mismo aviso como nuevo.
    if (n > 0) { await markAllRead(); setN(0); }
  }

  return (
    <div ref={caja} style={{ position: "relative" }}>
      <button
        className="btn-ghost btn-sm"
        style={{ background: "rgba(255,255,255,.1)", color: "#fff" }}
        onClick={() => void alternar()}
        title="Notifications"
      >
        🔔{n > 0 && <span className="pill off" style={{ marginLeft: 4 }}>{n > 9 ? "9+" : n}</span>}
      </button>

      {abierto && (
        <div
          style={{
            position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 60,
            width: 320, maxHeight: 380, overflowY: "auto",
            background: "var(--tt-panel)", border: "1px solid var(--tt-line)",
            borderRadius: 12, padding: 10, boxShadow: "0 12px 32px rgba(0,0,0,.35)",
          }}
        >
          {!items ? (
            <div className="hint">Loading…</div>
          ) : items.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>Nothing yet.</p>
          ) : (
            items.map((it) => (
              <div key={it.id} className="box" style={{ marginBottom: 6 }}>
                <div className="small">{it.message}</div>
                <div className="small muted">{new Date(it.created_at).toLocaleString()}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
