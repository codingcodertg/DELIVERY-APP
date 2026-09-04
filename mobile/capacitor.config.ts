import type { CapacitorConfig } from "@capacitor/cli";

// ============================================================
// RTG Hub — Android shell for drivers.
//
// The app is NOT bundled into the APK. The shell loads the live site, so a
// deploy reaches every driver's phone immediately with no reinstall. The only
// native part is background GPS: Android will not let a web page report
// position with the screen off, which is exactly what a driver's phone does
// all day in a truck.
// ============================================================

const config: CapacitorConfig = {
  appId: "net.rdztilegroup.deliveries",
  appName: "RTG Hub",
  // Capacitor requires a webDir even when loading a remote URL; this holds
  // only the offline fallback page.
  webDir: "www",
  server: {
    url: "https://deliveries-app-seven.vercel.app",
    // The site is HTTPS-only; no cleartext traffic is permitted.
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    // Keep the driver inside the app: links open in the shell, not a browser
    // tab that would lose their session.
    allowMixedContent: false,
    // Stamps the WebView's user agent so the web app can tell it's running in
    // the APK and which build. That's what the in-app update prompt compares
    // against — no extra plugin, and it works on the very first page load.
    // KEEP THE NUMBER IN SYNC WITH versionCode IN android/app/build.gradle.
    appendUserAgent: "RDZDeliveries/4",
  },
  plugins: {
    BackgroundGeolocation: {},
  },
};

export default config;
