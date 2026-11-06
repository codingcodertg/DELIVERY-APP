import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/clockin/cronAuth";
import { BUSINESS_TZ } from "@/lib/utils";
import { fechaEnZona } from "@/lib/route-plan/llegadas";
import { configDeTracksolid } from "@/lib/tracksolid/api";
import { almacenEnSupabase, clienteDeServicioDeTracksolid } from "@/lib/tracksolid/almacen";
import { historialDeCamiones, historialEnSupabase } from "@/lib/tracksolid/historial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron diario: guarda el rastro de cada camión (D-NEXT, «Reportes de choferes»).
 *
 * TrackSolid borra el historial a los 3 meses. Los reportes ya guardan (264) cada día que alguien mira; esto guarda
 * también los que nadie miró: los últimos 7 días de cada rastreador enlazado, UNA llamada por camión (lo ya guardado y
 * completo no se vuelve a pedir, así que lo normal es una llamada que trae el día de ayer).
 *
 * Programada en vercel.json a las 09:30 UTC (de madrugada en Texas, con el día anterior ya cerrado). Los crons de este
 * proyecto son todos de un disparo al día, y es lo que hace falta aquí.
 *
 * - `cronAuthorized`: `Authorization: Bearer <CRON_SECRET>` (lo que manda Vercel Cron) o `?key=`.
 * - `?verify=1`: confirma el secreto sin leer ni escribir nada.
 * - Solo LEE de TrackSolid, y solo escribe en `truck_track_days`. Sin la 264 o sin las variables, no guarda nada.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (new URL(req.url).searchParams.get("verify") === "1") return NextResponse.json({ ok: true, verify: true });

  const config = configDeTracksolid();
  if (!config) return NextResponse.json({ ok: true, enabled: false });
  try {
    const db = clienteDeServicioDeTracksolid();
    const historial = historialEnSupabase(db);
    const hoy = fechaEnZona(new Date().toISOString(), BUSINESS_TZ);
    const fechas = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${hoy}T00:00:00Z`) - (i + 1) * 86_400_000).toISOString().slice(0, 10));
    // Sin la 264 no hay dónde guardar: no se le pregunta nada a TrackSolid.
    if ((await historial.lee(["0000000000"], fechas[6], fechas[0])) === null) return NextResponse.json({ ok: true, enabled: false, reason: "no table" });
    const { data, error } = await db.from("tracksolid_devices").select("imei");
    if (error) return NextResponse.json({ ok: true, enabled: false });
    const pedidos = ((data ?? []) as { imei: string }[]).flatMap((d) => fechas.map((fecha) => ({ imei: d.imei, fecha })));
    const h = await historialDeCamiones(
      { config, almacen: almacenEnSupabase(db), historial, fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }) },
      pedidos, { zona: BUSINESS_TZ, maxLlamadas: 20 },
    );
    return NextResponse.json({ ok: true, enabled: true, trucks: (data ?? []).length, days: h.dias.size, calls: h.llamadas, pending: h.pendientes });
  } catch (e) {
    console.warn("[cron truck-tracks] falló:", e instanceof Error ? e.name : "error");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
