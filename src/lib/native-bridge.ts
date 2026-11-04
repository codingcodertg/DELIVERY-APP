// ============================================================
// Bridge to the Android shell (Capacitor).
//
// The same web app runs in three places: a desktop browser, a phone browser,
// and inside the driver APK. Only the last one can report position with the
// screen off, so the app asks here whether the native bridge is present and
// degrades to the browser's own geolocation when it isn't.
//
// Nothing from Capacitor is bundled into the web build — the shell injects
// `window.Capacitor` into the WebView at runtime. That's what keeps the web
// deploy independent of the APK.
// ============================================================

/** One position fix, normalised to the shape the app stores. */
export interface NativeFix {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading: number | null;
  recorded_at: string;
}

interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (position: RawPosition | undefined, error?: { code?: string; message?: string }) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

interface RawPosition {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  bearing?: number | null;
  time?: number | null;
}

/** Custom plugin (see BatteryGuardPlugin.java) — keeps the location service
 * alive on phones whose battery managers would otherwise kill it. */
/**
 * Everything that has to be true before a shift can be tracked.
 *
 * Tri-state on purpose. `undefined` means "this phone has no such setting, or
 * this APK is too old to read it" — and that must NEVER be treated as denied.
 * Blocking a driver over something we can't verify would leave them unable to
 * work, which is a worse failure than the one this guards against.
 */
export interface DriverPermissionState {
  location?: boolean;
  backgroundLocation?: boolean;
  notifications?: boolean;
  battery?: boolean;
  hibernation?: boolean;
  manufacturer?: string;
  hasOemSettings?: boolean;
  sdk?: number;
}

/** One fix from the native time-based reporter. */
export interface TimedFix {
  lat: number; lng: number;
  accuracy?: number | null; speed?: number | null; bearing?: number | null;
  /** Epoch ms when the position was CAPTURED, not when it reached us. */
  time?: number | null;
}

interface BatteryGuardPlugin {
  startTimedPositions?(opts: { intervalMs: number }): Promise<{ started: boolean }>;
  stopTimedPositions?(): Promise<{ stopped: boolean }>;
  addListener?(event: "timedPosition" | "directFix", cb: (f: TimedFix) => void): Promise<{ remove: () => void }>;
  /** D-838 (APK 7): Android sube las posiciones solo. Otra llamada con la subida en marcha solo renueva la llave. */
  startDirectUpload?(opts: { url: string; token: string; intervalMs: number }): Promise<{ started: boolean; renewed?: boolean }>;
  stopDirectUpload?(): Promise<{ stopped: boolean }>;
  directUploadState?(): Promise<{ active: boolean; pending: number; lastOkAt: number; lastError: string | null }>;
  permissionState?(): Promise<DriverPermissionState>;
  requestLocation?(): Promise<DriverPermissionState>;
  requestBackgroundLocation?(): Promise<DriverPermissionState>;
  requestNotifications?(): Promise<DriverPermissionState>;
  openAppSettingsPage?(): Promise<{ opened: boolean }>;
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean; manufacturer: string; hasOemSettings: boolean; hibernationExempt?: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<{ ignoring: boolean; opened?: boolean }>;
  requestHibernationExemption?(): Promise<{ exempt: boolean; opened?: boolean }>;
  openOemSettings(): Promise<{ opened: boolean }>;
}

/** @capacitor/push-notifications, present only in an APK built with Firebase. */
interface PushPlugin {
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(event: "registration", cb: (t: { value: string }) => void): Promise<{ remove: () => void }>;
  addListener(event: "registrationError", cb: (e: unknown) => void): Promise<{ remove: () => void }>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    BackgroundGeolocation?: BackgroundGeolocationPlugin;
    BatteryGuard?: BatteryGuardPlugin;
    PushNotifications?: PushPlugin;
  };
}

function capacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null;
}

/** True when running inside the driver APK rather than a browser. */
export function isNativeApp(): boolean {
  const c = capacitor();
  return !!c && (c.isNativePlatform?.() ?? false);
}

/** The background-location plugin, or null in a plain browser. */
export function backgroundGeolocation(): BackgroundGeolocationPlugin | null {
  return capacitor()?.Plugins?.BackgroundGeolocation ?? null;
}

/**
 * Start reporting position from the native foreground service. Android shows
 * a permanent notification for the whole time this runs, so the driver can
 * always see that sharing is on — and it is torn down on clock-out.
 *
 * Returns a stop function, or null if there's no native bridge.
 */
