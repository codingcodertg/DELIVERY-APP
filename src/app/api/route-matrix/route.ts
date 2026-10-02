import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cacheEnSupabase, type ClienteDeCache } from "@/lib/route-times/cache-supabase";
import { proveedorEstimado, proveedorGoogle, proveedorOSRM, type FetchFn, type ProveedorDeTiempos } from "@/lib/route-times/proveedores";
import { matrizDeUnaVez } from "@/lib/route-times/tiempos";
import { puntosDeLaPeticion } from "@/lib/optimizar-desde-el-gestor";

// ============================================================
// Los tiempos por calles entre los puntos de UNA ruta, para «🧭 Optimizar» del Gestor (D-461).
//
// El dueño, 2026-10-02: «sigamos trabajando en el alrgoritmo de optimizar ruta porque sigue muy mal ineficente». El primer
// Optimizar (D-456) medía en línea recta. Este da la misma matriz que usa «Armar rutas» —sin tráfico, de la caché compartida
// (`travel_time_cache`, 132) y, lo que falte, del proveedor—; el orden lo decide el navegador (`lib/optimiza-la-ruta`).
//
// CUÁNTO GASTA: como mucho UNA petición de matriz al proveedor por pulsación (`matrizDeUnaVez`), y ninguna si los tramos ya
// están guardados —lo normal en un día que pasó por «Armar rutas», que deja guardados todos los del día—. El freno es el
// mismo tope por corrida y por día de `route-times`; por encima, contesta OSRM (gratis) y, si tampoco, el estimado en línea
// recta. `proveedor` dice quién contestó lo peor, para que la pantalla lo diga.
//
// DOS CLIENTES, como `/api/route-plan`: la sesión de quien llama dice quién es; la llave de servicio solo toca la caché.
// No lee ni escribe ninguna orden.
// ============================================================

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let cuerpo: unknown = null;
  try { cuerpo = await req.json(); } catch { /* cae en la validación */ }
  const puntos = puntosDeLaPeticion(cuerpo);
  if (!puntos) return NextResponse.json({ error: "A list of points ({ lat, lng }) is required." }, { status: 400 });

  // Quién puede gastar: los mismos que planifican rutas. Antes de crear la llave de servicio.
  const { data: yo } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!yo || !["admin", "logistics"].includes(String(yo.role))) return NextResponse.json({ error: "Only admin or logistics can optimize routes." }, { status: 403 });

  const admin = createAdminClient();
  const llave = process.env.GOOGLE_MAPS_API_KEY;
  const proveedores: ProveedorDeTiempos[] = [...(llave ? [proveedorGoogle(llave, fetch as unknown as FetchFn)] : []), proveedorOSRM(fetch as unknown as FetchFn), proveedorEstimado()];
  const cache = cacheEnSupabase(admin as unknown as ClienteDeCache, {
    cuentaDePago: async (desdeISO, conTrafico) => {
      const { count } = await admin.from("travel_time_cache").select("origin_key", { count: "exact", head: true })
        .eq("provider", "google").eq("traffic", conTrafico).gte("fetched_at", desdeISO);
      return count ?? 0;
    },
  });

  const { matriz, informe } = await matrizDeUnaVez(puntos, { cache, proveedores, ahoraISO: new Date().toISOString() });
  return NextResponse.json({
    ok: true, tiempos: matriz, proveedor: informe.proveedor, deCache: informe.deCache, pedidos: informe.pedidos,
    llamadas: informe.llamadas, presupuestoAgotado: informe.presupuestoAgotado,
  });
}
