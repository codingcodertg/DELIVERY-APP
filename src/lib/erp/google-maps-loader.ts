"use client";

// ============================================================
// Loads the Google Maps JavaScript API once per page.
//
// Every map in the app shares one script tag and one in-flight promise —
// loading it twice throws, and each load is billable, so this is deliberately
// a singleton.
//
// The key here is a BROWSER key and is visible to anyone who opens devtools.
// That's unavoidable with the Maps JS API, which is why it must be a SEPARATE,
// referrer-restricted key from the server-side one that pays for Routes and
// Geocoding.
//
// PORTED VERBATIM from deliveries-app (ADR 0010). One thing the referrer restriction implies and
// nobody is told by an error message: the browser key is restricted to the domains it was issued
// for, so it will refuse to load on a NEW domain until that domain is added in Google Cloud. The
// map degrades to a list rather than a broken tile grid, and says why.
// ============================================================

export const BROWSER_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";

/** Optional Cloud-styled Map ID. Advanced markers need one; without it the
 * map still renders and we fall back to classic markers. */
export const MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "";

/** True when a browser key is configured — otherwise callers keep Leaflet. */
export function googleMapsEnabled(): boolean {
  return BROWSER_MAPS_KEY.length > 0;
}

let loadPromise: Promise<typeof google.maps> | null = null;

/** Resolve the Maps JS namespace, loading the script on first call. */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window === "undefined") return Promise.reject(new Error("Maps JS is browser-only"));
  if (!BROWSER_MAPS_KEY) return Promise.reject(new Error("No browser Maps key configured"));
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    // Another bundle may have injected it already (e.g. a hot reload).
    if (window.google?.maps) { resolve(window.google.maps); return; }

    // With loading=async Google requires a `callback`: the script's own onload
    // fires before the API has finished initialising, so resolving there hands
    // back a half-built namespace and the first map constructor throws.
    const cbName = `__rdzMapsReady_${Date.now().toString(36)}`;
    const w = window as unknown as Record<string, unknown>;

    const settle = (fn: () => void) => {
      delete w[cbName];
      fn();
    };

    w[cbName] = () => {
      if (window.google?.maps) settle(() => resolve(window.google.maps));
      else settle(() => { loadPromise = null; reject(new Error("Google Maps loaded without the maps namespace")); });
    };

    const params = new URLSearchParams({
      key: BROWSER_MAPS_KEY,
      v: "weekly",
      libraries: "marker,geometry",
      language: "es",
      region: "US",
      loading: "async",
      callback: cbName,
    });
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      // Let the next caller retry — a failed load is usually a blocked
      // request or a restricted key, both of which can be fixed live.
      settle(() => { loadPromise = null; reject(new Error("Google Maps failed to load")); });
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