export async function startNativeWatch(
  onFix: (fix: NativeFix) => void,
  onError: (message: string, denied: boolean) => void,
  labels: { title: string; message: string },
  distanceFilterM = 40,
): Promise<(() => void) | null> {
  const plugin = backgroundGeolocation();
  if (!plugin) return null;

  let watcherId: string | null = null;
  let stopped = false;

  try {
    watcherId = await plugin.addWatcher(
      {
        backgroundTitle: labels.title,
        backgroundMessage: labels.message,
        requestPermissions: true,
        // Skip the cached last-known fix — on a truck that's often the depot
        // from hours ago, which would put the driver in the wrong place.
        stale: false,
        distanceFilter: distanceFilterM,
      },
      (position, error) => {
        if (stopped) return;
        if (error) {
          onError(error.message || "Location error", error.code === "NOT_AUTHORIZED");
          return;
        }
        if (!position) return;
        onFix({
          lat: position.latitude,
          lng: position.longitude,
          accuracy_m: position.accuracy ?? null,
          speed_mps: position.speed ?? null,
          heading: position.bearing ?? null,
          recorded_at: new Date(position.time ?? Date.now()).toISOString(),
        });
      },
    );
  } catch (e) {
    onError(e instanceof Error ? e.message : "Could not start location sharing", false);
    return null;
  }

  return () => {
    stopped = true;
    if (watcherId) void plugin.removeWatcher({ id: watcherId }).catch(() => { /* shutting down */ });
  };
}

/** Open the OS settings page, so a driver who denied the permission can fix it. */
export async function openLocationSettings(): Promise<void> {
  await backgroundGeolocation()?.openSettings().catch(() => { /* not fatal */ });
}

// ---- Battery-optimisation guard --------------------------------------------
// A foreground service is the strongest guarantee stock Android gives, but
// Doze and the OEM battery managers (Samsung, Xiaomi, Oppo…) still cut work
// off on top of it. These expose the two things an app is allowed to do:
// request the standard exemption, and open the vendor's own screen.

function batteryGuard(): BatteryGuardPlugin | null {
  return capacitor()?.Plugins?.BatteryGuard ?? null;
}

export interface BatteryGuardState {
  /** Exempt from Doze — background location is safe. */
  ignoring: boolean;
  manufacturer: string;
  /** This phone has a vendor auto-start screen worth pointing the driver at. */
  hasOemSettings: boolean;
  /**
   * Exempt from hibernation ("Pause app activity if unused") — a SEPARATE
   * Android 11+ setting from battery optimisation, which is why a driver can
   * grant everything and still be paused.
   *
   * `undefined` on an APK built before this check existed: unknown, so the app
   * says nothing rather than nagging about a setting it cannot read.
   */
  hibernationExempt?: boolean;
}

/** Current exemption state, or null outside the APK. */
export async function batteryGuardState(): Promise<BatteryGuardState | null> {
  const p = batteryGuard();
  if (!p) return null;
  try {
    return await p.isIgnoringBatteryOptimizations();
  } catch {
    return null;
  }
}

/** Show Android's "allow this app to run in the background?" dialog. */
export async function requestBatteryExemption(): Promise<void> {
  await batteryGuard()?.requestIgnoreBatteryOptimizations().catch(() => { /* not fatal */ });
}

/**
 * Read every permission the driver app depends on, or null when there's no
 * native bridge / the APK predates this check. Null means "don't gate" — see
 * DriverPermissionState.
 */
export async function driverPermissionState(): Promise<DriverPermissionState | null> {
  const p = batteryGuard();
  if (!p?.permissionState) return null;
  try {
    return await p.permissionState();
  } catch {
    return null;
  }
}

/** Which requirements are readable AND denied. Empty = nothing to block on. */
export function missingPermissions(s: DriverPermissionState | null): Array<keyof DriverPermissionState> {
  if (!s) return [];
  const keys: Array<keyof DriverPermissionState> = ["location", "backgroundLocation", "notifications", "battery", "hibernation"];
  return keys.filter((k) => s[k] === false);
}

export async function requestLocationPermission(): Promise<DriverPermissionState | null> {
  const p = batteryGuard();
  if (!p?.requestLocation) return null;
  return p.requestLocation().catch(() => null);
}

