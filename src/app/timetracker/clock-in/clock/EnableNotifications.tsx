"use client";

import { useEffect, useState } from "react";
import { saveSubscription, sendTestPush, deleteSubscription } from "@/app/timetracker/clock-in/actions/push";
import { t, type Lang } from "@/lib/clockin/i18n";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type State = "loading" | "unsupported" | "idle" | "on" | "denied" | "working";

export default function EnableNotifications({ lang }: { lang: Lang }) {
  const tr = t(lang);
  const [state, setState] = useState<State>("loading");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      // The phone is refusing to SHOW notifications, but a subscription row from
      // before it was blocked is still sitting on the server looking healthy —
      // so "who's missing alerts" reports would keep saying this person is fine.
      // Drop it, so the stored state matches reality.
      navigator.serviceWorker
        .getRegistration()
        .then(async (reg) => {
          const sub = reg ? await reg.pushManager.getSubscription() : null;
          if (sub) {
            await deleteSubscription(sub.endpoint);
            await sub.unsubscribe().catch(() => {});
          }
        })
        .catch(() => {});
      return;
    }
    navigator.serviceWorker
      .getRegistration()
      .then(async (reg) => {
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        setState(sub ? "on" : "idle");
      })
      .catch(() => setState("idle"));
  }, []);

  async function enable() {
    setState("working");
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.register("/clockin-sw.js", { scope: "/timetracker/clock-in/" });
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "idle");
        return;
      }
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) {
        setState("idle");
        setMsg("Server not configured.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = sub.toJSON();
      const res = await saveSubscription({
        endpoint: sub.endpoint,
        p256dh: json.keys!.p256dh,
        auth: json.keys!.auth,
      });
      setState(res.ok ? "on" : "idle");
      if (!res.ok) setMsg(res.message ?? "Couldn't save.");
    } catch {
      setState("idle");
      setMsg("Couldn't enable — try again.");
    }
  }

  async function test() {
    setMsg(null);
    const res = await sendTestPush();
    setMsg(res.sent > 0 ? tr.testSent : "No devices subscribed.");
  }

  if (state === "loading") return null;
  if (state === "unsupported")
    return <span className="text-xs text-zinc-400">{tr.notificationsUnsupported}</span>;
  if (state === "denied")
    return (
      <div className="flex flex-col items-center gap-1 rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2">
        <span className="text-xs font-semibold text-red-700 dark:text-red-400">🔕 {tr.notificationsBlocked}</span>
        <span className="text-[11px] leading-snug text-red-700/80 dark:text-red-400/80 text-center">{tr.notificationsHowTo}</span>
      </div>
    );

  return (
    <div className="flex flex-col items-center gap-1">
      {state === "on" ? (
        <div className="flex items-center gap-3">
          <span className="text-xs text-emerald-600">{tr.notificationsOn}</span>
          <button onClick={test} className="text-xs text-zinc-400 hover:underline">
            {tr.sendTest}
          </button>
        </div>
      ) : (
        <button
          onClick={enable}
          disabled={state === "working"}
          className="text-sm text-emerald-600 hover:underline disabled:opacity-60"
        >
          🔔 {tr.enableNotifications}
        </button>
      )}
      {msg && <span className="text-xs text-zinc-400">{msg}</span>}
    </div>
  );
}
