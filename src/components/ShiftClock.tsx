"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { batteryGuardState, isNativeApp, openOemBatterySettings, requestBatteryExemption, requestHibernationExemption, type BatteryGuardState } from "@/lib/native-bridge";
import { fmtDuration } from "@/lib/utils";

// ============================================================
// Driver shift clock. The driver taps "Clock in" when they start their day and
// "Clock out" when they finish. On-clock time (minus time actively out on a
// delivery) feeds the idle-time KPI on the dashboard. While on the clock the
// elapsed time ticks live.
// ============================================================

export function ShiftClock({ driverId }: { driverId: string }) {
  const { shifts, clockIn, clockOut } = useData();
  const { t } = usePrefs();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const open = useMemo(
    () => shifts.find((s) => s.driver_id === driverId && !s.ended_at) ?? null,
    [shifts, driverId],
  );

  // Tick every second only while on the clock.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  const elapsed = open ? now - new Date(open.started_at).getTime() : 0;

  // Position sharing is NOT started here. It lives in the layout
  // (LocationTracker) so it survives the driver navigating to My route —
  // starting it from a single screen used to tear the service down on every
  // navigation. This card only needs to know whether it's running natively,
  // to decide which battery prompts are worth showing.
  const native = isNativeApp();

  // Android throttles background location unless the app is exempt from
  // battery optimisation, so an unexempt phone silently stops reporting once
  // the screen goes off. Check on shift start, and re-check when the driver
  // comes back to the app (i.e. after the system dialog).
  const [battery, setBattery] = useState<BatteryGuardState | null>(null);
  useEffect(() => {
    if (!open || !native) { setBattery(null); return; }
    let cancelled = false;
    const check = async () => {
      const state = await batteryGuardState();
      if (!cancelled) setBattery(state);
    };
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [open, native]);

  // G-7 (D-200): clockIn/clockOut end in reloadAll(), which can reject on a network failure;
  // without the finally, `busy` stayed true and the punch button — the GPS switch — went dead
  // until a reload.
  const doIn = async () => { setBusy(true); try { await clockIn(driverId); } finally { setBusy(false); } };
  const doOut = async () => { setBusy(true); try { await clockOut(driverId); } finally { setBusy(false); } };

  return (
    <>
    <div
      className="card"
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, marginBottom: 12, flexWrap: "wrap",
        borderColor: open ? "var(--green)" : "var(--line)",
        background: open ? "rgba(16,185,129,0.06)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 22 }}>{open ? "🟢" : "⏱️"}</span>
        <div>
          <div style={{ fontWeight: 700 }}>
            {open ? t("On the clock", "En turno") : t("Off the clock", "Fuera de turno")}
          </div>
          <div className="hint" style={{ fontVariantNumeric: "tabular-nums" }}>
            {open
              ? t("Working for", "Trabajando por") + " " + fmtDuration(elapsed)
              : t("Clock in when you start your shift.", "Marca entrada al iniciar tu turno.")}
          </div>
          {/* The shift card is deliberately just the clock. Location status was
              removed from the driver's view at the owner's request; drivers are
              informed of tracking through their signed agreement, and Android
              itself shows a permanent notification the whole time the service
              runs, which no app is allowed to suppress.
              Dispatch still sees failures: an on-shift driver whose phone stops
              reporting is flagged in Routes Manager (see trackingGaps). */}
        </div>
      </div>
      {open ? (
        <button className="btn btn-ghost" disabled={busy} onClick={doOut}>
          {t("Clock out", "Marcar salida")}
        </button>
      ) : (
        <button className="btn btn-primary" disabled={busy} onClick={doIn}>
          {t("Clock in", "Marcar entrada")}
        </button>
      )}
    </div>

    {/* Android will quietly throttle the location service once the screen is
        off unless the app is exempt. Surfaced as a fixable prompt rather than
        letting the truck vanish off the dispatcher's map mid-route. */}
    {/* HIBERNATION — a different setting from battery optimisation, and the
        one whose own screen says "pause". A driver can grant location and the
        battery exemption and still be paused by this, because Android measures
        whether the app is OPENED, and a phone in a cradle all day never is.
        Shown only when the APK could actually read the setting; an older build
        reports undefined and says nothing rather than nagging blindly. */}
    {open && battery?.hibernationExempt === false && (
      <div className="card" style={{ marginBottom: 12, background: "#fff7ec", borderColor: "var(--amber)" }}>
        <b style={{ color: "#b9791a" }}>
          ⏸ {t("Android is set to pause this app", "Android está configurado para pausar esta app")}
        </b>
        <div className="hint" style={{ marginTop: 4 }}>
          {t(
            "Turn OFF “Pause app activity if unused”. Leaving it on lets Android stop the app and take back its permissions, even though you granted them.",
            "Desactiva “Pausar la actividad de la app si no se usa”. Si queda activado, Android puede detener la app y quitarle los permisos, aunque ya los hayas dado.",
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" onClick={() => void requestHibernationExemption()}>
            {t("Open setting", "Abrir ajuste")}
          </button>
        </div>
      </div>
    )}

    {open && battery && !battery.ignoring && (
      <div className="card" style={{ marginBottom: 12, background: "#fff7ec", borderColor: "var(--amber)" }}>
        <b style={{ color: "#b9791a" }}>
          🔋 {t("Your phone may pause this app", "Tu teléfono puede pausar esta app")}
        </b>
        <div className="hint" style={{ marginTop: 4 }}>
          {t(
            "Android can stop the app to save battery once the screen is off. Tap Allow so it keeps working for your whole shift.",
            "Android puede detener la app para ahorrar batería cuando la pantalla se apaga. Toca Permitir para que siga funcionando todo tu turno.",
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" onClick={() => void requestBatteryExemption()}>
            {t("Allow", "Permitir")}
          </button>
          {/* Samsung/Xiaomi/Oppo add their own killer on top of Android's, on a
              screen no app is allowed to change — the driver taps through it. */}
          {battery.hasOemSettings && (
            <button className="btn btn-ghost btn-sm" onClick={() => void openOemBatterySettings()}>
              {t(`${battery.manufacturer} settings`, `Ajustes de ${battery.manufacturer}`)}
            </button>
          )}
        </div>
      </div>
    )}
    </>
  );
}
