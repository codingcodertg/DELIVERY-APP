import { NextResponse } from "next/server";

// ============================================================
// Google Map Tiles proxy. Serves Google's 2D raster map tiles to the Leaflet
// maps in every view, keeping GOOGLE_MAPS_API_KEY server-side (the browser
// only ever hits this route, never Google directly).
//
// Requires the "Map Tiles API" enabled on the Google project. Until it is —
// or on any failure — we transparently fall back to free OpenStreetMap tiles,
// so the map always renders.
//
// Tiles are immutable per (session, z, x, y), so we cache hard at the CDN.
// ============================================================

export const runtime = "nodejs";

// Module-scoped session cache (a token is valid ~2 weeks; cheap to re-mint on
// a cold start). Guards against re-creating a session on every tile request.
let session: { token: string; expiresAt: number } | null = null;
let pending: Promise<string | null> | null = null;

async function getSession(key: string): Promise<string | null> {
  const now = Date.now();
  if (session && session.expiresAt > now + 60_000) return session.token;
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapType: "roadmap", language: "en-US", region: "US" }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.session) return null;
      const expiresAt = data.expiry ? Number(data.expiry) * 1000 : now + 12 * 3600 * 1000;
      session = { token: data.session as string, expiresAt };
      return session.token;
    } catch {
      return null;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

function osmTile(z: string, x: string, y: string) {
  // 302 to the free OSM tile — Leaflet/the browser follow it transparently.
  return NextResponse.redirect(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, 302);
}

export async function GET(_req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const p = await params;
  const z = p.z, x = p.x, y = p.y.replace(/\.png$/, "");
  if (!key) return osmTile(z, x, y);

  const token = await getSession(key);
  if (!token) return osmTile(z, x, y); // Map Tiles API not enabled / failed → OSM

  try {
    const url = `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${token}&key=${key}`;
    const tile = await fetch(url);
    if (!tile.ok) {
      if (tile.status === 401 || tile.status === 403) session = null; // stale session → re-mint next time
      return osmTile(z, x, y);
    }
    const buf = await tile.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": tile.headers.get("content-type") ?? "image/png",
        // Immutable per session/coords — cache hard so we don't re-bill on pans.
        "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
      },
    });
  } catch {
    return osmTile(z, x, y);
  }
}
