"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { APP_VERSIONS, type AppKey } from "@/lib/app-versions";
import {
  APK_DOWNLOAD_URL,
  installedApkVersion,
  markSoftReload,
  pickSoftReloadJitter,
  safeToReload,
  shouldSoftReload,
  softReloadTried,
  updateAvailable,
  type SoftReloadTrigger,
  webUpdateAvailable,
  type VersionInfo,
} from "@/lib/app-update";

// ============================================================
// Tells anyone running an outdated app that a newer one exists.
//
// TWO different kinds of stale, which people confuse constantly:
//
//  WEB  — the page is running JavaScript from an earlier deploy. This is the
//         common one and nobody notices it: the APK shell loads the live site,
//         so a deploy IS the update, but only for pages loaded after it. A
//         phone open in a truck cradle since 6 a.m. is still running that
//         morning's code, with every fix since then sitting on the server.
//         Fixed by a reload, which the app can do by itself.
//
//  APK  — the native shell itself is old (permissions, the GPS plugin, the
//         battery guard). No reload can fix that; a new APK must be installed.
//         This is rare and is the only one that needs the driver to act.
//
// The web one auto-heals, softly (D-563, replacing in part D-029): the banner
// shows at once with an "Update" button, and the page reloads by itself only
// after a random delay (0–5 min, so thousands of clients don't hit Supabase in
// the same second — measured 2026-10-15) AND at a moment that is already a page
// change for the person: a route navigation, or the tab coming back from hidden.
// A page left visible and untouched gets there through an idle fallback. Never
// while something is half-finished on screen (safeToReload) — reloading through
// a signature or a half-typed form would throw away exactly the work that is
// most annoying to redo at a customer's door. The rule itself is the pure
// shouldSoftReload in app-update.ts, where the tests are.
// ============================================================

/** How often a running page asks whether it has gone stale. */
const POLL_MS = 5 * 60_000;

