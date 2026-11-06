import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { configDeTracksolid } from "@/lib/tracksolid/api";
import { almacenEnSupabase, AlmacenNoDisponible, clienteDeServicioDeTracksolid } from "@/lib/tracksolid/almacen";
import { puedeVerCamiones } from "@/lib/tracksolid/camiones";
import { posicionesDeCamiones } from "@/lib/tracksolid/posiciones";
import { conEnlaces, leeEnlaces } from "@/lib/tracksolid/servicio";
import type { UserRole } from "@/lib/types";

// ============================================================
// GET /api/tracksolid/trucks — dónde están los camiones de la empresa, por su rastreador GPS (D-NEXT).
//
// Quién: los que ven la vista de planificación del Gestor de Rutas (`puedeVerCamiones`: Entregas + `route_plan`).
// Qué NO sale nunca de aquí: las llaves de TrackSolid ni el token. Solo posiciones.
//
// `enabled: false` es «esta instalación no tiene TrackSolid» (faltan variables, o la base aún no tiene la 257):
// la pantalla esconde la capa sin decir nada. No es un error, y por eso contesta 200.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data: yo, error } = await auth.supabase.from("profiles").select("role, permissions, module_access").eq("id", auth.user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not check your access." }, { status: 503 });
  if (!yo || !puedeVerCamiones({ role: yo.role as UserRole, permissions: yo.permissions as string[] | null, module_access: yo.module_access as string[] | null })) {
    return NextResponse.json({ error: "Route planning access is required." }, { status: 403 });
  }

  const config = configDeTracksolid();
  if (!config) return NextResponse.json({ enabled: false }, { headers: SIN_CACHE });

  try {
    const db = clienteDeServicioDeTracksolid();
    const [lectura, enlaces] = await Promise.all([
      posicionesDeCamiones({ config, almacen: almacenEnSupabase(db), fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }) }),
      leeEnlaces(db),
    ]);
    if (!lectura) return NextResponse.json({ enabled: true, trucks: [], fetchedAt: null, delayed: true }, { headers: SIN_CACHE });
    return NextResponse.json({
      enabled: true,
      trucks: conEnlaces(lectura.camiones, enlaces.enlaces, enlaces.nombres),
      fetchedAt: new Date(lectura.leidoEn).toISOString(),
      delayed: lectura.atrasado,
    }, { headers: SIN_CACHE });
  } catch (e) {
    // Sin la 257 (o sin llave de servicio) no hay dónde guardar el token, y sin guardarlo no se pide: se esconde.
    if (e instanceof AlmacenNoDisponible) return NextResponse.json({ enabled: false }, { headers: SIN_CACHE });
    console.warn("[tracksolid] /trucks falló:", e instanceof Error ? e.name : "error");
    return NextResponse.json({ enabled: true, trucks: [], fetchedAt: null, delayed: true }, { headers: SIN_CACHE });
  }
}
