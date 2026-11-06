import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { tieneAccesoAEntregas } from "@/lib/constants";
import { fechaValida, puedeVerPosicionDeChoferes } from "@/lib/tracksolid/camion-del-dia";
import { REFRESCO_DEL_RASTRO_MS } from "@/lib/tracksolid/rastro-en-mapa-servicio";
import { cargaDias, esErrorDeCarga } from "@/lib/reportes-choferes/carga";
import { apegoDelDia, type ApegoDelChofer } from "@/lib/apego-a-la-ruta/apego";
import { BUSINESS_TZ, retentionFloorISO, seesAllHistory, todayISO } from "@/lib/utils";
import type { Profile, UserRole } from "@/lib/types";

// ============================================================
// GET /api/route-adherence?date=YYYY-MM-DD — «Plan contra real» del Recorrido (D-NEXT).
//
// Por cada chofer con ruta programada ese día: su apego al orden y al camino, las paradas del plan con lo que se vio
// de cada una, y las millas y el tiempo planeados contra los reales. Se calcula con el MISMO motor que «Reportes de
// choferes» (`reportes-choferes/carga.ts` → `informeDelDia`, D-907) y se lee con `apego-a-la-ruta/apego.ts`: el
// Recorrido y el reporte dan los mismos números del mismo día.
//
// Quién: los mismos que leen la línea del camión en ese mapa (`/api/tracksolid/trails`, D-909): con el módulo de
// Entregas, admin, logística, gerencia y almacén ven a todos; el chofer, solo lo suyo; cualquier otro, 403. Quien no ve
// todo el historial (D-239) no pasa de su ventana de fechas. Las órdenes no se acotan por tienda (el mapa enseña a todos los
// choferes del día); la RLS de órdenes sigue mandando.
//
// Con qué se lee y qué escribe: lo dice `carga.ts`. De aquí no sale ningún punto del rastro ni ninguna llave: solo
// números, códigos de orden y las coordenadas de las paradas del plan (que la pantalla ya tiene en sus órdenes).
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data: yo, error } = await auth.supabase.from("profiles").select("role, store, permissions, module_access").eq("id", auth.user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not check your access." }, { status: 503 });
  const perfil = yo ? { role: yo.role as UserRole, store: yo.store as string | null, permissions: yo.permissions as string[] | null, module_access: yo.module_access as string[] | null } : null;
  if (!perfil || !tieneAccesoAEntregas(perfil)) return NextResponse.json({ error: "Deliveries access is required." }, { status: 403 });
  const veATodos = puedeVerPosicionDeChoferes(perfil.role), esChofer = perfil.role === "driver";
  if (!veATodos && !esChofer) return NextResponse.json({ error: "You cannot see where the drivers are." }, { status: 403 });

  const fecha = new URL(request.url).searchParams.get("date");
  if (!fechaValida(fecha)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  if (!seesAllHistory(perfil.role, perfil.permissions) && fecha < retentionFloorISO()) return NextResponse.json({ error: "That day is outside your history window." }, { status: 403 });

  const hoy = todayISO();
  if (fecha > hoy) return NextResponse.json({ date: fecha, drivers: [], live: false }, { headers: SIN_CACHE });

  const cargado = await cargaDias({
    supabase: auth.supabase, yo: perfil as Pick<Profile, "role" | "store" | "permissions">, desde: fecha, hasta: fecha,
    // Como el mapa: quien ve a los choferes los ve a todos (el chofer, solo a sí mismo); la RLS de órdenes sigue mandando.
    choferId: esChofer ? auth.user.id : null, todasLasTiendas: true,
    // El mapa en vivo: el rastro de hoy se vuelve a pedir como mucho cada 3 minutos (la misma copia que `/trails`).
    rastro: { refrescoDeHoyMs: REFRESCO_DEL_RASTRO_MS, aceptaViejo: true },
  });
  if (esErrorDeCarga(cargado)) {
    // Un chofer sin órdenes ese día no es un error: simplemente no tiene plan.
    if (cargado.status === 404 && esChofer) return NextResponse.json({ date: fecha, drivers: [], live: fecha === hoy }, { headers: SIN_CACHE });
    return NextResponse.json({ error: cargado.error, detail: cargado.detail }, { status: cargado.status });
  }

  const ahora = Date.now();
  const drivers: ApegoDelChofer[] = cargado.dias.flatMap((d) => {
    if (!d.informe.choferId || d.informe.fecha !== fecha) return [];
    if (esChofer && d.informe.choferId !== auth.user.id) return [];
    return [{ driverId: d.informe.choferId, chofer: d.informe.chofer, fecha, ...apegoDelDia(d.informe, d.rastro, { ahora, esHoy: fecha === hoy }) }];
  });

  return NextResponse.json({ date: fecha, zone: BUSINESS_TZ, live: fecha === hoy, drivers, warnings: cargado.avisos }, { headers: SIN_CACHE });
}
