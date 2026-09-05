"use client";

import { useEffect, useState } from "react";
import { subscribeOfflineStatus, type OfflineStatus } from "@/lib/timetracker/offlineQueue";
import { useT } from "@/lib/timetracker/i18n";

// Fixed bottom-left pill reporting anything buffered by the offline queue
// (D-074), ported from timetracker-clean's App.jsx OfflineIndicator.
// G-9 (D-202): textos por claves offline.*.
export function OfflineIndicator() {
  const t = useT();
  const [s, setS] = useState<OfflineStatus>({ online: true, sessions: 0, shots: 0, total: 0 });
  useEffect(() => subscribeOfflineStatus(setS), []);
  if (s.online && s.total === 0) return null;
  const parts: string[] = [];
  if (s.sessions) parts.push(s.sessions > 1 ? t("offline.timeUpdateMany", { n: s.sessions }) : t("offline.timeUpdateOne", { n: s.sessions }));
  if (s.shots) parts.push(s.shots > 1 ? t("offline.shotMany", { n: s.shots }) : t("offline.shotOne", { n: s.shots }));
  const queued = parts.join(" + ");
  return (
    <div
      style={{ position: "fixed", left: 16, bottom: 16, zIndex: 9997, maxWidth: 320 }}
      className="box"
      title={t("offline.tooltip")}
    >
      <div className="small" style={{ fontWeight: 700 }}>
        {s.online ? t("offline.syncing") : t("offline.offline")}
      </div>
      <div className="small muted">
        {s.total > 0
          ? (s.online ? t("offline.queuedNow", { queued }) : t("offline.queuedLater", { queued }))
          : t("offline.noConnection")}
      </div>
    </div>
  );
}