// `app` is static per mount (D-087) — each layout only ever wraps its own
// route tree, so there's exactly one right answer for every call site; this
// never needs to detect anything at runtime.
export function AppUpdateBanner({ app }: { app: AppKey }) {
  const { t } = usePrefs();
  // Read after mount: the server has no user agent, and rendering different
  // HTML there than on the client breaks hydration.
  const [apkStale, setApkStale] = useState(false);
  const [webStale, setWebStale] = useState(false);
  const [served, setServed] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // When this page first saw itself stale, and its random share of the spread.
  // Picked once per page; a deploy that goes back to our version clears it.
  const [detectedAt, setDetectedAt] = useState<number | null>(null);
  const jitterRef = useRef(0);
  const lastInputRef = useRef(Date.now());
  // The reload attempt, reachable from the pathname effect below.
  const attemptRef = useRef<((trigger: SoftReloadTrigger) => void) | null>(null);
  const pathname = usePathname();
  const prevPathRef = useRef(pathname);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const info = (await res.json()) as VersionInfo;
      const servedForThisApp = info.versions?.[app];
      setServed(servedForThisApp ?? null);
      const stale = webUpdateAvailable(APP_VERSIONS[app], servedForThisApp);
      setWebStale(stale);
      if (!stale) jitterRef.current = 0;
      else if (jitterRef.current === 0) jitterRef.current = pickSoftReloadJitter();
      setDetectedAt((prev) => (!stale ? null : prev ?? Date.now()));
      // The APK is the driver shell, which loads deliveries specifically —
      // not a fourth app of its own (see the comment on /api/version) — so
      // it's only ever relevant on the deliveries banner.
      if (app === "deliveries") {
        const installed = installedApkVersion(navigator.userAgent);
        setApkStale(installed != null && typeof info.apk === "number" && installed < info.apk);
      }
    } catch {
      // Offline, or the deploy is mid-flight. Silence is right: a driver in a
      // dead zone must not be told their app is broken.
    }
  }, [app]);

  useEffect(() => {
    // Works even before the first fetch answers, from the build-time constant.
    if (app === "deliveries") setApkStale(updateAvailable(navigator.userAgent));
    void check();
    const id = setInterval(() => void check(), POLL_MS);
    const onBack = () => { if (!document.hidden) void check(); };
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onBack);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onBack);
    };
  }, [check]);

  // Soft self-heal (D-563). The decision is shouldSoftReload; this only feeds it.
  useEffect(() => {
    if (!webStale || detectedAt == null || !served) { attemptRef.current = null; return; }
    const attempt = (trigger: SoftReloadTrigger) => {
      const go = shouldSoftReload({
        stale: true,
        trigger,
        hidden: document.hidden,
        unsaved: !safeToReload(document),
        alreadyTried: softReloadTried(served),
        now: Date.now(),
        detectedAt,
        jitterMs: jitterRef.current,
        lastInputAt: lastInputRef.current,
      });
      if (!go) return;
      // Recorded before reloading: if the page comes back still stale for this same
      // version, it must not reload again — the banner's button stays instead.
      markSoftReload(served);
      reloadNow();
    };
    attemptRef.current = attempt;
    // Only the hidden → visible transition: plain window focus fires every time
    // someone clicks back into the browser, which is not a page change for them.
    const onVisible = () => { if (document.visibilityState === "visible") setTimeout(() => attempt("visible"), 250); };
    const onInput = () => { lastInputRef.current = Date.now(); };
    const tick = setInterval(() => attempt("idle"), 60_000);
    document.addEventListener("visibilitychange", onVisible);
    for (const ev of INPUT_EVENTS) window.addEventListener(ev, onInput, { passive: true });
    return () => {
      attemptRef.current = null;
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput);
    };
  }, [webStale, detectedAt, served]);

  // A route navigation is a page change the person asked for: the safe moment.
  useEffect(() => {
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;
    attemptRef.current?.("navigation");
  }, [pathname]);

  if (dismissed) return null;

  // The APK is the harder problem, so it wins the banner when both are true:
  // installing the new shell reloads the page anyway.
  if (apkStale) {
    return (
      <Bar>
        <span>⬆ {t("A new version of the app is available.", "Hay una nueva versión de la app.")}</span>
        <a href={APK_DOWNLOAD_URL} style={pill}>{t("Update", "Actualizar")}</a>
        <Dismiss onClick={() => setDismissed(true)} label={t("Later", "Después")} />
      </Bar>
    );
  }

  if (webStale) {
    return (
      <Bar>
        <span>
          ✨ {t("A new version is available", "Hay una versión nueva")}
        </span>
        <button
          onClick={reloadNow}
          title={t(`Version ${served ?? ""} — you're on ${APP_VERSIONS[app]}`, `Versión ${served ?? ""} — estás en la ${APP_VERSIONS[app]}`)}
          style={{ ...pill, border: "none", cursor: "pointer" }}
        >
          {t("Update", "Actualizar")}
        </button>
      </Bar>
    );
  }

  return null;
}

/** Activity that counts as "someone is using this page" for the idle fallback. */
const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

/**
 * Reload, automatic or by the button. Un aviso, no un freno (D-195): la actualización se hace
 * igual. Quien tenga algo que dejar grabado antes del salto —el cronómetro de Time Tracker, que
 * manda su último latido y deja la marca de reanudación— escucha este evento. Nadie puede cancelarlo.
 */
function reloadNow() {
  window.dispatchEvent(new Event("rtg:before-reload"));
  window.location.reload();
}

const pill: React.CSSProperties = {
  background: "rgba(255,255,255,.22)", color: "#fff", textDecoration: "none",
  padding: "3px 12px", borderRadius: 7, fontWeight: 700, fontSize: 13.5,
};

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: 12, flexWrap: "wrap", padding: "4px 14px",
        background: "var(--accent)", color: "#fff", fontSize: 13.5, fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function Dismiss({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 15, padding: "0 4px" }}
    >
      ✕
    </button>
  );
}
