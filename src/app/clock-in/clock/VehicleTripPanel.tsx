"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startTrip, endTrip, logStop, finishStop } from "@/app/clock-in/actions/runner";
import { createClient } from "@/lib/clockin/supabase/client";
import { t, type Lang } from "@/lib/clockin/i18n";
import { btn, field, isLocalhost } from "@/lib/clockin/ui";
import { compressImage } from "@/lib/clockin/image";

export type Vehicle = { id: string; name: string };
export type Stop = {
  id: string;
  label: string | null;
  arrived_at: string;
  departed_at: string | null;
  miles_from_prev: number | null;
  photo_path: string | null;
};

export type TripMode = "runner" | "sales";

// Same reasons the old "Leaving work location" asked — minus lunch (its own
// button) and minus the expected-return time.
const TRIP_REASONS = [
  "delivery",
  "customer_visit",
  "picking_up_supplies",
  "moving_between_stores",
  "personal_emergency",
  "other",
] as const;

function tm(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function VehicleTripPanel({
  lang,
  mode,
  vehicles,
  currentVehicleId,
  initialOnTrip,
  personalTrip,
  tripStartedAt,
  tripPaused = false,
  stops,
  uploadCtx,
}: {
  lang: Lang;
  mode: TripMode;
  vehicles: Vehicle[];
  currentVehicleId: string | null;
  initialOnTrip: boolean;
  personalTrip: boolean;
  tripStartedAt: string | null;
  tripPaused?: boolean; // paused automatically while she's on lunch
  stops: Stop[];
  uploadCtx: { companyId: string | null; userId: string | null };
}) {
  const tr = t(lang);
  const router = useRouter();
  const isRunner = mode === "runner";
  const [open, setOpen] = useState(false);
  const [stopPhoto, setStopPhoto] = useState<string | null>(null);
  // Own vehicle is the normal case — pre-checked. Unchecking reveals the
  // company-vehicle fields (odometer / fuel / dashboard photo).
  const [personal, setPersonal] = useState(true);
  const [reason, setReason] = useState<string>("");
  const [reasonNote, setReasonNote] = useState("");
  const [vehicleId, setVehicleId] = useState(currentVehicleId ?? vehicles[0]?.id ?? "");
  const [odometer, setOdometer] = useState("");
  const [range, setRange] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [stopLabel, setStopLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function getGeo(): Promise<{ lat: number; lng: number } | null> {
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => {
        if (!("geolocation" in navigator)) return rej(new Error("no-geo"));
        navigator.geolocation.getCurrentPosition(res, rej, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 60000,
        });
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      if (isLocalhost()) return { lat: 0, lng: 0 };
      return null;
    }
  }
  async function uploadPhoto(file: File): Promise<string | null> {
    if (!uploadCtx.companyId || !uploadCtx.userId) return null;
    const supabase = createClient();
    // Shrink first — a raw phone photo is 8–12 MB and stalls on weak signal.
    const body = await compressImage(file);
    const path = `${uploadCtx.companyId}/${uploadCtx.userId}/${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from("exception-photos")
      .upload(path, body, { contentType: "image/jpeg", upsert: false });
    return error ? null : path;
  }
  async function onDash(file?: File) {
    if (!file) return;
    setUploading(true);
    const p = await uploadPhoto(file);
    setUploading(false);
    if (p) setPhoto(p);
    else setMsg({ ok: false, text: "Photo upload failed — try again." });
  }

  function resetForm() {
    setPhoto(null);
    setOdometer("");
    setRange("");
  }

  /** Taking the photo IS the action for a personal trip — upload, then start. */
  async function onPersonalPhoto(file?: File) {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    const p = await uploadPhoto(file);
    setUploading(false);
    if (!p) return setMsg({ ok: false, text: "Photo upload failed — try again." });
    setPhoto(p);
    await start(p); // pass the path straight through — don't wait on state
  }

  async function start(photoOverride?: string) {
    const usePhoto = photoOverride ?? photo ?? undefined;
    setBusy(true);
    setMsg(null);
    const geo = await getGeo();
    const res = await startTrip(
      personal
        ? { kind: mode, personal: true, photoPath: usePhoto, reason, note: reasonNote, lat: geo?.lat, lng: geo?.lng }
        : {
            kind: mode,
            vehicleId,
            odometer: Number(odometer),
            rangeMiles: range.trim() ? Number(range) : undefined,
            photoPath: usePhoto,
            reason,
            note: reasonNote,
            lat: geo?.lat,
            lng: geo?.lng,
          },
    );
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.message });
    resetForm();
    setOpen(false);
    router.refresh();
  }

  async function end() {
    setBusy(true);
    setMsg(null);
    const geo = await getGeo();
    const res = await endTrip(
      personalTrip
        ? { lat: geo?.lat, lng: geo?.lng }
        : {
            odometer: Number(odometer),
            rangeMiles: range.trim() ? Number(range) : undefined,
            photoPath: photo ?? undefined,
            lat: geo?.lat,
            lng: geo?.lng,
          },
    );
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.message });
    resetForm();
    router.refresh();
  }

  async function doFinishStop() {
    setBusy(true);
    setMsg(null);
    const geo = await getGeo();
    const res = await finishStop({ lat: geo?.lat, lng: geo?.lng });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.message });
    router.refresh();
  }

  /** Step 1 — the camera opened straight from "Log a stop"; just bank the photo. */
  async function onStopPhotoTaken(file?: File) {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    const p = await uploadPhoto(file);
    setUploading(false);
    if (!p) return setMsg({ ok: false, text: "Photo upload failed — try again." });
    setStopPhoto(p); // now we ask them where they are
  }

  /** Step 2 — they typed where they are; save the stop. */
  async function saveStop() {
    if (!stopPhoto) return;
    // A stop with no name forces the manager to guess what they were doing there.
    // Require a name — this is the whole point of logging the stop.
    if (!stopLabel.trim()) {
      setMsg({ ok: false, text: tr.rStopNameNeeded });
      return;
    }
    setBusy(true);
    setMsg(null);
    const geo = await getGeo();
    const res = await logStop({ label: stopLabel.trim(), lat: geo?.lat, lng: geo?.lng, photoPath: stopPhoto });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.message });
    setStopLabel("");
    setStopPhoto(null);
    router.refresh();
  }

  // A stop they've arrived at but not finished yet.
  const openStop = stops.find((s) => !s.departed_at) ?? null;
  const ready = !!vehicleId && !!odometer.trim() && !!photo && !busy;
  const tone = msg?.ok ? "text-emerald-600" : "text-red-600";
  const startLabel = isRunner ? tr.rStartRun : tr.rHeadingOut;
  const endLabel = isRunner ? tr.rEndRun : tr.rTripBack;

  // The "own vehicle?" toggle — shown on every start form.
  const personalToggle = (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
      <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
      <span>🚗 {tr.rPersonalVehicle}</span>
    </label>
  );

  // Inlined (NOT a nested component) so typing a digit doesn't blur the input.
  const startForm = (
    <div className="flex flex-col gap-2.5">
      {/* Why they're leaving — merged in from the old "Leaving work location".
          No expected-return time, no lunch (lunch is its own button). */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-zinc-500">{tr.rWhyLeaving}</span>
        <div className="grid grid-cols-1 gap-1.5">
          {TRIP_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
                reason === r
                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
                  : "border-zinc-300 dark:border-zinc-700 hover:border-emerald-400"
              }`}
            >
              {tr.leaveReasons[r as keyof typeof tr.leaveReasons] ?? r}
            </button>
          ))}
        </div>
        {reason === "other" && (
          <input
            value={reasonNote}
            onChange={(e) => setReasonNote(e.target.value)}
            placeholder={tr.rReasonOther}
            className={field}
            autoFocus
          />
        )}
      </div>

      {personalToggle}
      {personal ? (
        /* Own vehicle: the photo IS the action — take it and the trip starts. */
        <>
          <label className={`flex items-center justify-center gap-2 rounded-xl py-4 text-white font-semibold cursor-pointer ${uploading || busy ? "bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-500"}`}>
            {uploading || busy ? tr.uploadingPhoto : `📷 ${tr.rStartPhoto}`}
            <input type="file" accept="image/*" capture="environment" hidden disabled={uploading || busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onPersonalPhoto(f); }} />
          </label>
          {/* Only appears if the auto-start didn't go through — retry without re-shooting. */}
          {photo && !busy && !uploading && (
            <button onClick={() => start()} className={btn("primary", "md")}>{startLabel}</button>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">🚚 {tr.rVehicle}</span>
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={field}>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">{tr.rOdometer}</span>
              <input type="number" inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="120450" className={field} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">⛽ {tr.rRangeMiles}</span>
            <input type="number" inputMode="numeric" value={range} onChange={(e) => setRange(e.target.value)} placeholder="220" className={field} />
          </label>
          <label className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-white font-semibold cursor-pointer ${photo ? "bg-emerald-700" : uploading ? "bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-500"}`}>
            {uploading ? tr.uploadingPhoto : photo ? `✓ ${tr.rTakeDash}` : `📷 ${tr.rTakeDash}`}
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onDash(f); }} />
          </label>
          <button onClick={() => start()} disabled={!ready} className={btn("primary", "md")}>{busy ? "…" : startLabel}</button>
        </>
      )}
      {msg && <p className={`text-sm ${tone}`}>{msg.text}</p>}
    </div>
  );

  // Closing dashboard form for a company vehicle (personal trips end with 1 tap).
  const endForm = (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">{tr.rOdometer}</span>
          <input type="number" inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="120490" className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">⛽ {tr.rRangeMiles}</span>
          <input type="number" inputMode="numeric" value={range} onChange={(e) => setRange(e.target.value)} placeholder="180" className={field} />
        </label>
      </div>
      <label className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-white font-semibold cursor-pointer ${photo ? "bg-emerald-700" : uploading ? "bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-500"}`}>
        {uploading ? tr.uploadingPhoto : photo ? `✓ ${tr.rTakeDash}` : `📷 ${tr.rTakeDash}`}
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onDash(f); }} />
      </label>
      <button onClick={end} disabled={!odometer.trim() || !photo || busy} className={btn("primary", "md")}>{busy ? "…" : endLabel}</button>
      {msg && <p className={`text-sm ${tone}`}>{msg.text}</p>}
    </div>
  );

  // ---- On a trip ----
  if (initialOnTrip) {
    return (
      <div className="w-full max-w-sm mx-auto rounded-2xl border border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 p-4 flex flex-col gap-3">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          {/* Whether it's her own car is recorded on the trip; it just doesn't
              need repeating back to her the whole time she's driving. */}
          🚗 {isRunner ? tr.rOnRun : tr.rDriving}
          {tripStartedAt ? ` · ${tr.rSince} ${tm(tripStartedAt)}` : ""}
        </p>
        {tripPaused ? (
          /* On lunch: the run is paused automatically. Nothing to do here until
             she taps "I'm back" — showing stop controls would only invite a
             stop logged against break time. */
          <p className="rounded-xl bg-zinc-100 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-600 dark:text-zinc-400">
            ⏸️ {tr.rPausedForLunch}
          </p>
        ) : stopPhoto ? (
          /* Photo is in — now (and only now) ask where they are. */
          <div className="flex flex-col gap-2">
            <p className="text-xs text-emerald-700 dark:text-emerald-400">✓ {tr.rStopPhoto}</p>
            <input
              value={stopLabel}
              onChange={(e) => setStopLabel(e.target.value)}
              placeholder={tr.rStopWhere}
              className={field}
              autoFocus
            />
            <button onClick={saveStop} disabled={busy || !stopLabel.trim()} className={`${btn("primary", "md")} disabled:opacity-50`}>
              {busy ? tr.rSavingStop : tr.rSaveStop}
            </button>
            <button onClick={() => { setStopPhoto(null); setStopLabel(""); }} className="text-xs text-zinc-400 self-start">
              {tr.cancel}
            </button>
          </div>
        ) : openStop ? (
          /* Still at a stop — finish it (time + location only, no photo). */
          <button onClick={doFinishStop} disabled={busy} className={btn("primary", "md")}>
            ✅ {busy ? "…" : tr.rDoneStop}
          </button>
        ) : (
          /* One tap → camera opens immediately. No "you need a photo" screen. */
          <label className={`flex items-center justify-center gap-2 rounded-2xl py-4 text-white font-semibold cursor-pointer ${uploading ? "bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-500"}`}>
            📍 {uploading ? tr.uploadingPhoto : tr.rLogStop}
            <input type="file" accept="image/*" capture="environment" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onStopPhotoTaken(f); }} />
          </label>
        )}
        {/* The stop section had no message slot, so anything that went wrong here
            was invisible — the button just looked dead. */}
        {msg && <p className={`text-sm ${tone}`}>{msg.text}</p>}
        {stops.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm border-t border-amber-200 dark:border-amber-900 pt-2">
            {stops.map((s) => {
              const mins = s.departed_at
                ? Math.max(0, Math.round((new Date(s.departed_at).getTime() - new Date(s.arrived_at).getTime()) / 60000))
                : null;
              return (
                <li key={s.id} className="flex justify-between gap-2">
                  <span>
                    📍 {s.label || "—"}{" "}
                    <span className="text-xs text-zinc-500">
                      {tm(s.arrived_at)}
                      {s.departed_at ? `–${tm(s.departed_at)} · ${mins}m` : ` · ${tr.rHereNow}`}
                    </span>
                  </span>
                  {s.miles_from_prev != null && <span className="text-xs text-zinc-500 tabular-nums">+{s.miles_from_prev} mi</span>}
                </li>
              );
            })}
          </ul>
        )}
        {/* Can't finish the run while a stop is still open — close it first so the
            time-at-stop stays real instead of us guessing a departure.
            And nothing here is tappable while she's on lunch: this button used to
            sit live next to "Terminar almuerzo" and ended the whole run. */}
        {tripPaused ? null : openStop ? (
          <p className="border-t border-amber-200 dark:border-amber-900 pt-2 text-xs text-amber-700 dark:text-amber-400">
            {tr.rCloseStopFirst}
          </p>
        ) : personalTrip ? (
          <button onClick={end} disabled={busy} className={`${btn("primary", "lg", { full: true })} mt-1`}>✅ {busy ? "…" : endLabel}</button>
        ) : (
          <details className="border-t border-amber-200 dark:border-amber-900 pt-2">
            <summary className="cursor-pointer list-none text-sm font-semibold text-emerald-700">✅ {endLabel}</summary>
            <div className="pt-3">{endForm}</div>
          </details>
        )}
        {!stopPhoto && msg && <p className={`text-sm ${tone}`}>{msg.text}</p>}
      </div>
    );
  }

  // ---- Not on a trip ----
  if (vehicles.length === 0 && !personal) {
    // Runner clocked in with no vehicle configured: still allow a personal run.
    return isRunner ? (
      <div className="w-full max-w-sm mx-auto rounded-2xl border border-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/20 p-4 flex flex-col gap-3">
        <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">🚗 {tr.rRecordVehicle}</p>
        <p className="text-xs text-amber-700 dark:text-amber-400">{tr.rNoVehicleSet}</p>
        {personalToggle}
        {personal && (
          <label className={`flex items-center justify-center gap-2 rounded-xl py-4 text-white font-semibold cursor-pointer ${uploading || busy ? "bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-500"}`}>
            {uploading || busy ? tr.uploadingPhoto : `📷 ${tr.rStartPhoto}`}
            <input type="file" accept="image/*" capture="environment" hidden disabled={uploading || busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onPersonalPhoto(f); }} />
          </label>
        )}
        {photo && !busy && !uploading && (
          <button onClick={() => start()} className={btn("primary", "md")}>{startLabel}</button>
        )}
        {msg && <p className={`text-sm ${tone}`}>{msg.text}</p>}
      </div>
    ) : null;
  }

  // Runner: prominent "record your vehicle before your first run" (always expanded).
  if (isRunner) {
    return (
      <div className="w-full max-w-sm mx-auto rounded-2xl border border-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/20 p-4 flex flex-col gap-3">
        <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">🚗 {tr.rRecordVehicle}</p>
        {startForm}
      </div>
    );
  }

  // Salesman: optional collapsed "Heading out".
  return (
    <div className="w-full max-w-sm mx-auto">
      {open ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">🚗 {tr.rHeadingOut}</p>
            <button onClick={() => setOpen(false)} className="text-xs text-zinc-400">{tr.cancel}</button>
          </div>
          {startForm}
        </div>
      ) : (
        <button onClick={() => { setOpen(true); setMsg(null); }} className="w-full min-h-[56px] py-4 rounded-2xl border border-amber-400 text-amber-700 dark:text-amber-400 text-lg font-semibold hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors">
          🚗 {tr.rHeadingOut}
        </button>
      )}
    </div>
  );
}
