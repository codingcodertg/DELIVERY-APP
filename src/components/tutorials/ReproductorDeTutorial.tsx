"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { tutorialEmbed } from "@/lib/tutorials";
import { avanceDeYouTube, sabeAvisarAvance, seDioPorVisto, srcConApiDeYouTube } from "@/lib/tutorial-views";
import type { Tutorial } from "@/lib/types";

/**
 * El reproductor de un tutorial, el MISMO en la pantalla de Tutoriales y en el aviso al entrar (D-NEXT).
 *
 * Cómo se detecta «visto»:
 * - **YouTube**: el iframe se abre con `enablejsapi=1` y se le manda `{"event":"listening"}`; a partir de ahí el
 *   reproductor va mandando `infoDelivery` con `currentTime` y `duration` por `postMessage`. Al llegar al 90 %
 *   (`seDioPorVisto`) se marca solo. Es el protocolo que usa la propia API del iframe de YouTube, sin cargar su script.
 * - **Fichero de video** (`<video>`): `onTimeUpdate`, misma regla.
 * - **Loom, Vimeo, Drive y enlaces**: no avisan su avance de forma fiable; queda el botón «Marcar como visto».
 *
 * El botón sale siempre (también en YouTube): quien ya lo vio en otro sitio no tiene que verlo entero otra vez.
 */
export function ReproductorDeTutorial({ tut, visto, onVisto, ocupado = false }: {
  tut: Tutorial;
  visto: boolean;
  /** Marcar como visto (a mano o solo). `undefined` = sin sesión o sin dónde guardarlo: no sale el botón. */
  onVisto?: () => void | Promise<void>;
  ocupado?: boolean;
}) {
  const { t } = usePrefs();
  const em = tutorialEmbed(tut.url);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [avisado, setAvisado] = useState(false);
  const automatico = em.kind === "file" || (em.kind === "iframe" && sabeAvisarAvance(em.src));

  // Lo marca una sola vez por apertura, y nunca si ya está visto.
  const marcaSolo = () => {
    if (visto || avisado || !onVisto) return;
    setAvisado(true);
    void onVisto();
  };

  useEffect(() => {
    if (em.kind !== "iframe" || !sabeAvisarAvance(em.src) || visto || !onVisto) return;
    const escucha = (e: MessageEvent) => {
      if (!/^https:\/\/(www\.)?youtube(-nocookie)?\.com$/.test(e.origin)) return;
      if (iframe.current && e.source !== iframe.current.contentWindow) return;
      const a = avanceDeYouTube(e.data);
      if (a && seDioPorVisto(a.actual, a.duracion)) marcaSolo();
    };
    window.addEventListener("message", escucha);
    return () => window.removeEventListener("message", escucha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [em.kind, em.src, visto, avisado, onVisto]);

  // Al cargar el iframe se le pide que avise: sin `listening` YouTube no manda nada.
  const alCargar = () => {
    const w = iframe.current?.contentWindow;
    if (!w) return;
    try { w.postMessage(JSON.stringify({ event: "listening", id: tut.id, channel: "widget" }), "*"); } catch { /* sin API */ }
  };

  const origen = typeof window === "undefined" ? null : window.location.origin;

  return (
    <div style={{ padding: "6px 8px 4px", maxWidth: 560 }} data-tutorial-reproductor={tut.id}>
      {tut.description && <div className="hint" style={{ marginBottom: 6 }}>{tut.description}</div>}
      {em.kind === "iframe" ? (
        <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 10, overflow: "hidden", background: "#000" }}>
          <iframe
            ref={iframe}
            src={srcConApiDeYouTube(em.src, origen)}
            title={tut.title}
            onLoad={alCargar}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        </div>
      ) : em.kind === "file" ? (
        <video
          src={em.src}
          controls
          onTimeUpdate={(e) => { const v = e.currentTarget; if (seDioPorVisto(v.currentTime, v.duration)) marcaSolo(); }}
          style={{ width: "100%", borderRadius: 10, background: "#000" }}
        />
      ) : (
        <a className="btn btn-ghost btn-sm" href={em.src} target="_blank" rel="noopener noreferrer">▶ {t("Open video", "Abrir video")}</a>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {visto ? (
          <span className="hint" data-tutorial-estado="visto" style={{ color: "var(--green, #1a7f4b)", fontWeight: 700 }}>✓ {t("Watched", "Visto")}</span>
        ) : onVisto ? (
          <>
            <button type="button" className="btn btn-primary btn-sm" data-tutorial-marcar disabled={ocupado} onClick={() => void onVisto()}>
              {ocupado ? "…" : `✓ ${t("Mark as watched", "Marcar como visto")}`}
            </button>
            {automatico && (
              <span className="hint" style={{ margin: 0 }}>
                {t("It's marked for you when you reach the end.", "Se marca solo al llegar al final.")}
              </span>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
