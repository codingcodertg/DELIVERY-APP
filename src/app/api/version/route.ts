import { NextResponse } from "next/server";
import { APP_VERSIONS, RECARGA_OBLIGATORIA } from "@/lib/app-versions";
import { LATEST_APK_VERSION_CODE } from "@/lib/app-update";

// ============================================================
// What the newest deploy is — asked by pages that are already running.
//
// A phone left open in a truck cradle holds the JavaScript it downloaded that
// morning. Every fix shipped since then is on the server and none of it is on
// that phone, and nothing in the browser tells the page it has gone stale.
// This is the one thing a stale page can ask.
//
// D-087: `versions` is per-app (deliveries/recruiting/timetracker), not one
// global number — a client only compares its OWN slice, so a deploy that
// only touched timetracker doesn't nag deliveries/recruiting users.
//
// `apk` is NOT a fourth app sitting alongside the three in `versions`. It's
// the driver shell's native build number — the Capacitor shell specifically
// loads deliveries (mobile/capacitor.config.ts) — so it conceptually hangs
// off deliveries, not its own independent thing. It's a different KIND of
// version too (a native build number, checked against the installed APK's
// user-agent tag, not a web bundle) which is why it stays a sibling field
// here rather than living inside `versions.deliveries`.
//
// Served fresh on purpose: a cached answer here would defeat the entire point.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return NextResponse.json(
    { versions: APP_VERSIONS, apk: LATEST_APK_VERSION_CODE, obligatoria: RECARGA_OBLIGATORIA },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
  );
}
