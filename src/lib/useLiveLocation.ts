"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { shouldSend, heartbeatDue, HEARTBEAT_MS, MIN_MOVE_M } from "@/lib/location-filter";
import { isNativeApp, startNativeWatch, startTimedPositions, type NativeFix } from "@/lib/native-bridge";

// ============================================================
// Shares the driver's position with the office WHILE THEY ARE ON SHIFT.
//
// Deliberately shift-bound: tracking starts at clock-in and stops at
// clock-out, so the app never records where someone is on their own time.
//
// Inside the driver APK this runs through Android's foreground service, so it
// keeps reporting with the phone locked in the truck — and Android shows a
// permanent notification the whole time. In a plain browser it falls back to
// the page's own geolocation, which only runs while the app is open.
// ============================================================

export type LocationStatus = "off" | "starting" | "live" | "denied" | "unavailable";

/**
 * How often the native side offers a position regardless of movement.
 *
 * Note this is the OFFER rate, not the storage rate: each one still goes
 * through shouldSend, so a parked truck is written once per HEARTBEAT_MS
 * (5 min) and the two-minute offers in between are dropped. Roughly 100 rows
 * across an eight-hour day.
 *
 * That indirection is the point. The heartbeat used to be a JavaScript timer,
 * and Android suspends those the moment the app is backgrounded — so it never
 * fired when it was most needed. Now the beat comes from native code that
 * keeps running, and shouldSend simply decides which offers are worth a row.
 *
 * Offering more often than the heartbeat also means a truck that starts moving
 * is noticed within two minutes rather than five.
 */
const TIMED_INTERVAL_MS = 60_000;

interface BatteryManager { level: number }

/**
 * The phone's battery level, 0–100, or null when the browser won't say.
 *
 * Recorded with every fix because it is the first thing anyone asks when a
 * truck vanishes off the map — "was the phone dead?" — and until now the
 * column existed but was never filled, so the question had no answer.
 *
 * The BatteryManager is cached: `getBattery()` returns a live object, so it is
 * fetched once and read thereafter.
 */
let batteryRef: Promise<BatteryManager | null> | null = null;
async function batteryPct(): Promise<number | null> {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
  if (!nav.getBattery) return null;
  batteryRef ??= nav.getBattery().catch(() => null);
  const b = await batteryRef;
  if (!b || typeof b.level !== "number") return null;
  return Math.max(0, Math.min(100, Math.round(b.level * 100)));
}

