"use client";

// Bridge to the Electron desktop shell (timetracker-clean/desktop), ported
// from timetracker-clean's web/src/lib/desktop.js (D-074). Every function
// here no-ops when there is no window.ttDesktop — i.e. always, in a plain
// browser tab — so this file is safe to import from a route that renders in
// both the browser and the desktop shell.
//
// Unlike the original (a Vite app that never runs on the server), this is a
// Next.js client component module: `window` doesn't exist during SSR, so
// isDesktop() is a function checked at call time, never a load-time
// constant.

export type DesktopShotData = {
  sessionId: string | null;
  dataUrl?: string;
  blank?: boolean;
  activityPercent?: number;
};

export type DesktopUpdateState = {
  state: "idle" | "checking" | "downloading" | "ready" | "none" | "error";
  version?: string;
  percent?: number;
  message?: string;
};

type DesktopBridge = {
  isDesktop: boolean;
  start: (opts: { sessionId: string; intervalMin?: number }) => Promise<{ ok: boolean }>;
  stop: () => Promise<{ ok: boolean }>;
  onShot: (cb: (data: DesktopShotData) => void) => () => void;
  getActivity: () => Promise<{ keystrokes: number; clicks: number; moves: number }>;
  getContext?: () => Promise<{ app: string; title: string; movement: number } | null>;
  onPower?: (cb: (reason: string) => void) => () => void;
  getVersion?: () => Promise<string>;
  notifyShotStatus?: (status: string) => Promise<boolean>;
  onUpdate?: (cb: (u: DesktopUpdateState) => void) => () => void;
  getUpdateState?: () => Promise<DesktopUpdateState>;
  checkForUpdates?: () => Promise<boolean>;
  installUpdate?: () => Promise<boolean>;
  /** Pulso de «el latido se guardó» (D-NEXT). Solo lo tienen los cascarones nuevos; el 0.0.45 no. */
  heartbeat?: (h: { sessionId: string; at: number }) => void;
};

declare global {
  interface Window {
    ttDesktop?: DesktopBridge;
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && !!window.ttDesktop?.isDesktop;
}

// The main process fires exactly one screenshot per fixed 10-min window
// (desktop/main.js's WINDOW_MS) regardless of any interval setting; this is
// only the display label the original showed, kept for parity.
export const DESKTOP_SHOT_MIN = 10;

export function desktopStart(opts: { sessionId: string; intervalMin?: number }) {
  if (!isDesktop()) return;
  try { window.ttDesktop!.start(opts); } catch { /* ignore */ }
}

export function desktopStop() {
  if (!isDesktop()) return;
  try { window.ttDesktop!.stop(); } catch { /* ignore */ }
}

/**
 * Le dice al cascarón que el latido se guardó de verdad (D-NEXT). Con él, el proceso principal
 * puede vigilar por su cuenta —y avisar con su ventana flotante y un pitido— cuando la página
 * deja de grabar. En el 0.0.45 instalado no existe y esto no hace nada.
 */
export function desktopHeartbeat(h: { sessionId: string; at: number }) {
  if (!isDesktop()) return;
  try { window.ttDesktop!.heartbeat?.(h); } catch { /* ignore */ }
}

export function desktopOnShot(cb: (data: DesktopShotData) => void): () => void {
  if (!isDesktop()) return () => {};
  try { return window.ttDesktop!.onShot(cb); } catch { return () => {}; }
}

export function desktopNotifyShotStatus(status: string) {
  if (!isDesktop()) return;
  try { window.ttDesktop!.notifyShotStatus?.(status); } catch { /* ignore */ }
}

export async function desktopGetActivity() {
  if (!isDesktop()) return null;
  try { return await window.ttDesktop!.getActivity(); } catch { return null; }
}

// { app, title, movement } for smart-idle (on-screen motion counts as
// activity even with no keyboard/mouse input). Null on web or if unavailable.
export async function desktopGetContext() {
  if (!isDesktop() || !window.ttDesktop!.getContext) return null;
  try { return await window.ttDesktop!.getContext!(); } catch { return null; }
}

// Subscribe to OS lock/sleep events. Returns an unsubscribe function; no-ops
// on web.
export function desktopOnPower(cb: (reason: string) => void): () => void {
  if (!isDesktop() || !window.ttDesktop!.onPower) return () => {};
  try { return window.ttDesktop!.onPower!(cb); } catch { return () => {}; }
}

export async function desktopGetVersion() {
  if (!isDesktop() || !window.ttDesktop!.getVersion) return null;
  try { return await window.ttDesktop!.getVersion!(); } catch { return null; }
}

// --- auto-update (desktop only; all no-op on web) ---
export function desktopOnUpdate(cb: (u: DesktopUpdateState) => void): () => void {
  if (!isDesktop() || !window.ttDesktop!.onUpdate) return () => {};
  try { return window.ttDesktop!.onUpdate!(cb); } catch { return () => {}; }
}

export async function desktopGetUpdateState(): Promise<DesktopUpdateState | null> {
  if (!isDesktop() || !window.ttDesktop!.getUpdateState) return null;
  try { return await window.ttDesktop!.getUpdateState!(); } catch { return null; }
}

export function desktopCheckUpdate() {
  try { window.ttDesktop?.checkForUpdates?.(); } catch { /* ignore */ }
}

export function desktopInstallUpdate() {
  try { window.ttDesktop?.installUpdate?.(); } catch { /* ignore */ }
}
