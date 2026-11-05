"use client";

import { useEffect, useRef } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { esImportante } from "@/lib/clase-del-aviso";
import type { Profile } from "@/lib/types";

// ============================================================
// Raises a real phone notification when a driver is handed a stop.
//
// The in-app bell is the record; this is what actually reaches someone whose
// phone is face-down in a truck cab. It's the payoff for the notification
// permission the gate now insists on.
//
// TWO THINGS IT MUST NOT DO:
//
//  1. Replay history. Everything already on screen when the app opens is
//     marked seen first, so a driver reopening at noon isn't pinged again for
//     this morning's route.
//  2. Ping once per stop. Dispatch assigns a whole day at once; eight buzzes
//     in eight seconds is how a driver learns to ignore the app. Anything that
//     arrives together is collapsed into one.
//
// LIMIT, and it is a bigger one than "while the app is running" suggests:
// this fires only while the app is IN THE FOREGROUND. Android suspends the
// WebView's JavaScript the moment the driver switches to another app —
// measured in production, natively-captured GPS fixes sat queued for 78
// minutes until the app was reopened. Switching apps is therefore close to the
// same thing as closing it, and the buzz would land when the driver comes back
// to the app, which is exactly when they no longer need it.
//
// Reaching a phone that isn't being looked at needs push (FCM) or a native
// poller — either way, native work and a new APK. The in-app bell is the
// reliable half and always holds the record.
// ============================================================

/** Wait this long after the first new one, so a batch arrives as one buzz. */
const COLLAPSE_MS = 4000;

export function AssignmentPing({ role }: { role: Profile["role"] }) {
  const { notifications } = useData();
  const { t } = usePrefs();
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const pending = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (role !== "driver") return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    // First pass only takes inventory. Whatever was already there is history.
    if (!primed.current) {
      for (const n of notifications) seen.current.add(n.id);
      primed.current = true;
      // Deliberately NOT asking for permission here. A permission prompt
      // raised from an effect is a modal the user never invited, and in an
      // Android WebView it can block the page outright. Since v1.4.0 the real
      // delivery path is FCM, whose permission the driver grants through the
      // gate on a screen built for it — this only rides along when the answer
      // is already yes.
      return;
    }

    // D-880: solo los avisos importantes hacen ruido; una asignación es secundaria y espera en la campana.
    const fresh = notifications.filter((n) => esImportante(n) && !n.read && !seen.current.has(n.id));
    for (const n of notifications) seen.current.add(n.id);
    if (!fresh.length) return;

    pending.current.push(...fresh.map((n) => n.message));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const batch = pending.current;
      pending.current = [];
      if (!batch.length || Notification.permission !== "granted") return;
      const body = batch.length === 1
        ? batch[0]
        : t(`${batch.length} new notifications`, `${batch.length} avisos nuevos`);
      try {
        // A fixed tag so a second batch REPLACES the first rather than
        // stacking — the driver only ever needs the latest count.
        new Notification(t("New notification", "Aviso nuevo"), { body, tag: "rtg-assigned" });
      } catch {
        // Some WebViews refuse to construct one without a service worker. The
        // in-app bell already has it either way.
      }
    }, COLLAPSE_MS);
  }, [notifications, role, t]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return null;
}
