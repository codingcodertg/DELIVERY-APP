import type { AppKey } from "@/lib/app-versions";

// ============================================================
// In-app update check for the driver APK.
//
// The shell loads the live site, so day-to-day changes (screens, pricing,
// routing) reach every phone the moment they deploy — no update needed. Only
// a NATIVE change (permissions, icon, GPS plugin) needs a new APK, and that's
// what this prompts for.
//
// The shell stamps its build number into the WebView's user agent
// (see mobile/capacitor.config.ts). No plugin, and it's readable on the very
// first render.
// ============================================================

/** Build number of the newest published APK. Bump this together with
 * `versionCode` in mobile/android/app/build.gradle and `appendUserAgent` in
 * mobile/capacitor.config.ts whenever a new APK is released. */
export const LATEST_APK_VERSION_CODE = 5;

/** Where the newest APK can be downloaded. Android's download manager handles
 * the install prompt, so the app itself needs no install permission. */
export const APK_DOWNLOAD_URL =
  "https://iwhcsvgujydebdyllcqu.supabase.co/storage/v1/object/public/app/RDZ-Deliveries.apk";

/**
 * The APK build this page is running inside, or null in a normal browser.
 * Matches the "RDZDeliveries/<n>" tag the shell appends to the user agent.
 */
export function installedApkVersion(userAgent: string | null | undefined): number | null {
  const m = /RDZDeliveries\/(\d+)/.exec(userAgent ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Should this device be offered an update?
 *
 * Only inside the APK, and only when the published build is genuinely newer.
 * A browser gets nothing (there's nothing to install), and a phone running a
 * build NEWER than the constant is left alone rather than told to downgrade —
 * that happens while testing a build before its release is published.
 */
export function updateAvailable(
  userAgent: string | null | undefined,
  latest: number = LATEST_APK_VERSION_CODE,
): boolean {
  const installed = installedApkVersion(userAgent);
  return installed != null && installed < latest;
}

// ---- Web version, for pages that are already running ------------------------
//
// The APK shell loads the live site, so a deploy IS the update — but only for
// pages loaded after it. A driver's phone that has been open since 6 a.m. is
// still running that morning's code, and nothing in the browser tells it so.

/** Answer from /api/version. `versions` is per-app (D-087) — a client
 * compares only its own key, never the other two. */
export interface VersionInfo { versions: Record<AppKey, string>; apk: number }

/**
 * Is the running page older than what the server is serving?
 *
 * Deliberately an INEQUALITY, not "less than": versions are strings, and a
 * rollback is a change the page should also pick up. Anything unreadable is
 * treated as "no change" — a broken check must never nag on every poll.
 */
export function webUpdateAvailable(running: string, served: string | null | undefined): boolean {
  if (!served || typeof served !== "string") return false;
  return served.trim() !== running.trim();
}

/**
 * Is it safe to reload the page out from under whoever is using it?
 *
 * No, if anything is open that holds work in progress — a modal, a signature,
 * a half-typed form. Reloading through those would throw away exactly the kind
 * of input that is most annoying to redo, at a customer's door.
 */
export function safeToReload(doc: Pick<Document, "querySelector"> | null | undefined): boolean {
  if (!doc) return false;
  if (doc.querySelector(".overlay")) return false;          // any modal or sheet
  // D-NEXT: a form outside a modal that holds edits it hasn't saved marks itself with
  // `data-unsaved` (Ajustes → Datos is the one today). Without it, a reload while the
  // field isn't focused would drop those edits without a word.
  if (doc.querySelector("[data-unsaved]")) return false;
  const el = doc.querySelector("input:focus, textarea:focus, select:focus");
  return !el;
}

// ---- Soft refresh (D-NEXT) ----------------------------------------------------
//
// Until D-NEXT a stale page reloaded itself the first time it came back to the
// foreground (focus OR visibilitychange). On 2026-10-15 that was measured to be a
// stampede: every deploy bumps APP_VERSION, every open client noticed within the
// same few minutes and reloaded, and every reload downloads the whole orders list
// (6.4 MB that day). Supabase's API saturated (auth/health 25–30 s) and Vercel
// answered 504 MIDDLEWARE_INVOCATION_TIMEOUT.
//
// Now: the banner shows at once (with its button), and the automatic reload waits
// for (1) a random delay of up to SOFT_RELOAD_JITTER_MAX_MS since this page noticed,
// so clients spread out instead of arriving together, and (2) a moment that is
// already a page change for the person: a route navigation, or the tab coming back
// from hidden. A page left visible and untouched still gets there through the idle
// fallback, so nobody stays on the old version indefinitely (what D-029 protected).

/** Upper bound of the random delay before an automatic reload is allowed. */
export const SOFT_RELOAD_JITTER_MAX_MS = 5 * 60_000;
/** A page that is still stale this long after the jitter reloads when idle, even without a trigger. */
export const SOFT_RELOAD_FALLBACK_MS = 60 * 60_000;
/** "Idle" for the fallback: no pointer/key/touch for this long. */
export const SOFT_RELOAD_IDLE_MS = 2 * 60_000;

/** The moment the reload is being considered at. `idle` is the periodic fallback tick. */
export type SoftReloadTrigger = "navigation" | "visible" | "idle";

export interface SoftReloadInput {
  /** The server serves a different version of THIS app (webUpdateAvailable). */
  stale: boolean;
  trigger: SoftReloadTrigger;
  /** document.hidden right now. Never reload a page nobody is looking at. */
  hidden: boolean;
  /** Something on screen holds work in progress (!safeToReload). */
  unsaved: boolean;
  /** This tab already reloaded once towards the version being served — it didn't help, don't loop. */
  alreadyTried: boolean;
  now: number;
  /** When this page first noticed it was stale. */
  detectedAt: number;
  /** This page's random delay, from pickSoftReloadJitter. */
  jitterMs: number;
  /** Last pointer/key/touch on the page. */
  lastInputAt: number;
}

/** Does the page reload itself now? Pure: everything it depends on is in the input. */
export function shouldSoftReload(s: SoftReloadInput): boolean {
  if (!s.stale || s.hidden || s.unsaved || s.alreadyTried) return false;
  const since = s.now - s.detectedAt;
  if (since < s.jitterMs) return false;
  if (s.trigger === "navigation" || s.trigger === "visible") return true;
  // Fallback: long stale and nobody touching it.
  return since >= s.jitterMs + SOFT_RELOAD_FALLBACK_MS && s.now - s.lastInputAt >= SOFT_RELOAD_IDLE_MS;
}

/** This page's share of the spread: uniform in [0, SOFT_RELOAD_JITTER_MAX_MS). */
export function pickSoftReloadJitter(rand: () => number = Math.random): number {
  const r = rand();
  const x = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0;
  return Math.floor(x * SOFT_RELOAD_JITTER_MAX_MS);
}

export const SOFT_RELOAD_KEY = "rdz.soft-reload";

/**
 * Did this tab already reload itself towards `served`? Survives the reload (sessionStorage),
 * which is the point: if the page comes back still stale for the SAME served version, a
 * second automatic reload would just loop — the banner's button stays. A later deploy is
 * a different `served`, so it gets its own attempt. Unreadable storage counts as "not tried".
 */
export function softReloadTried(served: string): boolean {
  try { return sessionStorage.getItem(SOFT_RELOAD_KEY) === served; } catch { return false; }
}

export function markSoftReload(served: string): void {
  try { sessionStorage.setItem(SOFT_RELOAD_KEY, served); } catch { /* reload anyway */ }
}
