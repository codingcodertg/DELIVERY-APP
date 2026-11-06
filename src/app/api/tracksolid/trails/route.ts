import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { tieneAccesoAEntregas } from "@/lib/constants";
import { configDeTracksolid } from "@/lib/tracksolid/api";
import { almacenEnSupabase, AlmacenNoDisponible, clienteDeServicioDeTracksolid } from "@/lib/tracksolid/almacen";
import { fechaValida, puedeVerPosicionDeChoferes } from "@/lib/tracksolid/camion-del-dia";
import { historialEnSupabase } from "@/lib/tracksolid/historial";
import { rastrosDelDia } from "@/lib/tracksolid/rastro-en-mapa-servicio";
import { BUSINESS_TZ, retentionFloorISO, seesAllHistory, todayISO } from "@/lib/utils";
import type { UserRole } from "@/lib/types";

// ============================================================
// GET /api/tracksolid/trails?date=YYYY-MM-DD — por dónde anduvo ese día el camión de cada chofer (D-909).
//
// Es la LÍNEA del mapa en vivo (el Recorrido y el Gestor de Rutas) para los choferes que llevan un camión con
// rastreador: el rastro del camión, entero, en vez del del teléfono (que calla cuando el chofer cierra la app).
//
// Quién: los mismos que ya leen dónde está el camión de cada chofer en ese mapa (`/api/tracksolid/assignments?live=1`,
// D-903) y la posición de su teléfono (`driver_locations`): con el módulo de Entregas, admin, logística, gerencia y
// almacén ven a todos; el chofer, solo lo suyo; cualquier otro, 403. Quien no ve todo el historial (D-239) no pasa de
// su ventana de fechas, igual que en la pantalla.
// Qué NO sale nunca de aquí: las llaves de TrackSolid, el token ni la llave de servicio. Solo puntos.
//
// `enabled: false` es «esta instalación no tiene TrackSolid»: la pantalla dibuja el teléfono y no pregunta más.
// Si el rastro no se puede leer ahora, `trails` llega sin ese camión (o vacío, con `delayed`), y la pantalla se queda
// con lo que tenía o con el teléfono: el mapa no se rompe.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data: yo, error } = await auth.supabase.from("profiles").select("role, permissions, module_access").eq("id", auth.user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not check your access." }, { status: 503 });
  const perfil = yo ? { role: yo.role as UserRole, permissions: yo.permissions as string[] | null, module_access: yo.module_access as string[] | null } : null;
  if (!perfil || !tieneAccesoAEntregas(perfil)) return NextResponse.json({ error: "Deliveries access is required." }, { status: 403 });
  const veATodos = puedeVerPosicionDeChoferes(perfil.role), esChofer = perfil.role === "driver";
  if (!veATodos && !esChofer) return NextResponse.json({ error: "You cannot see where the drivers are." }, { status: 403 });

  const fecha = new URL(request.url).searchParams.get("date");
  if (!fechaValida(fecha)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  if (!seesAllHistory(perfil.role, perfil.permissions) && fecha < retentionFloorISO()) return NextResponse.json({ error: "That day is outside your history window." }, { status: 403 });

  const config = configDeTracksolid();
  if (!config) return NextResponse.json({ enabled: false }, { headers: SIN_CACHE });
  // Un día que aún no llega no tiene rastro: ni se pregunta.
  if (fecha > todayISO()) return NextResponse.json({ enabled: true, date: fecha, trails: [], delayed: false }, { headers: SIN_CACHE });

  try {
    const db = clienteDeServicioDeTracksolid();
    const { rastros, pendientes } = await rastrosDelDia({
      db, config, almacen: almacenEnSupabase(db), historial: historialEnSupabase(db), zona: BUSINESS_TZ,
      fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }),
    }, fecha);
    return NextResponse.json({
      enabled: true, date: fecha,
      trails: veATodos ? rastros : rastros.filter((r) => r.driverId === auth.user.id),
      delayed: pendientes > 0,
    }, { headers: SIN_CACHE });
  } catch (e) {
    if (e instanceof AlmacenNoDisponible) return NextResponse.json({ enabled: false }, { headers: SIN_CACHE });
    console.warn("[tracksolid] /trails falló:", e instanceof Error ? e.name : "error");
    return NextResponse.json({ enabled: true, date: fecha, trails: [], delayed: true }, { headers: SIN_CACHE });
  }
}