export async function requestBackgroundLocationPermission(): Promise<DriverPermissionState | null> {
  const p = batteryGuard();
  if (!p?.requestBackgroundLocation) return null;
  return p.requestBackgroundLocation().catch(() => null);
}

export async function requestNotificationPermission(): Promise<DriverPermissionState | null> {
  const p = batteryGuard();
  if (!p?.requestNotifications) return null;
  return p.requestNotifications().catch(() => null);
}

/** Last resort for a permission Android refuses to ask for again. */
export async function openAppSettingsPage(): Promise<void> {
  await batteryGuard()?.openAppSettingsPage?.().catch(() => { /* not fatal */ });
}

/** Open Android's "pause app activity if unused" screen for this app. */
export async function requestHibernationExemption(): Promise<void> {
  const p = batteryGuard();
  if (!p?.requestHibernationExemption) return;
  await p.requestHibernationExemption().catch(() => { /* not fatal */ });
}

/** Open the manufacturer's auto-start / protected-apps screen. */
export async function openOemBatterySettings(): Promise<void> {
  await batteryGuard()?.openOemSettings().catch(() => { /* not fatal */ });
}

// ---- Push registration ------------------------------------------------------

/**
 * Ask Firebase for this phone's token and hand it back once.
 *
 * Returns null everywhere push isn't available — a browser, or an APK built
 * before Firebase was wired in. Callers treat null as "no push on this
 * device", never as an error: the in-app bell is the record either way.
 */
export async function registerForPush(onToken: (token: string) => void): Promise<boolean> {
  const p = capacitor()?.Plugins?.PushNotifications;
  if (!p) return false;
  try {
    const perm = await p.requestPermissions();
    if (perm.receive !== "granted") return false;
    await p.addListener("registration", (t) => { if (t?.value) onToken(t.value); });
    await p.addListener("registrationError", () => { /* nothing to do; bell still works */ });
    await p.register();
    return true;
  } catch {
    return false;
  }
}

// ---- Time-based position reporting -----------------------------------------

/**
 * Ask the native side to report a position every `intervalMs`, moving or not.
 *
 * The GPS plugin reports on DISTANCE, so a parked truck says nothing and hours
 * of a day come back unaccounted for. This fills those in. The fixes arrive
 * late when the app is backgrounded — Android suspends the WebView — but each
 * carries its own capture time, so the track is right even though the upload
 * is bursty.
 *
 * Returns a stop function, or null where it isn't available (a browser, or an
 * APK built before this existed).
 */
/** D-838: ¿sabe esta APK subir las posiciones sola? (APK 7 en adelante.) */
export function directUploadAvailable(): boolean {
  return !!batteryGuard()?.startDirectUpload;
}

/**
 * D-838: arranca la subida directa desde Android. `renueva(token)` cambia la llave sin parar nada (la página la pide al
 * volver al frente). null si esta APK no la tiene o no arrancó: la página sigue subiendo como antes.
 */
export async function startDirectUpload(
  url: string, token: string, onFix: (fix: TimedFix) => void, intervalMs = 5_000,
): Promise<{ stop: () => void; renueva: (token: string) => void } | null> {
  const p = batteryGuard();
  if (!p?.startDirectUpload || !p.addListener) return null;
  try {
    const handle = await p.addListener("directFix", (f) => { if (typeof f?.lat === "number" && typeof f?.lng === "number") onFix(f); });
    await p.startDirectUpload({ url, token, intervalMs });
    return {
      stop: () => { try { handle.remove(); } catch { /* cerrando */ } void p.stopDirectUpload?.().catch(() => { /* cerrando */ }); },
      renueva: (t: string) => { void p.startDirectUpload?.({ url, token: t, intervalMs }).catch(() => { /* la siguiente vuelta al frente lo intenta */ }); },
    };
  } catch {
    return null;
  }
}

export async function startTimedPositions(
  onFix: (fix: TimedFix) => void,
  intervalMs = 120_000,
): Promise<(() => void) | null> {
  const p = batteryGuard();
  if (!p?.startTimedPositions || !p.addListener) return null;
  try {
    const handle = await p.addListener("timedPosition", (f) => {
      if (typeof f?.lat === "number" && typeof f?.lng === "number") onFix(f);
    });
    await p.startTimedPositions({ intervalMs });
    return () => {
      try { handle.remove(); } catch { /* shutting down */ }
      void p.stopTimedPositions?.().catch(() => { /* shutting down */ });
    };
  } catch {
    return null;
  }
}
