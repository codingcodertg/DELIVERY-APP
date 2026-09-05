"use client";

import { useEffect, useRef, useState } from "react";
import {
  desktopCheckUpdate, desktopGetUpdateState, desktopInstallUpdate, desktopOnUpdate, isDesktop,
  type DesktopUpdateState,
} from "@/lib/timetracker/desktop";
import { useT } from "@/lib/timetracker/i18n";

// Electron desktop's own in-app auto-update banner (D-074), ported from
// timetracker-clean's App.jsx UpdateBanner — unrelated to AppUpdateBanner
// (which tracks THIS Next.js deploy going stale). This one reports on
// electron-updater's state in the desktop shell (desktop/main.js's
// tt:update IPC channel): downloading progress and, once ready, a
// "Restart & install" button. Desktop-only, no-ops everywhere else.
// G-9 (D-202): textos por claves update.*. El mensaje de error de electron-updater (u.message) no se toca.
export function TtUpdateBanner() {
  const [u, setU] = useState<DesktopUpdateState | null>(null);
  const [desktopClient, setDesktopClient] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isDesktop()) return undefined;
    setDesktopClient(true);
    const apply = (s: DesktopUpdateState) => {
      setU(s);
      if (timerRef.current) clearTimeout(timerRef.current);
      // transient states (incl. the automatic launch check) shouldn't linger
      if (s && (s.state === "none" || s.state === "error")) {
        timerRef.current = setTimeout(() => setU(null), 5000);
      }
    };
    desktopGetUpdateState().then((s) => { if (s) apply(s); });
    const off = desktopOnUpdate(apply);
    return () => { off(); if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  if (!desktopClient) return null;

  return (
    <>
      {u && <UpdateBannerBody u={u} />}
    </>
  );
}

function UpdateBannerBody({ u }: { u: DesktopUpdateState }) {
  const t = useT();
  const s = u.state;
  if (s === "ready") {
    return (
      <div className="banner ok" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span>{t("update.ready", { v: u.version ?? "" })}</span>
        <button className="btn-ok btn-sm" onClick={() => desktopInstallUpdate()}>{t("update.install")}</button>
      </div>
    );
  }
  if (s === "downloading") {
    return (
      <div className="banner info">
        {t("update.downloading", { v: u.version ? " v" + u.version : "", pct: u.percent != null ? u.percent + "%" : "" })}
        <div style={{ background: "var(--tt-line)", borderRadius: 999, height: 6, overflow: "hidden", marginTop: 6 }}>
          <div style={{ width: (u.percent || 0) + "%", height: "100%", background: "var(--tt-accent2)", transition: "width .3s" }} />
        </div>
      </div>
    );
  }
  if (s === "checking") return <div className="banner info">{t("update.checking")}</div>;
  if (s === "none") return <div className="banner info">{t("update.latest")}</div>;
  if (s === "error") return <div className="banner warn">{t("update.failed", { msg: u.message || t("update.unknownError") })}</div>;
  return null;
}

// Manual "Check for updates" control — desktop-only, tiny, meant for the
// TopBar corner (mirrors the original's footer link).
export function TtCheckUpdateLink() {
  const t = useT();
  const [desktopClient, setDesktopClient] = useState(false);
  useEffect(() => { setDesktopClient(isDesktop()); }, []);
  if (!desktopClient) return null;
  return (
    <button
      className="btn-ghost btn-sm"
      style={{ background: "rgba(255,255,255,.1)", color: "#fff" }}
      onClick={() => desktopCheckUpdate()}
      title={t("update.check")}
    >
      ⟳
    </button>
  );
}
