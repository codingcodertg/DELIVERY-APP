"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { APP_VERSIONS, type AppKey } from "@/lib/app-versions";
import {
  APK_DOWNLOAD_URL,
  installedApkVersion,
  safeToReload,
  updateAvailable,
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
// The web one auto-heals: the moment the app is brought back to the foreground
// and nothing is half-finished on screen, it reloads. That is chosen carefully
// — reloading while a signature or a half-typed form is open would throw away
// exactly the work that is most annoying to redo at a customer's door.
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
  // A page that reloads and STILL looks stale would reload forever. One
  // automatic attempt; after that the banner asks instead.
  const reloadedRef = useRef(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const info = (await res.json()) as VersionInfo;
      const servedForThisApp = info.versions?.[app];
      setServed(servedForThisApp ?? null);
      setWebStale(webUpdateAvailable(APP_VERSIONS[app], servedForThisApp));
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

  // Self-heal. Coming back to the app is the safe moment: the driver isn't
  // mid-tap, and a fresh page is what they expect after switching away.
  useEffect(() => {
    if (!webStale || reloadedRef.current) return;
    const tryReload = () => {
      if (document.hidden || !safeToReload(document) || reloadedRef.current) return;
      reloadedRef.current = true;
      // Un aviso, no un freno (D-NEXT): la actualización se hace igual. Quien tenga algo que
      // dejar grabado antes del salto —el cronómetro de Time Tracker, que manda su último
      // latido y deja la marca de reanudación— escucha este evento. Nadie puede cancelarlo.
      window.dispatchEvent(new Event("rtg:before-reload"));
      window.location.reload();
    };
    const onBack = () => setTimeout(tryReload, 250);
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [webStale]);

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
          ✨ {t(
            `Version ${served ?? ""} is ready — you're on ${APP_VERSIONS[app]}.`,
            `La versión ${served ?? ""} está lista — estás en la ${APP_VERSIONS[app]}.`,
          )}
        </span>
        <button onClick={() => window.location.reload()} style={{ ...pill, border: "none", cursor: "pointer" }}>
          {t("Refresh now", "Actualizar ahora")}
        </button>
        <span style={{ opacity: 0.85, fontWeight: 500 }}>
          {t("(or it updates itself when you come back)", "(o se actualiza sola al volver)")}
        </span>
      </Bar>
    );
  }

  return null;
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
        gap: 12, flexWrap: "wrap", padding: "8px 14px",
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
      style={{ background: "none", border: "none", color: "#fff", opacity: 0.85, cursor: "pointer", fontSize: 15, padding: "0 4px" }}
    >
      ✕
    </button>
  );
}