/** Watch and report position while `active` is true. */
export function useLiveLocation(active: boolean): { status: LocationStatus; lastAt: string | null; native: boolean } {
  const { pushLocation } = useData();
  const [status, setStatus] = useState<LocationStatus>("off");
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [native, setNative] = useState(false);
  const lastRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  // The newest fix the phone offered, whether or not it was worth writing.
  // The heartbeat re-sends this when the truck stops moving and the watcher
  // therefore stops calling back at all.
  const latestFixRef = useRef<NativeFix | null>(null);
  // Keep the latest pushLocation without restarting the GPS watch on rerender.
  const pushRef = useRef(pushLocation);
  pushRef.current = pushLocation;

  useEffect(() => {
    if (!active) { setStatus("off"); lastRef.current = null; return; }

    let cancelled = false;
    let stopNative: (() => void) | null = null;
    let stopTimed: (() => void) | null = null;
    let browserWatchId: number | null = null;

    // Shared by both sources: filter, then write.
    const report = async (fix: NativeFix) => {
      if (cancelled) return;
      setStatus("live");
      latestFixRef.current = fix;
      const now = Date.now();
      if (!shouldSend({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy_m }, lastRef.current, now)) return;
      lastRef.current = { lat: fix.lat, lng: fix.lng, at: now };
      const ok = await pushRef.current({ ...fix, battery_pct: await batteryPct() });
      if (ok && !cancelled) setLastAt(new Date().toISOString());
    };

    // HEARTBEAT.
    //
    // The watcher only calls back when the truck moves 40 m, so a truck parked
    // at a long stop goes completely silent — indistinguishable in the data
    // from a phone whose app Android killed. That ambiguity is why "the app
    // paused" can't be proved after the fact, and it also trips the
    // dispatcher's 15-minute "not reporting" flag on drivers who are merely
    // unloading.
    //
    // So: while nothing new arrives, re-send the last known position. It is
    // stamped NOW because that is what it means — as of now, the driver is
    // still here and the app is still alive.
    //
    // LIMIT, measured in production: this is a JS timer, and Android suspends
    // the WebView's timers once the app is backgrounded — fixes captured
    // natively have shown up over an hour late, queued until the app woke. So
    // a PRESENT heartbeat proves the app is alive and foregrounded; a MISSING
    // one does not prove it is dead. Reliable background heartbeats would
    // need native work the GPS plugin doesn't offer.
    const beat = setInterval(() => {
      if (cancelled) return;
      const fix = latestFixRef.current;
      const last = lastRef.current;
      if (!fix || !last || !heartbeatDue(last.at, Date.now())) return;
      const now = Date.now();
      lastRef.current = { lat: fix.lat, lng: fix.lng, at: now };
      void (async () => {
        const ok = await pushRef.current({
          ...fix,
          // Standing still, by definition: this is the same point as last time.
          speed_mps: 0,
          recorded_at: new Date(now).toISOString(),
          battery_pct: await batteryPct(),
        });
        if (ok && !cancelled) setLastAt(new Date(now).toISOString());
      })();
    }, 60_000);

    // SEED A FIX ON EVERY WAKE-UP.
    //
    // The watcher only calls back after 40 m of movement, and it deliberately
    // refuses the phone's cached position. So a driver who reopens the app
    // while parked reports NOTHING until the truck rolls — which is how a
    // reopened app took 45 minutes to come back as LIVE.
    //
    // The heartbeat can't rescue that either: it re-sends the last known
    // position, and after a restart there isn't one.
    //
    // So ask for a position outright whenever the app wakes: at start, and
    // every time the driver comes back to it. A fix up to two minutes old is
    // accepted here — recent enough to be where they actually are, and far
    // better than the alternative of nothing at all. (The watcher still
    // refuses cached fixes; this is a bounded exception, not the rule.)
    const seed = () => {
      if (cancelled || typeof navigator === "undefined" || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = pos.coords;
          void report({
            lat: c.latitude,
            lng: c.longitude,
            accuracy_m: c.accuracy ?? null,
            speed_mps: c.speed ?? null,
            heading: c.heading ?? null,
            recorded_at: new Date(pos.timestamp || Date.now()).toISOString(),
          });
        },
        () => { /* no fix right now; the watcher and the next wake-up still try */ },
        { enableHighAccuracy: true, maximumAge: 120_000, timeout: 20_000 },
      );
    };
    seed();
    const onWake = () => { if (!document.hidden) seed(); };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);

    setStatus("starting");

    (async () => {
      // Preferred path: the APK's background service.
      if (isNativeApp()) {
        const stop = await startNativeWatch(
          (fix) => void report(fix),
          (_msg, denied) => { if (!cancelled) setStatus(denied ? "denied" : "unavailable"); },
          // Android forces a permanent notification for a background location
          // service and no app may suppress it, so this text is always visible
          // to the driver. Kept factual: the service does run for the duration
          // of the shift. Android additionally shows its own location indicator
          // in the status bar, independent of anything written here.
          {
            title: "RTG Hub",
            message: "Turno en curso",
          },
          MIN_MOVE_M,
        );
        if (cancelled) { stop?.(); return; }
        if (stop) {
          stopNative = stop;
          setNative(true);
          // Distance reporting alone leaves a parked truck silent for hours.
          // This adds a fix on a clock, so a stop is a stop rather than a
          // hole. Its own timestamps survive the app being backgrounded, so
          // the track is right even when the upload arrives in bursts.
          const stopClock = await startTimedPositions((f) => {
            void report({
              lat: f.lat,
              lng: f.lng,
              accuracy_m: f.accuracy ?? null,
              speed_mps: f.speed ?? null,
              heading: f.bearing ?? null,
              recorded_at: new Date(f.time ?? Date.now()).toISOString(),
            });
          }, TIMED_INTERVAL_MS);
          if (cancelled) stopClock?.();
          else stopTimed = stopClock;
          return;
        }
        // No plugin despite being native — fall through to the browser API.
      }

      if (typeof navigator === "undefined" || !navigator.geolocation) {
        if (!cancelled) setStatus("unavailable");
        return;
      }
      browserWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          const c = pos.coords;
          void report({
            lat: c.latitude,
            lng: c.longitude,
            accuracy_m: c.accuracy ?? null,
            speed_mps: c.speed ?? null,
            heading: c.heading ?? null,
            recorded_at: new Date(pos.timestamp || Date.now()).toISOString(),
          });
        },
        (err) => { if (!cancelled) setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"); },
        {
          enableHighAccuracy: true,
          // A fix up to 20s old is fine — it avoids waking the GPS chip for
          // every callback, which is what actually drains a phone on a route.
          maximumAge: 20_000,
          timeout: 30_000,
        },
      );
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
      clearInterval(beat);
      stopTimed?.();
      stopNative?.();
      if (browserWatchId != null) navigator.geolocation.clearWatch(browserWatchId);
    };
  }, [active]);

  return { status, lastAt, native };
}
