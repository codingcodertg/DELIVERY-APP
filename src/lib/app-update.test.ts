import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  installedApkVersion, pickSoftReloadJitter, safeToReload, shouldSoftReload, updateAvailable, webUpdateAvailable,
  SOFT_RELOAD_FALLBACK_MS, SOFT_RELOAD_IDLE_MS, SOFT_RELOAD_JITTER_MAX_MS, type SoftReloadInput,
} from "./app-update";

const APK = (n: number) =>
  `Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 RDZDeliveries/${n}`;
const CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

describe("installedApkVersion", () => {
  it("reads the build number the shell stamps on the user agent", () => {
    expect(installedApkVersion(APK(3))).toBe(3);
  });

  it("returns null in a plain browser", () => {
    expect(installedApkVersion(CHROME)).toBeNull();
    expect(installedApkVersion("")).toBeNull();
    expect(installedApkVersion(null)).toBeNull();
    expect(installedApkVersion(undefined)).toBeNull();
  });
});

describe("updateAvailable", () => {
  it("offers an update when the published build is newer", () => {
    expect(updateAvailable(APK(1), 2)).toBe(true);
  });

  it("stays quiet when the phone is already current", () => {
    expect(updateAvailable(APK(2), 2)).toBe(false);
  });

  it("never prompts a browser — there is nothing to install", () => {
    expect(updateAvailable(CHROME, 99)).toBe(false);
  });

  it("does not tell a newer test build to downgrade", () => {
    // Happens while a build is on a phone before its release is published.
    expect(updateAvailable(APK(5), 2)).toBe(false);
  });
});

// ---- Web update detection ---------------------------------------------------
describe("webUpdateAvailable", () => {
  it("spots a newer deploy", () => {
    expect(webUpdateAvailable("1.3.3", "1.3.4")).toBe(true);
  });

  it("says nothing when the page is current", () => {
    expect(webUpdateAvailable("1.3.4", "1.3.4")).toBe(false);
    expect(webUpdateAvailable("1.3.4", " 1.3.4 ")).toBe(false);   // whitespace is not a release
  });

  it("also picks up a rollback", () => {
    // A rollback is a change the page must take, not one to ignore because
    // the number went down.
    expect(webUpdateAvailable("1.3.4", "1.3.3")).toBe(true);
  });

  it("stays quiet when the server can't be read", () => {
    // A failing check that nags on every poll would train drivers to ignore it.
    expect(webUpdateAvailable("1.3.4", null)).toBe(false);
    expect(webUpdateAvailable("1.3.4", undefined)).toBe(false);
    expect(webUpdateAvailable("1.3.4", "")).toBe(false);
  });
});

describe("safeToReload", () => {
  const doc = (match: string | null) => ({ querySelector: (sel: string) => (match === sel ? ({} as Element) : null) });

  it("allows a reload on a quiet page", () => {
    expect(safeToReload(doc(null))).toBe(true);
  });

  it("refuses while a modal or sheet is open", () => {
    // The proof-of-delivery sheet is an .overlay; reloading through it would
    // discard a signature the driver just collected.
    expect(safeToReload(doc(".overlay"))).toBe(false);
  });

  it("refuses while something is being typed into", () => {
    expect(safeToReload(doc("input:focus, textarea:focus, select:focus"))).toBe(false);
  });

  it("refuses when there is no document at all", () => {
    expect(safeToReload(null)).toBe(false);
  });

  it("refuses while a form outside a modal holds unsaved edits (data-unsaved)", () => {
    expect(safeToReload(doc("[data-unsaved]"))).toBe(false);
  });
});

