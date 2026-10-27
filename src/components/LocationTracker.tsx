"use client";

import { useEffect, useMemo, useRef } from "react";
import { useData } from "@/lib/data-provider";
import { useLiveLocation } from "@/lib/useLiveLocation";
import { deviceId, isShiftDevice } from "@/lib/device-id";
import { isNativeApp, openLocationSettings } from "@/lib/native-bridge";
import { avisoDeGps } from "@/lib/gps-del-turno";
import { APK_DOWNLOAD_URL } from "@/lib/app-update";
import { usePrefs } from "@/lib/prefs";
import type { Profile } from "@/lib/types";

// ============================================================
// Keeps position sharing running for a driver's whole shift.
//
// THIS LIVES IN THE LAYOUT ON PURPOSE, and that is the entire point of the
// component.
//
// It used to run inside ShiftClock, which only renders on the Orders screen.
// So the moment a driver tapped "My route", Next.js unmounted that screen, the
// hook's cleanup ran, removeWatcher() fired, and Android tore down the
// foreground service — while the driver was still clocked in. The truck simply
// vanished from dispatch until they navigated back, and on return the watcher
// starts fresh: it refuses the cached position and waits for 40 m of movement,
// so a parked truck stayed invisible for as long as it stayed parked. That is
// exactly the "45 minutes to come back as LIVE" that got reported.
//
// Mounted here it survives every navigation inside the app, so the only things
// that stop tracking are the ones that should: clocking out, or closing the
// app.
//
// D-714: it used to render nothing and THROW AWAY the hook's status. Now the
// status is written to the open shift (`driver_shifts.gps`, migration 206) so
// the office can see WHY a truck is silent, and the driver gets one banner for
// the two things only they can fix: they clocked in from a browser (open the
// APK), or Android is refusing the location (grant it). «starting»/«live» say
// nothing — the owner asked for the shift card to stay just a clock.
// ============================================================

export function LocationTracker({ me }: { me: Profile }) {
  const { shifts, marcaGpsDelTurno } = useData();
  const { t } = usePrefs();

  const shift = useMemo(() => shifts.find((s) => s.driver_id === me.id && !s.ended_at) ?? null, [shifts, me.id]);
  const esteTelefono = !!shift && isShiftDevice(shift.device_id, deviceId());

  const track = useMemo(() => {
    if (!shift) return false;
    // ONLY THE PHONE THAT CLOCKED IN.
    //
    // A driver's account can be signed in on more than one device — the office
    // logs in to look at something. Without this, every one of them reports
    // position for the same shift, and the day's track ends up stitched from
    // two places at once. That really happened: one day came out at 4,936
    // miles with fixes 1,300 miles apart.
    //
    // Unknown on either side is permissive: a shift opened before this
    // existed, or a phone that can't keep local storage, keeps working. Going
    // dark on a real driver mid-route would be worse than the mixing it
    // prevents.
    if (!isShiftDevice(shift.device_id, deviceId())) return false;
    // A browser is someone reviewing, not someone driving. Only the APK can
    // report with the screen off anyway, so this costs nothing real and shuts
    // the office's laptop out of the driver's track for good.
    return isNativeApp();
  }, [shift]);

  const { status, native } = useLiveLocation(track);

  // The shift remembers the last status, written once per change (not per fix).
  const escritoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!shift || !esteTelefono) return;
    const clave = `${shift.id}:${status}`;
    if (escritoRef.current === clave) return;
    escritoRef.current = clave;
    void marcaGpsDelTurno(shift.id, status);
  }, [shift, esteTelefono, status, marcaGpsDelTurno]);

  const aviso = avisoDeGps({ enTurno: esteTelefono, nativa: isNativeApp() || native, estado: status });
  if (!aviso) return null;

  return (
    <div data-aviso-gps-chofer={aviso.tipo} className="card"
      style={{ margin: "10px 12px 0", background: "var(--amber-soft)", borderColor: "var(--amber)" }}>
      <b style={{ color: "var(--amber-text)" }}>
        📡 {aviso.tipo === "navegador"
          ? t("This phone isn't sharing its location", "Este teléfono no está compartiendo su ubicación")
          : aviso.tipo === "sin_permiso"
            ? t("Android is blocking the location", "Android está bloqueando la ubicación")
            : t("No GPS on this phone", "Este teléfono no tiene GPS")}
      </b>
      <div className="hint" style={{ marginTop: 4 }}>
        {aviso.tipo === "navegador"
          ? t("You clocked in from the browser. Open the RTG Hub app and clock in there so the office can see the truck.",
              "Marcaste entrada desde el navegador. Abre la app RTG Hub y marca entrada ahí para que la oficina vea el camión.")
          : aviso.tipo === "sin_permiso"
            ? t("Allow location for RTG Hub (“Allow all the time”).", "Permite la ubicación a RTG Hub (“Permitir siempre”).")
            : t("The app can't get a position from this phone. Tell the office.", "La app no consigue la posición de este teléfono. Avisa a la oficina.")}
      </div>
      {aviso.tipo === "navegador" && (
        <a className="btn btn-primary" href={APK_DOWNLOAD_URL} style={{ marginTop: 8, display: "inline-block" }}>
          {t("Get the app", "Descargar la app")}
        </a>
      )}
      {aviso.tipo === "sin_permiso" && (
        <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => void openLocationSettings()}>
          {t("Open settings", "Abrir ajustes")}
        </button>
      )}
    </div>
  );
}
