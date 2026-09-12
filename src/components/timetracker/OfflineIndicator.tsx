"use client";

import { useEffect, useState } from "react";
import { ackDiscarded, hayAlgoQueDecir, subscribeOfflineStatus, type OfflineStatus } from "@/lib/timetracker/offlineQueue";
import { useT } from "@/lib/timetracker/i18n";

// Fixed bottom-left pill reporting anything buffered by the offline queue
// (D-074), ported from timetracker-clean's App.jsx OfflineIndicator.
// G-9 (D-202): textos por claves offline.*.
export function OfflineIndicator() {
  const t = useT();
  const [s, setS] = useState<OfflineStatus>({ online: true, sessions: 0, shots: 0, total: 0, discarded: 0 });
  useEffect(() => subscribeOfflineStatus(setS), []);
  // La condición vive en `offlineQueue` y está probada allí (D-NEXT). Antes era
  // `s.online && s.total === 0`, que escondía el indicador exactamente cuando hay un descarte
  // que contar: para entonces la cola ya se vació y `total` es cero.
  if (!hayAlgoQueDecir(s)) return null;
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
        {/* Con la cola vacía y solo descartes que contar, «sincronizando» sería falso: no queda
            nada que sincronizar, y eso es justo el problema. */}
        {!s.online ? t("offline.offline") : s.total > 0 ? t("offline.syncing") : t("offline.discardedTitle")}
      </div>
      <div className="small muted">
        {s.total > 0
          ? (s.online ? t("offline.queuedNow", { queued }) : t("offline.queuedLater", { queued }))
          : t("offline.noConnection")}
      </div>
      {/* Lo que se perdió va aparte de lo que está pendiente, y en otro tono, porque son dos
          noticias distintas: una se va a resolver sola y la otra no. Se reconoce a mano —el
          botón pone el contador a cero— para que no se lo lleve por delante el siguiente
          repintado antes de que a nadie le dé tiempo a leerlo. */}
      {s.discarded > 0 && (
        <div className="small" style={{ marginTop: 6, fontWeight: 600 }}>
          {s.discarded > 1
            ? t("offline.discardedMany", { n: s.discarded })
            : t("offline.discardedOne", { n: s.discarded })}
          {" "}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => ackDiscarded()}>
            {t("offline.discardedAck")}
          </button>
        </div>
      )}
    </div>
  );
}
