import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/clockin/cronAuth";
import { pruneDriverLocations, PRUNE_KEEP_DAYS, PRUNE_KEEP_DAYS_MIN } from "@/lib/driver-locations-prune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron: poda de `driver_locations` (G-23, D-200).
 *
 * Mismo patrón que `clock-in/api/cron` y `close-orphan-sessions`: `cronAuthorized` (Bearer
 * CRON_SECRET o `?key=`) y `?verify=1`, que confirma el secreto con 200 SIN borrar nada. Va con
 * la clave de servicio, nunca con el cliente de un usuario.
 *
 * Programación: Vercel Hobby tiene sus dos crons ocupados, así que esta ruta NO está en
 * vercel.json: la llama `roll-schedules` al final de su pasada diaria (08:00 UTC, mismo
 * secreto), igual que el cierre de huérfanas de D-195. Queda como entrada propia para correrla
 * a mano. `?keep_days=` permite un valor distinto del defecto (90), nunca menor que 1.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  if (url.searchParams.get("verify") === "1") {
    return NextResponse.json({ ok: true, verify: true, keepDays: PRUNE_KEEP_DAYS });
  }
  // Suelo de 30 días (observación del auditor): un `keep_days` menor no se rebaja en silencio,
  // se rechaza con 400, para que un secreto filtrado no pueda vaciar la tabla.
  const param = url.searchParams.get("keep_days");
  const raw = Number(param);
  if (param !== null && (!Number.isFinite(raw) || raw < PRUNE_KEEP_DAYS_MIN)) {
    return NextResponse.json({ error: `keep_days must be >= ${PRUNE_KEEP_DAYS_MIN}` }, { status: 400 });
  }
  const keepDays = param !== null ? raw : PRUNE_KEEP_DAYS;
  const out = await pruneDriverLocations({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    keepDays,
  });
  return NextResponse.json(out, { status: out.ok ? 200 : 502 });
}
