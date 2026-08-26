"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clockIn, clockOut, stillWorking, type ClockInResult } from "@/app/clock-in/actions/clock";
import { startLeave, endLeave, type ActiveLeave } from "@/app/clock-in/actions/leave";
import { createClient } from "@/lib/clockin/supabase/client";
import { t, type Lang } from "@/lib/clockin/i18n";
import { btn, field, isLocalhost } from "@/lib/clockin/ui";
import { compressImage } from "@/lib/clockin/image";
import { centralShiftMs } from "@/lib/clockin/tz";

const REASONS = ["customer_visit", "delivery", "moving_between_stores", "personal_emergency", "other"] as const;
const UNSCHEDULED_REASONS = ["covering_shift", "asked_to_come_in", "picking_up_extra", "forgot_on_schedule", "other"] as const;
const OTHER_SITE_REASONS = ["visiting_site", "helping_store", "delivery_pickup", "covering_shift", "other"] as const;
export type OpenShift = { id: string; clockInAt: string } | null;

type Busy = "idle" | "locating" | "needs_reason" | "clocking_out" | "leave_busy";

/** h m s from a duration in ms (clamped at 0). */
function durLabel(ms: number) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${String(sec).padStart(2, "0")}s`;
}

/** Compact m:ss (used for the lunch countdown). */
function minsLabel(ms: number) {
  const s = Math.floor(Math.abs(ms) / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// The 8 PM auto clock-out (see /api/cron). These must stay in step with the
// cron's own constants — the app only asks the question; the server decides.
const CUTOFF_MIN = 20 * 60;
const WARN_MIN = 5;
const GRACE_MIN = 60;

/**
 * An action button that opens the camera on tap and then runs the punch.
 *
 * This MUST live at module scope. Defined inside the panel it would be a new
 * component type on every render, and the clocked-in screen re-renders once a
 * second for the timer — React would tear down and rebuild this <input> while
 * the camera was still open, so "Use Photo" landed on an input that no longer
 * existed and the punch silently never happened.
 */
function CameraButton({
  label,
  busyLabel,
  busy,
  run,
  className,
  capture = "user",
  onCapture,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  run: (path: string) => Promise<void>;
  className: string;
  capture?: "user" | "environment";
  onCapture: (file: File | undefined, run: (path: string) => Promise<void>) => Promise<void>;
}) {
  // NOTE: the hidden input is deliberately NOT `disabled` while busy. A disabled
  // input inside a label silently swallows the tap — no camera, no feedback —
  // which is the classic Android "first tap does nothing." Instead the tap
  // always opens the camera; onCapture's own guard (a ref in the parent) drops
  // an overlapping capture, and the server rejects a duplicate punch anyway. The
  // label still shows the busy text so the person sees work is in progress.
  return (
    <label className={`${className} cursor-pointer`} aria-busy={busy}>
      {busy ? busyLabel : label}
      <input
        type="file"
        accept="image/*"
        capture={capture}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Clear the input FIRST. The camera hands back the same filename every
          // time ("image.jpg"), so leaving the old value means a second attempt
          // fires no change event at all and the button looks dead.
          e.target.value = "";
          void onCapture(file, run);
        }}
      />
    </label>
  );
}

/** Minutes past midnight, Central — the timezone the whole company runs on. */
function centralMinutes(ms: number) {
  const d = new Date(ms - centralShiftMs(new Date(ms)));
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export default function ClockInPanel({
  lang,
  initialOpen,
  initialLeave = null,
  uploadCtx = { companyId: null, userId: null },
  lunchTakenMin = 0,
  lunchTaken = false,
  lunchAllowanceMin = 0,
  stillWorkingAt = null,
  runPaused = false,
}: {
  lang: Lang;
  initialOpen: OpenShift;
  initialLeave?: ActiveLeave;
  uploadCtx?: { companyId: string | null; userId: string | null };
  lunchTakenMin?: number; // completed lunch minutes already taken this shift
  lunchTaken?: boolean; // a lunch was PUNCHED — independent of how long it was
  lunchAllowanceMin?: number; // today's scheduled lunch length (e.g. 60)
  stillWorkingAt?: string | null; // last "yes, still working" answer, if any
  runPaused?: boolean; // a vehicle run is paused for this lunch
}) {
  const tr = t(lang);
  const router = useRouter();
  const [open, setOpen] = useState<OpenShift>(initialOpen);
  const [leave, setLeave] = useState<ActiveLeave>(initialLeave);
  const [busy, setBusy] = useState<Busy>("idle");
  const [message, setMessage] = useState<string>("");
  const [tone, setTone] = useState<"ok" | "warn" | "err" | "muted">("muted");
  const [pendingReason, setPendingReason] = useState<string | null>(null);
  const [reasonContext, setReasonContext] = useState<"offsite" | "unscheduled" | "other_site">("offsite");
  const [capturedPath, setCapturedPath] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const capturingRef = useRef(false); // true while a photo→punch is in flight
  const [now, setNow] = useState<number>(() => new Date(initialOpen?.clockInAt ?? 0).getTime());
  const [ackAt, setAckAt] = useState<number>(() => (stillWorkingAt ? new Date(stillWorkingAt).getTime() : 0));
  const [ackBusy, setAckBusy] = useState(false);
  // "Other" is only useful if she can say what it was.
  const [otherText, setOtherText] = useState("");
  const [pickedOther, setPickedOther] = useState(false);

  // The per-second tick only drives two things: the lunch countdown (while on
  // lunch) and the 8 PM "still working?" prompt (evening). The rest of the day
  // nothing on this screen changes each second, so ticking is pure wasted CPU —
  // and on a low-end Android those constant re-renders compete with taps and
  // make buttons feel unresponsive. So: tick ONLY when it matters, and during
  // the day arm a timer to start ticking when the evening window opens.
  useEffect(() => {
    if (!open) return;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const tick = () => setNow(Date.now());
    const startInterval = () => {
      tick();
      intervalId = setInterval(tick, 1000);
    };

    tick(); // make static reads current on mount / lunch change
    const onLunch = leave?.reason === "lunch";
    const EVENING_START_MIN = CUTOFF_MIN - 20; // 7:40 PM Central — a margin before the 7:55 prompt

    if (onLunch || centralMinutes(Date.now()) >= EVENING_START_MIN) {
      startInterval();
    } else {
      // Daytime, not on lunch: no per-second re-render. Begin ticking exactly
      // when the evening window opens so the prompt still appears on time.
      const secsUntil = (EVENING_START_MIN - centralMinutes(Date.now())) * 60 - new Date().getSeconds();
      timeoutId = setTimeout(startInterval, Math.max(0, secsUntil) * 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [open, leave]);

  /** One geolocation attempt with an explicit accuracy mode. */
  function locate(highAccuracy: boolean, timeout: number): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) return reject(new Error("no-geo"));
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: highAccuracy,
        timeout,
        maximumAge: 60000,
      });
    });
  }

  /**
   * Read GPS, two stages. Android was the problem: a single high-accuracy
   * request indoors routinely burns its whole timeout and fails, which used to
   * kill the punch outright — Santana had to be clocked out by his manager.
   * So: try GPS briefly, then fall back to coarse network positioning, which is
   * nearly instant on Android and plenty for a geofence the size of a store.
   */
  async function getGeo(): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
    setTone("muted");
    // Count up while we wait. 15 seconds of one unchanging "Checking your
    // location..." reads as frozen — that's what sent Jose reaching for refresh
    // mid-punch. A visible second-counter says "still working" without lying.
    const started = Date.now();
    setMessage(tr.locating);
    const tick = setInterval(() => {
      setMessage(`${tr.locating} (${Math.round((Date.now() - started) / 1000)}s)`);
    }, 1000);
    try {
      // Shorter than before: 5s for a satellite lock, then 6s of coarse
      // network positioning. Worst case ~11s instead of 15.
      for (const [high, ms] of [[true, 5000], [false, 6000]] as const) {
        try {
          const pos = await locate(high, ms);
          return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? undefined };
        } catch {
          // fall through to the coarser attempt
        }
      }
      // Local dev: a laptop often has no/denied geolocation. Send placeholder
      // coords so testing isn't blocked — the server's DEV_BYPASS_GEOFENCE makes
      // the punch count as on-site. Production still requires a real fix.
      if (isLocalhost()) return { lat: 0, lng: 0 };
      return null;
    } finally {
      clearInterval(tick);
    }
  }

  // --- Photo capture: upload the file, return its storage path (or null). ------
  async function uploadPhoto(file: File): Promise<string | null> {
    if (!uploadCtx.companyId || !uploadCtx.userId) {
      setPhotoError("Missing account info — reload and try again.");
      return null;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const supabase = createClient();
      // Shrink first — a raw phone photo is 8–12 MB and stalls on weak signal.
      const body = await compressImage(file);
      const path = `${uploadCtx.companyId}/${uploadCtx.userId}/${Date.now()}.jpg`;
      // The upload has no timeout of its own. On a weak signal it can hang
      // indefinitely, which is exactly what "I took the photo and nothing
      // happened" looked like — the button sat on "Uploading photo…" forever.
      const result = await Promise.race([
        supabase.storage.from("exception-photos").upload(path, body, { contentType: "image/jpeg", upsert: false }),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 30000)),
      ]);
      if (result === "timeout") {
        setPhotoError(tr.photoSlowNetwork);
        return null;
      }
      if (result.error) {
        setPhotoError(result.error.message);
        return null;
      }
      return path;
    } catch (e) {
      // Keep the real reason visible — a generic string here is what made this
      // fail silently in the first place.
      const detail = e instanceof Error ? e.message : String(e);
      setPhotoError(`Photo upload failed — ${detail}`);
      return null;
    } finally {
      setPhotoBusy(false);
    }
  }

  /**
   * The camera opens straight from the action button — no "this needs a photo"
   * screen in between. Upload, then run the punch the button stands for.
   */
  async function onCapture(file: File | undefined, run: (path: string) => Promise<void>) {
    if (!file) return;
    // Synchronous guard against a second capture landing while one is in flight
    // (possible now that the input isn't disabled). A ref is instant and never
    // stale, unlike state — so a fast double-tap can't fire two punches.
    if (capturingRef.current) return;
    capturingRef.current = true;
    try {
      const path = await uploadPhoto(file);
      if (!path) return; // uploadPhoto set photoError, which the UI now shows
      await run(path);
    } finally {
      capturingRef.current = false;
    }
  }

  async function doClockIn(reason?: string, photoPath?: string, note?: string) {
    setBusy("locating");
    const photo = photoPath ?? capturedPath ?? undefined;
    const geo = await getGeo();
    if (!geo) {
      setBusy("idle");
      setTone("err");
      setMessage(tr.locationDenied);
      return;
    }
    const res: ClockInResult = await clockIn({ lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, reason, note, photoPath: photo });
    if (!res.ok && res.code === "needs_reason") {
      setReasonContext(res.context);
      setBusy("needs_reason");
      setTone("warn");
      setMessage(res.context === "unscheduled" ? tr.unscheduledReason : res.context === "other_site" ? tr.otherSiteReason : tr.reasonRequired);
      return;
    }
    if (!res.ok && res.code === "already_open") {
      setOpen({ id: res.entryId, clockInAt: res.clockInAt });
      setBusy("idle");
      setTone("ok");
      setMessage(tr.clockedIn);
      router.refresh();
      return;
    }
    if (!res.ok) {
      setBusy("idle");
      setTone(res.code === "not_configured" ? "muted" : "err");
      setMessage(res.code === "not_configured" ? tr.notConfigured : res.message);
      return;
    }
    setOpen({ id: res.entryId, clockInAt: res.clockInAt });
    setBusy("idle");
    setPendingReason(null);
    setCapturedPath(null);
    setPickedOther(false);
    setOtherText("");
    if (res.onSite && res.earlyMin !== undefined && res.earlyMin > 5) {
      setTone("warn");
      setMessage(tr.earlyReminder.replace("{n}", String(res.earlyMin)));
    } else if (res.onSite && res.earlyMin !== undefined) {
      setTone("ok");
      setMessage(tr.earlyPraise);
    } else {
      setTone(res.onSite ? "ok" : "warn");
      setMessage(res.onSite ? tr.clockedInOk : tr.clockedInOffsite);
    }
    router.refresh();
  }

  async function doClockOut(photoPath: string) {
    if (!open) return;
    setBusy("clocking_out");
    // Location is required on the way OUT as well as IN — that's the whole point
    // of the system. If both location attempts fail we refuse and say so, rather
    // than recording a punch nobody can verify.
    const geo = await getGeo();
    if (!geo) {
      setBusy("idle");
      setTone("err");
      setMessage(tr.locationRetry);
      return;
    }
    // NOTE: this used to end an open break first, then clock out. If the
    // clock-out was then refused (an open run), the break had already been
    // consumed and the shift was still open — the lunch just vanished. The break
    // now has to be ended on its own, and the button below is hidden until it is.
    const res = await clockOut(open.id, { lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, photoPath });
    setBusy("idle");
    if (!res.ok) {
      setTone("err");
      setMessage(res.message);
      return;
    }
    setOpen(null);
    setTone(res.onSite ? "ok" : "warn");
    setMessage(res.onSite ? tr.clockedOutOk : tr.clockedOutOffsite);
    router.refresh();
  }

  async function doStartLeave(reason: string, photoPath: string) {
    setBusy("leave_busy");
    const geo = await getGeo();
    const res = await startLeave({
      reason,
      expectedReturn: null, // no expected-return prompt anymore
      geo: { lat: geo?.lat, lng: geo?.lng, photoPath },
    });
    setBusy("idle");
    if (!res.ok) {
      setTone("err");
      setMessage(res.message);
      return;
    }
    setLeave(res.leave);
    setMessage("");
    router.refresh();
  }

  async function doEndLeave(photoPath: string) {
    if (!leave) return;
    setBusy("leave_busy");
    const geo = await getGeo();
    await endLeave(leave.id, { lat: geo?.lat, lng: geo?.lng, photoPath });
    setBusy("idle");
    setLeave(null);
    setTone("ok");
    setMessage(tr.backOk);
    router.refresh();
  }

  const toneClass =
    tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "err" ? "text-red-600" : "text-zinc-500";

  /** Shared props so each call site doesn't repeat the busy/upload plumbing. */
  // Busy for the WHOLE punch, not just the upload. Previously the button went
  // back to looking idle the moment the photo finished, while the location
  // lookup and server call were still running — so it read as "nothing is
  // happening" and invited a second tap or a refresh mid-punch.
  const camProps = {
    busy: photoBusy || busy !== "idle",
    busyLabel: photoBusy ? tr.uploadingPhoto : tr.working,
    onCapture,
  };

  /** Photo problems used to fail silently — this is the only place they surface. */
  const PhotoError = () =>
    photoError ? (
      <p className="text-center text-sm text-red-600" role="alert">
        📷 {photoError}
      </p>
    ) : null;

  // --- Clocked IN view ---
  if (open) {
    // Worked time EXCLUDES lunch (that's how payroll counts it), so the timer
    // pauses while they're out to lunch instead of running through the break.
    const onLunch = leave?.reason === "lunch";
    const lunchMs = onLunch ? Math.max(0, now - new Date(leave!.leftAt).getTime()) : 0;
    const lunchLeftMs = lunchAllowanceMin * 60000 - lunchMs;

    // "Still working?" — mirrors the 7:55 PM push. Answering here buys an hour,
    // then it comes back. Silence means the server closes the shift at 8:00.
    const cutoffMs = now - (centralMinutes(now) - CUTOFF_MIN) * 60000;
    const freshAck = ackAt > cutoffMs - GRACE_MIN * 60000 ? ackAt : 0;
    const deadline = Math.max(cutoffMs, freshAck + GRACE_MIN * 60000);
    const askStillWorking = !onLunch && now >= deadline - WARN_MIN * 60000 && now < deadline + 60000;

    return (
      <div data-tour="clock" className="w-full max-w-sm mx-auto flex flex-col gap-4">
        {askStillWorking && (
          <div className="rounded-xl border border-orange-300 bg-orange-50 dark:bg-orange-950/30 p-4 text-center">
            <p className="text-sm font-semibold text-orange-900 dark:text-orange-300">{tr.stillWorkingQ}</p>
            <p className="mt-1 text-xs text-orange-800/80 dark:text-orange-400/80">{tr.stillWorkingHint}</p>
            <button
              type="button"
              disabled={ackBusy}
              onClick={async () => {
                setAckBusy(true);
                const res = await stillWorking();
                setAckBusy(false);
                if (res.ok) setAckAt(Date.now());
                else {
                  setTone("err");
                  setMessage(res.message);
                }
              }}
              className="mt-3 w-full min-h-[48px] rounded-2xl bg-orange-600 hover:bg-orange-500 text-white text-base font-semibold py-3.5 shadow-sm transition-all disabled:opacity-60"
            >
              {ackBusy ? "…" : tr.yesStillWorking}
            </button>
          </div>
        )}

        {/* Away / lunch state */}
        {leave ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 text-center">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {leave.reason === "lunch"
                ? `🍽️ ${tr.onLunch}`
                : `${tr.away}: ${tr.leaveReasons[leave.reason as keyof typeof tr.leaveReasons] ?? leave.reason}`}
            </p>
            {/* Lunch countdown: how long they've been out and how much is left. */}
            {onLunch && lunchAllowanceMin > 0 && (
              <p className={`mt-1 text-2xl font-bold tabular-nums ${lunchLeftMs < 0 ? "text-red-600" : "text-amber-800 dark:text-amber-300"}`}>
                {lunchLeftMs >= 0 ? `${minsLabel(lunchLeftMs)} ${tr.lunchLeft}` : `+${minsLabel(lunchLeftMs)} ${tr.lunchOver}`}
              </p>
            )}
            <p className="text-xs text-amber-700/80 mt-0.5">
              {onLunch ? `${durLabel(lunchMs)} ${tr.outWord} · ` : ""}
              {tr.since} {timeOnly(leave.leftAt)}
              {leave.expectedReturnAt ? ` · ~${timeOnly(leave.expectedReturnAt)}` : ""}
            </p>
            <CameraButton
              {...camProps}
              label={leave.reason === "lunch" ? (runPaused ? `▶️ ${tr.continueRoute}` : tr.endLunch) : tr.imBack}
              run={(p) => doEndLeave(p)}
              className="mt-3 w-full min-h-[56px] flex items-center justify-center rounded-2xl bg-amber-600 hover:bg-amber-500 text-white text-lg font-semibold py-4 shadow-sm transition-all"
            />
          </div>
        ) : lunchTaken ? (
          /* Lunch is once a day. Offering the button again after they'd finished
             made people think the break hadn't registered — show what WAS
             recorded instead. */
          <p className="rounded-2xl bg-zinc-100 dark:bg-zinc-800 py-4 text-center text-base text-zinc-600 dark:text-zinc-300">
            🍽️ {tr.lunchTakenToday}: <span className="font-semibold tabular-nums">{lunchTakenMin}m</span>
          </p>
        ) : (
          /* "Leaving work location" is gone — heading out covers it now. */
          <CameraButton
            {...camProps}
            label={`🍽️ ${tr.startLunch}`}
            run={(p) => doStartLeave("lunch", p)}
            className="min-h-[56px] flex items-center justify-center rounded-2xl bg-amber-500 hover:bg-amber-400 text-white text-lg font-semibold py-4 shadow-sm transition-all"
          />
        )}

        {/* Hidden while she's on a break. Clocking out mid-lunch isn't a thing —
            showing the button only invited a tap that couldn't succeed. It comes
            back the moment the break is ended. */}
        {!leave && (
          <CameraButton
            {...camProps}
            label={busy === "clocking_out" ? "…" : tr.clockOut}
            run={(p) => doClockOut(p)}
            className={`${btn("danger", "lg", { full: true })} block text-center`}
          />
        )}

        <PhotoError />
        {message && <p className={`text-center text-sm ${toneClass}`}>{message}</p>}
      </div>
    );
  }

  // --- Clocked OUT view ---
  const inFlow = busy === "locating" || busy === "needs_reason";
  return (
    <div data-tour="clock" className="w-full max-w-sm mx-auto flex flex-col gap-5">
      {!inFlow && (
        <CameraButton
          {...camProps}
          label={tr.clockIn}
          run={(p) => {
            setCapturedPath(p);
            return doClockIn(pendingReason ?? undefined, p);
          }}
          className={`${btn("primary", "xl", { full: true })} block text-center`}
        />
      )}

      {busy === "locating" && <p className="text-center text-sm text-zinc-500">{tr.locating}</p>}

      {/* Off-site OR unscheduled: pick a reason (photo already captured) */}
      {busy === "needs_reason" && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {reasonContext === "unscheduled" ? tr.unscheduledReason : reasonContext === "other_site" ? tr.otherSiteReason : tr.reasonRequired}
          </p>
          {pickedOther ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder={tr.rReasonOther}
                rows={2}
                autoFocus
                className={field}
              />
              <button
                onClick={() => doClockIn("other", undefined, otherText)}
                disabled={!otherText.trim()}
                className={`${btn("primary", "lg", { full: true })} disabled:opacity-50`}
              >
                {tr.clockIn}
              </button>
              <button onClick={() => { setPickedOther(false); setOtherText(""); }} className="text-xs text-zinc-400 self-start">
                {tr.changeReason}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {(reasonContext === "unscheduled" ? UNSCHEDULED_REASONS : reasonContext === "other_site" ? OTHER_SITE_REASONS : REASONS).map((r) => (
                <button
                  key={r}
                  onClick={() => (r === "other" ? setPickedOther(true) : doClockIn(r))}
                  className="min-h-[52px] rounded-xl border border-amber-300 bg-white dark:bg-zinc-900 px-4 py-3.5 text-left text-base font-medium hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20 active:scale-[0.99] transition-all"
                >
                  {tr.reasons[r as keyof typeof tr.reasons]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <PhotoError />
      {message && busy !== "needs_reason" && <p className={`text-center text-sm ${toneClass}`}>{message}</p>}
    </div>
  );
}
