import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUSINESS_TZ } from "@/lib/utils";
import { unavailableDriverNames } from "@/lib/dispatch";
import { COLUMNAS_DE_AJUSTES, COLUMNAS_DE_CHOFER, leeConOpcionales, leeOrdenesDelDia } from "@/lib/route-plan/entrada";
import { ETAPAS_RUTEABLES } from "@/lib/route-plan/publicar";
import { cacheSoloLectura, repartoDelDia, type DiaParaElReparto } from "@/lib/route-plan/reparto";
import { cacheEnSupabase, type ClienteDeCache } from "@/lib/route-times/cache-supabase";
import { proveedorEstimado, proveedorOSRM, type FetchFn } from "@/lib/route-times/proveedores";
import { rutasBloqueadasDelDia, type ClienteDeCandados } from "@/lib/rutas-bloqueadas";

// ============================================================
// «✨ Auto-asignar» con el motor (D-419): la hermana de `/api/route-plan` en «modo reparto».
//
// POST { date, order_ids, drivers } → qué escribir en cada orden (chofer, viaje y puesto), qué no se colocó y por
// qué, y qué choferes elegidos quedaron fuera. **No escribe nada**: ni órdenes ni planes. Escribe quien llama, orden
// a orden, con su sesión y «solo si no cambió desde que se planificó» (`updated_at`).
//
// Qué decide y qué no vive en `lib/route-plan/reparto.ts`. Aquí solo se lee el día con la sesión de quien reparte
// (vale su RLS) y se le pasa al motor.
//
// TIEMPOS DE VIAJE, Y CUÁNTO CUESTAN: la caché que ya llenó «Planificar el día» (solo LEER, con la llave de servicio,
// como allí), y lo que falte, OSRM y la estimación en línea recta. **Sin Google y sin tráfico**: Auto-asignar no hace
// ninguna llamada de pago. Un día de 47 órdenes son ~52 puntos (~2.650 pares); con Google delante, cada clic podría
// pedir cientos de elementos. El tope por corrida (400) lo frenaría, pero el gasto diario subiría por algo que se
// pulsa varias veces al día. Lo que ya pagó «Planificar el día» se reutiliza igual.
// ============================================================

export const runtime = "nodejs";
export const maxDuration = 60;

/** Lo que el reparto necesita además de lo de «Planificar el día»: el día, y dónde va hoy cada orden en su ruta. */
const COLUMNAS_EXTRA = "delivery_date, route_seq, load_no, order_no, morning_priority";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let cuerpo: { date?: unknown; order_ids?: unknown; drivers?: unknown } = {};
  try { cuerpo = (await req.json()) as typeof cuerpo; } catch { /* cae en la validación */ }
  const fecha = String(cuerpo.date ?? "");
  const ordenes = Array.isArray(cuerpo.order_ids) ? cuerpo.order_ids.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 500) : [];
  const choferes = Array.isArray(cuerpo.drivers) ? cuerpo.drivers.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 100) : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !ordenes.length || !choferes.length) {
    return NextResponse.json({ error: "A date (YYYY-MM-DD), order_ids and drivers are required." }, { status: 400 });
  }

  // Quién reparte: los que asignan desde el Gestor y el mapa. La base lo vuelve a decidir al escribir (RLS y guard).
  const { data: yo } = await supabase.from("profiles").select("role, visible_stores").eq("id", user.id).maybeSingle();
  if (!yo || !["admin", "logistics", "manager"].includes(String(yo.role))) return NextResponse.json({ error: "Only admin, logistics or manager can auto-assign." }, { status: 403 });

  const [filas, ajustes, perfiles, deChofer, ausencias] = await Promise.all([
    leeOrdenesDelDia((columnas) => supabase.from("deliveries").select(`${columnas}, ${COLUMNAS_EXTRA}`).eq("delivery_date", fecha).in("stage", [...ETAPAS_RUTEABLES, "picked_up", "delivered", "canceled"])),
    // Como «Planificar el día»: el catálogo de requisitos y lo que tiene cada camión (151, D-418), si la base ya los tiene.
    leeConOpcionales((columnas) => supabase.from("settings").select(columnas).eq("id", 1).maybeSingle(), COLUMNAS_DE_AJUSTES, ["delivery_requirements"]),
    supabase.from("profiles").select("id, full_name, role").eq("role", "driver"),
    leeConOpcionales((columnas) => supabase.from("driver_settings").select(columnas), COLUMNAS_DE_CHOFER, ["features"]),
    supabase.from("driver_availability").select("driver_id, start_date, end_date"),
  ]);
  const fallo = filas.error ?? ajustes.error ?? perfiles.error ?? deChofer.error ?? ausencias.error;
  if (fallo || !ajustes.data) return NextResponse.json({ error: "Could not read the day.", detail: fallo?.message ?? "no settings" }, { status: 500 });

  // 🔒 (149, D-414). Como en «Planificar el día»: sin la tabla, sigue y lo dice; con otro fallo, NO reparte.
  const candados = await rutasBloqueadasDelDia(supabase as unknown as ClienteDeCandados, fecha);
  if (candados.fuente === "error") return NextResponse.json({ error: "Could not read the locked routes.", detail: candados.detalle }, { status: 500 });

  const nombrePorId = new Map((perfiles.data ?? []).map((c) => [c.id as string, String(c.full_name ?? "")]));
  const dia: DiaParaElReparto = {
    ordenes: (filas.data ?? []) as unknown as DiaParaElReparto["ordenes"],
    choferes: (perfiles.data ?? []) as DiaParaElReparto["choferes"],
    ajustesDeChofer: (deChofer.data ?? []) as unknown as DiaParaElReparto["ajustesDeChofer"],
    settings: ajustes.data as unknown as DiaParaElReparto["settings"],
    noDisponibles: [...unavailableDriverNames((ausencias.data ?? []) as { driver_id: string; start_date: string; end_date: string }[], nombrePorId, fecha)],
    bloqueadas: candados.fuente === "base" ? candados.rutas : [],
  };

  const admin = createAdminClient();
  const cache = cacheSoloLectura(cacheEnSupabase(admin as unknown as ClienteDeCache, { cuentaDePago: async () => 0 }));
  const respuesta = await repartoDelDia(dia, { fecha, ordenes, choferes }, BUSINESS_TZ, {
    cache, proveedores: [proveedorOSRM(fetch as unknown as FetchFn), proveedorEstimado()], ahoraISO: new Date().toISOString(),
  });

  return NextResponse.json({
    ok: true, ...respuesta, candados: candados.fuente,
    // Con tiendas marcadas (131) no ve todas las órdenes: lo que ya llevan los choferes puede estar incompleto.
    warnTiendasMarcadas: Array.isArray(yo.visible_stores) && yo.visible_stores.length > 0,
  });
}
