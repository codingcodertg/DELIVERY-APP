"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { srcDeFoto } from "@/lib/fotos-en-storage";

// ============================================================
// Full-screen photo viewer with zoom.
//
// Tapping a photo used to call window.open, which does nothing inside the
// Android WebView — no popup handler, no new tab, no error. From the driver's
// side the picture simply wasn't clickable, and the one place a delivery photo
// actually matters is the phone it was taken on.
//
// Zoom is handled here rather than left to the browser: a WebView with a fixed
// viewport won't pinch a page element, and the photo is exactly what someone
// needs to enlarge — a lot number, a damaged corner, a signature on a slip.
// ============================================================

const MAX_SCALE = 6;
const MIN_SCALE = 1;

interface Credit { name: string; role: string }

export function PhotoLightbox({
  photos,
  index,
  credits,
  urls,
  onIndex,
  onClose,
  t,
}: {
  photos: string[];
  index: number;
  credits?: Record<string, { name: string; role: string } | undefined>;
  /** Con qué `src` se enseña cada foto (178): la URL firmada de una ruta del cubo. Sin entrada, la foto misma (`data:`). */
  urls?: Record<string, string>;
  onIndex: (i: number) => void;
  onClose: () => void;
  t: (en: string, es: string) => string;
}) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  // Live pointers, so one finger pans and two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const foto = photos[index];
  const src = srcDeFoto(foto, urls);
  const credit: Credit | undefined = credits?.[foto];

  const reset = useCallback(() => { setScale(1); setPan({ x: 0, y: 0 }); }, []);
  // A new photo always opens un-zoomed; carrying the previous zoom over lands
  // the viewer somewhere in the middle of an image they haven't seen yet.
  useEffect(() => { reset(); }, [index, reset]);

  const go = useCallback((delta: number) => {
    if (photos.length < 2) return;
    onIndex((index + delta + photos.length) % photos.length);
  }, [index, photos.length, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go, reset]);

  const clampPan = (p: { x: number; y: number }, s: number) => {
    // Don't let the photo be dragged entirely off screen; at 1x there is
    // nowhere to go at all.
    const el = frameRef.current;
    if (!el || s <= 1) return { x: 0, y: 0 };
    const limitX = (el.clientWidth * (s - 1)) / 2 / s;
    const limitY = (el.clientHeight * (s - 1)) / 2 / s;
    return {
      x: Math.max(-limitX, Math.min(limitX, p.x)),
      y: Math.max(-limitY, Math.min(limitY, p.y)),
    };
  };

  const applyScale = (next: number) => {
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
    setScale(s);
    setPan((p) => clampPan(p, s));
    return s;
  };

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      pinchStart.current = { dist: dist(), scale };
      panStart.current = null;
    } else if (pointers.current.size === 1 && scale > 1) {
      panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const ratio = dist() / (pinchStart.current.dist || 1);
      applyScale(pinchStart.current.scale * ratio);
      return;
    }
    if (panStart.current && scale > 1) {
      const dx = (e.clientX - panStart.current.x) / scale;
      const dy = (e.clientY - panStart.current.y) / scale;
      setPan(clampPan({ x: panStart.current.px + dx, y: panStart.current.py + dy }, scale));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) panStart.current = null;
  };

  return (
    <div className="lb" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lb-bar">
        <span className="lb-title">
          {photos.length > 1 && <b>{index + 1}/{photos.length}</b>}
          {credit && (
            <span className="lb-credit">
              {credit.name} <span className="lb-role">{credit.role}</span>
            </span>
          )}
        </span>
        <button className="lb-btn" onClick={() => applyScale(scale - 0.5)} disabled={scale <= MIN_SCALE} title={t("Zoom out", "Alejar")}>−</button>
        <button className="lb-btn" onClick={() => applyScale(scale + 0.5)} disabled={scale >= MAX_SCALE} title={t("Zoom in", "Acercar")}>+</button>
        <button className="lb-btn" onClick={reset} disabled={scale === 1} title={t("Reset zoom", "Restablecer")}>⤢</button>
        <button className="lb-btn lb-close" onClick={onClose} title={t("Close", "Cerrar")}>✕</button>
      </div>

      <div
        ref={frameRef}
        className="lb-frame"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => applyScale(scale + (e.deltaY < 0 ? 0.3 : -0.3))}
        // Double-tap is what people try first on a phone.
        onDoubleClick={() => (scale > 1 ? reset() : applyScale(2.5))}
        style={{ cursor: scale > 1 ? "grab" : "zoom-in", touchAction: "none" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          draggable={false}
          style={{ transform: `scale(${scale}) translate(${pan.x}px, ${pan.y}px)` }}
        />
      </div>

      {photos.length > 1 && (
        <>
          <button className="lb-nav lb-prev" onClick={() => go(-1)} title={t("Previous", "Anterior")}>‹</button>
          <button className="lb-nav lb-next" onClick={() => go(1)} title={t("Next", "Siguiente")}>›</button>
        </>
      )}

      <div className="lb-hint">
        {t("Pinch or double-tap to zoom · tap outside to close",
           "Pellizca o toca dos veces para acercar · toca fuera para cerrar")}
      </div>
    </div>
  );
}
