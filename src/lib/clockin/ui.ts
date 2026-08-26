// Shared button design system. One source of truth so every button in the app
// is consistent, large enough to tap comfortably, and looks polished. Usage:
//   className={btn("primary", "lg", { full: true })}
// Keep buttons on-brand: emerald = primary action, red = destructive, neutral =
// secondary/outline, ghost = low-emphasis inline actions.

type Variant = "primary" | "danger" | "neutral" | "ghost";
type Size = "sm" | "md" | "lg" | "xl";

const BASE =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-2xl transition-all " +
  "active:scale-[0.98] disabled:opacity-60 disabled:pointer-events-none cursor-pointer " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950 select-none";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm hover:shadow-md",
  danger: "bg-red-600 hover:bg-red-500 text-white shadow-sm hover:shadow-md",
  neutral:
    "bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 " +
    "hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 shadow-sm",
  ghost: "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30",
};

// Generous, tap-friendly sizes (min-height guarantees a comfortable target).
const SIZES: Record<Size, string> = {
  sm: "text-sm px-4 py-2.5 min-h-[42px]",
  md: "text-base px-6 py-3 min-h-[48px]",
  lg: "text-lg px-6 py-4 min-h-[56px]",
  xl: "text-xl px-6 py-6 min-h-[68px]",
};

export function btn(variant: Variant = "primary", size: Size = "md", opts: { full?: boolean } = {}) {
  return [BASE, VARIANTS[variant], SIZES[size], opts.full ? "w-full" : ""].filter(Boolean).join(" ");
}

// Matching input/select style so forms read as one designed system.
export const field =
  "w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 " +
  "px-4 py-3 text-base min-h-[48px] transition-colors focus:outline-none focus:border-emerald-500 " +
  "focus:ring-2 focus:ring-emerald-500/30";

// Inline text link (nav-style), consistent across screens.
export const link =
  "inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:underline";

// True when running against a local dev server — used to relax the geolocation
// gate so the clock flow can be tested from a laptop without a real geofence.
export function isLocalhost() {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0";
}
