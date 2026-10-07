"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import {
  driverPermissionState,
  isNativeApp,
  missingPermissions,
  openAppSettingsPage,
  openOemBatterySettings,
  requestBackgroundLocationPermission,
  requestBatteryExemption,
  requestHibernationExemption,
  requestLocationPermission,
  requestNotificationPermission,
  type DriverPermissionState,
} from "@/lib/native-bridge";

// ============================================================
// THE DRIVER APP DOESN'T OPEN UNTIL THE PHONE CAN ACTUALLY REPORT.
//
// Every one of these was granted by a driver at some point and then quietly
// undone — by Android hibernating the app, by an OEM battery manager, or by
// tapping "deny" on a dialog that appeared mid-route. The result each time is
// a truck that vanishes off the dispatcher's map while the driver has no idea
// anything is wrong.
//
// So this blocks the way in rather than warning after the fact.
//
// TWO RULES KEEP THE BLOCK FROM BECOMING THE BIGGER PROBLEM:
//
//  1. It only blocks on requirements it can actually READ as denied. Anything
//     the phone doesn't have, or that this APK is too old to check, comes back
//     undefined and is never held against the driver. A driver locked out over
//     a setting we can't verify can't deliver, which is worse than untracked.
//
//  2. It only runs inside the APK. In a browser none of these settings exist,
//     and gating there would lock out the office.
// ============================================================

/** How each requirement is described to the driver, in the order it's fixed. */
type Key = "location" | "backgroundLocation" | "notifications" | "battery" | "hibernation";

