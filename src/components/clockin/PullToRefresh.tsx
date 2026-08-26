"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Pull-to-refresh for the installed PWA (where the browser's own gesture is
 * gone). Pull down from the very top of the page to refresh the current view.
 */
export default function PullToRefresh() {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const active = useRef(false);
  const pullRef = useRef(0);
  const busy = useRef(false);
  const THRESHOLD = 70;

  useEffect(() => {
    const setP = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };
    function onStart(e: TouchEvent) {
      if (window.scrollY <= 0 && !busy.current) {
        startY.current = e.touches[0].clientY;
        active.current = true;
      }
    }
    function onMove(e: TouchEvent) {
      if (!active.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0 && window.scrollY <= 0) {
        setP(Math.min(dy * 0.5, 90)); // dampened
      } else {
        active.current = false;
        setP(0);
      }
    }
    function onEnd() {
      if (!active.current) return;
      active.current = false;
      if (pullRef.current >= THRESHOLD) {
        busy.current = true;
        setRefreshing(true);
        setP(56);
        router.refresh();
        window.setTimeout(() => {
          setRefreshing(false);
          setP(0);
          busy.current = false;
        }, 900);
      } else {
        setP(0);
      }
    }
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, [router]);

  return (
    <div
      aria-hidden
      className="fixed left-0 right-0 top-0 z-50 flex items-end justify-center overflow-hidden pointer-events-none"
      style={{ height: pull, transition: pull === 0 || refreshing ? "height 0.25s ease" : undefined }}
    >
      <span
        className={`mb-1.5 text-xl text-emerald-600 ${refreshing ? "animate-spin" : ""}`}
        style={{ opacity: Math.min(pull / THRESHOLD, 1), transform: `rotate(${pull * 3}deg)` }}
      >
        ↻
      </span>
    </div>
  );
}