// ---- Soft refresh (D-NEXT) ---------------------------------------------------
describe("shouldSoftReload", () => {
  const T0 = 1_000_000_000;
  const JITTER = 3 * 60_000;
  // A page that noticed at T0, whose jitter has just passed, nobody touching it since T0.
  const base: SoftReloadInput = {
    stale: true, trigger: "navigation", hidden: false, unsaved: false, alreadyTried: false,
    now: T0 + JITTER, detectedAt: T0, jitterMs: JITTER, lastInputAt: T0,
  };

  it("does not reload the moment the new version is seen — the jitter has to pass first", () => {
    expect(shouldSoftReload({ ...base, now: T0 })).toBe(false);
    expect(shouldSoftReload({ ...base, now: T0 + JITTER - 1 })).toBe(false);
    expect(shouldSoftReload({ ...base, trigger: "visible", now: T0 + JITTER - 1 })).toBe(false);
  });

  it("reloads on a route navigation once the jitter has passed", () => {
    expect(shouldSoftReload({ ...base, trigger: "navigation", now: T0 + JITTER })).toBe(true);
  });

  it("reloads when the tab comes back from hidden once the jitter has passed", () => {
    expect(shouldSoftReload({ ...base, trigger: "visible", now: T0 + JITTER + 1 })).toBe(true);
  });

  it("never reloads a page that is not stale", () => {
    expect(shouldSoftReload({ ...base, stale: false })).toBe(false);
  });

  it("never reloads with unsaved work on screen", () => {
    expect(shouldSoftReload({ ...base, unsaved: true })).toBe(false);
    expect(shouldSoftReload({ ...base, trigger: "visible", unsaved: true })).toBe(false);
  });

  it("never reloads a hidden page", () => {
    expect(shouldSoftReload({ ...base, hidden: true })).toBe(false);
  });

  it("does not loop: one automatic attempt per served version", () => {
    expect(shouldSoftReload({ ...base, alreadyTried: true })).toBe(false);
  });

  it("an idle tick alone does not reload before the fallback window", () => {
    const now = T0 + JITTER + SOFT_RELOAD_FALLBACK_MS - 1;
    expect(shouldSoftReload({ ...base, trigger: "idle", now, lastInputAt: T0 })).toBe(false);
  });

  it("idle fallback: nobody stays on the old version forever on a page left open", () => {
    const now = T0 + JITTER + SOFT_RELOAD_FALLBACK_MS;
    expect(shouldSoftReload({ ...base, trigger: "idle", now, lastInputAt: now - SOFT_RELOAD_IDLE_MS })).toBe(true);
  });

  it("idle fallback waits while someone is using the page", () => {
    const now = T0 + JITTER + SOFT_RELOAD_FALLBACK_MS;
    expect(shouldSoftReload({ ...base, trigger: "idle", now, lastInputAt: now - SOFT_RELOAD_IDLE_MS + 1 })).toBe(false);
  });

  it("idle fallback also respects unsaved work", () => {
    const now = T0 + JITTER + SOFT_RELOAD_FALLBACK_MS;
    expect(shouldSoftReload({ ...base, trigger: "idle", now, lastInputAt: T0, unsaved: true })).toBe(false);
  });
});

// The rule above is only as good as what the banner feeds it (the component is a .tsx the
// test can't import). These read the source for the arguments that decide the outcome.
describe("AppUpdateBanner feeds shouldSoftReload", () => {
  const src = readFileSync(join(process.cwd(), "src/components/AppUpdateBanner.tsx"), "utf8").split("\r\n").join("\n");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("passes the real unsaved/hidden/already-tried state, not constants", () => {
    expect(code).toContain("unsaved: !safeToReload(document),");
    expect(code).toContain("hidden: document.hidden,");
    expect(code).toContain("alreadyTried: softReloadTried(served),");
    expect(code).toContain("jitterMs: jitterRef.current,");
  });

  it("a route change is a trigger, and only hidden → visible (not window focus) is the other", () => {
    expect(code).toContain('attemptRef.current?.("navigation")');
    expect(code).toMatch(/document\.visibilityState === "visible"\) setTimeout\(\(\) => attempt\("visible"\)/);
    expect(code).not.toMatch(/addEventListener\("focus", onVisible\)/);
  });

  it("reloads in exactly one place, and only after the rule said yes", () => {
    expect(code.split("location.reload()").length - 1).toBe(1);
    const i = code.indexOf("if (!go) return;");
    expect(i).toBeGreaterThan(-1);
    expect(code.indexOf("reloadNow();", i)).toBeGreaterThan(i);
    expect(code.slice(0, i)).not.toContain("reloadNow();");
  });
});

describe("pickSoftReloadJitter", () => {
  it("spreads clients across [0, 5 min)", () => {
    expect(SOFT_RELOAD_JITTER_MAX_MS).toBe(5 * 60_000);
    expect(pickSoftReloadJitter(() => 0)).toBe(0);
    expect(pickSoftReloadJitter(() => 0.5)).toBe(150_000);
    const top = pickSoftReloadJitter(() => 0.9999999);
    expect(top).toBeLessThan(SOFT_RELOAD_JITTER_MAX_MS);
    expect(top).toBeGreaterThan(SOFT_RELOAD_JITTER_MAX_MS - 1_000);
  });

  it("a broken random source never yields a negative or out-of-range delay", () => {
    expect(pickSoftReloadJitter(() => -3)).toBe(0);
    expect(pickSoftReloadJitter(() => 7)).toBeLessThan(SOFT_RELOAD_JITTER_MAX_MS);
    expect(pickSoftReloadJitter(() => NaN)).toBe(0);
  });
});