export function DriverGate({ children }: { children: React.ReactNode }) {
  const { t } = usePrefs();
  const [state, setState] = useState<DriverPermissionState | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<Key | null>(null);
  // Counts how many times a fix was attempted without the state changing.
  // Android stops showing a dialog after two refusals, and from then on the
  // only way through is the app's settings page — so say that instead of
  // leaving the driver tapping a button that does nothing.
  const [stuck, setStuck] = useState(0);

  const refresh = useCallback(async () => {
    const s = await driverPermissionState();
    setState(s);
    setChecked(true);
    return s;
  }, []);

  useEffect(() => {
    if (!isNativeApp()) { setChecked(true); return; }
    void refresh();
    // Every fix here happens in a system screen, so the answer only arrives
    // when the driver comes back to the app.
    const onBack = () => void refresh();
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onBack);
    return () => {
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onBack);
    };
  }, [refresh]);

  const missing = missingPermissions(state) as Key[];
  if (!checked || missing.length === 0) return <>{children}</>;

  const fix = async (k: Key) => {
    setBusy(k);
    const before = JSON.stringify(state);
    if (k === "location") await requestLocationPermission();
    else if (k === "backgroundLocation") await requestBackgroundLocationPermission();
    else if (k === "notifications") await requestNotificationPermission();
    else if (k === "battery") await requestBatteryExemption();
    // D-492: «Info de la app», no la pantalla dedicada. En Android 13/14 (el Motorola de Julio, 2026-10-07) el intent de
    // auto-revocación aterriza en «Uso de batería», que NO tiene el interruptor, y el chofer se queda dando vueltas. El
    // interruptor «Pausar actividad de la app si no se usa» vive en «Info de la app». La pantalla dedicada queda como
    // segundo botón por si algún teléfono la tiene y la de info no.
    else if (k === "hibernation") await openAppSettingsPage();
    const after = await refresh();
    setBusy(null);
    setStuck((n) => (JSON.stringify(after) === before ? n + 1 : 0));
  };

  const copy: Record<Key, { title: string; why: string; action: string }> = {
    location: {
      title: t("Location", "Ubicación"),
      why: t("The office needs to know where the truck is.", "La oficina necesita saber dónde está el camión."),
      action: t("Allow", "Permitir"),
    },
    backgroundLocation: {
      title: t("Location: “Allow all the time”", "Ubicación: “Permitir siempre”"),
      why: t(
        "“Only while using the app” stops the moment the screen goes off — which is most of the day in a truck.",
        "“Solo mientras se usa la app” se corta apenas se apaga la pantalla — que es casi todo el día en el camión.",
      ),
      action: t("Allow all the time", "Permitir siempre"),
    },
    notifications: {
      title: t("Notifications", "Notificaciones"),
      why: t(
        "Android shows a permanent notice while location is shared. Without it you lose the one visible sign that it's on.",
        "Android muestra un aviso permanente mientras se comparte la ubicación. Sin él pierdes la única señal visible de que está activo.",
      ),
      action: t("Allow", "Permitir"),
    },
    battery: {
      title: t("Don't optimise battery", "No optimizar la batería"),
      why: t(
        "Android throttles the app once the screen is off and the phone is still — a truck at a long stop looks exactly like that.",
        "Android frena la app cuando la pantalla se apaga y el teléfono está quieto — un camión en una parada larga se ve exactamente así.",
      ),
      action: t("Allow", "Permitir"),
    },
    hibernation: {
      title: t("Don't pause the app", "No pausar la app"),
      why: t(
        "Android pauses apps you don't OPEN — and a phone working all day in a cradle is never opened. This is the one that takes your permissions back.",
        "Android pausa las apps que no ABRES — y un teléfono trabajando todo el día en el soporte nunca se abre. Este es el que te quita los permisos.",
      ),
      action: t("Open app info", "Abrir info de la app"),
    },
  };

  // Los pasos de «No pausar la app», a la vista (D-492). El dueño, 2026-10-07, con video del teléfono de Julio: «mira no
  // saben como hacer eso de open setting». El nombre del interruptor cambia según la marca; se dicen los tres.
  const pasosDeNoPausar = [
    t("Tap “Open app info”.", "Toca «Abrir info de la app»."),
    t(
      "Scroll down to “Pause app activity if unused” (on some phones “Remove permissions if app is unused” or “Manage app if unused”).",
      "Baja hasta «Pausar actividad de la app si no se usa» (en algunos teléfonos «Quitar permisos si no se usa» o «Administrar app si no se usa»).",
    ),
    t("Turn it OFF.", "Apágalo."),
    t("Come back to this app — it checks again by itself.", "Regresa a esta app — se vuelve a revisar sola."),
  ];

  const order: Key[] = ["location", "backgroundLocation", "notifications", "battery", "hibernation"];
  const pending = order.filter((k) => missing.includes(k));
  // One at a time, in order: background location can't even be asked for until
  // foreground location is held, so showing five buttons at once would hand
  // the driver four that silently do nothing.
  const current = pending[0];

  return (
    <div className="wrap" style={{ paddingTop: 18 }}>
      <div className="card gate-card">
        <div className="gate-alarm">⚠</div>
        <h2 style={{ margin: "10px 0 4px" }}>
          {t("Your phone can't report yet", "Tu teléfono aún no puede reportar")}
        </h2>
        <p style={{ margin: "0 0 4px", color: "var(--ink-soft)" }}>
          {t(
            "The app stays locked until this is fixed. Without it the office loses the truck on the map and can't tell customers where you are.",
            "La app queda bloqueada hasta arreglar esto. Sin esto la oficina pierde el camión en el mapa y no puede decirle al cliente dónde vas.",
          )}
        </p>
        <div className="hint" style={{ marginBottom: 14 }}>
          {t(
            `${pending.length} left · takes under a minute`,
            `Faltan ${pending.length} · toma menos de un minuto`,
          )}
        </div>

        {order.map((k) => {
          const denied = missing.includes(k);
          const known = state?.[k] !== undefined;
          if (!known) return null;             // this phone has no such setting
          const isCurrent = k === current;
          return (
            <div key={k} className={`gate-row${isCurrent ? " gate-row-now" : ""}`}>
              <span className="gate-mark" style={{ color: denied ? "var(--amber)" : "var(--green)" }}>
                {denied ? "○" : "✓"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{copy[k].title}</div>
                {denied && <div className="hint" style={{ marginTop: 2 }}>{copy[k].why}</div>}
                {isCurrent && k === "hibernation" && (
                  <div data-pasos-no-pausar style={{ marginTop: 8 }}>
                    <ol style={{ margin: "0 0 8px", paddingLeft: 20, fontSize: 14, lineHeight: 1.45 }}>
                      {pasosDeNoPausar.map((p) => <li key={p}>{p}</li>)}
                    </ol>
                    <button className="btn btn-ghost btn-sm" onClick={() => void requestHibernationExemption()}>
                      {t("Not there? Try the other screen", "¿No está ahí? Prueba la otra pantalla")}
                    </button>
                  </div>
                )}
              </div>
              {isCurrent && (
                <button className="btn btn-primary" disabled={busy !== null} onClick={() => void fix(k)}>
                  {busy === k ? "…" : copy[k].action}
                </button>
              )}
            </div>
          );
        })}

        {/* After two refusals Android stops showing the dialog at all. */}
        {stuck >= 2 && (
          <div className="hint" style={{ marginTop: 14, color: "var(--amber)", fontWeight: 600 }}>
            {t(
              "Android won't ask again. Open the app's settings and turn it on there.",
              "Android ya no lo va a preguntar. Abre los ajustes de la app y actívalo ahí.",
            )}
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => void openAppSettingsPage()}>
                {t("App settings", "Ajustes de la app")}
              </button>
              {state?.hasOemSettings && (
                <button className="btn btn-ghost btn-sm" onClick={() => void openOemBatterySettings()}>
                  {t(`${state.manufacturer} settings`, `Ajustes de ${state.manufacturer}`)}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
