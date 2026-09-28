import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUSINESS_TZ } from "@/lib/utils";
import { unavailableDriverNames } from "@/lib/dispatch";
import { choferesDelPlan, planificaElDia, resumenDelPlan, type FilaDePlan } from "@/lib/route-plan/borrador";
import { vistaDelPlan, type ParadaGuardada } from "@/lib/route-plan/vista";
import { aplicaMovimiento, estadoDeParadas, movimientoValido, revalida, type PlanGuardado } from "@/lib/route-plan/ajuste";
import type { NamedLocation } from "@/lib/types";
import type { PrioridadDeOrden } from "@/lib/route-engine";
import { porQueDelPlan } from "@/lib/route-plan/porque";
import { ETAPAS_RUTEABLES } from "@/lib/route-plan/publicar";
import { cacheEnSupabase, type ClienteDeCache } from "@/lib/route-times/cache-supabase";
import { proveedorEstimado, proveedorGoogle, proveedorOSRM, type FetchFn, type ProveedorDeTiempos } from "@/lib/route-times/proveedores";
import { COLUMNAS_DE_AJUSTES, COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER, entradaDelDia, leeConOpcionales, leeOrdenesDelDia, type DatosDelDia } from "@/lib/route-plan/entrada";
import { fotoDeLaCopia, type OrdenAhora } from "@/lib/route-plan/copia";
import type { EscrituraDeOrden } from "@/lib/route-plan/publicar";
import { rutasBloqueadasDelDia, type ClienteDeCandados } from "@/lib/rutas-bloqueadas";

// ============================================================
// «Planificar el día» (D-320): calcula un plan de ruta y lo deja en BORRADOR.
//
// No toca ninguna orden ni avisa a nadie: eso es publicar (`./publish`). Plan en
// `docs/PLAN-133-route-plans.md`.
//
// DOS CLIENTES, y cada uno para lo suyo:
//   · la SESIÓN de quien planifica lee las órdenes y guarda el plan — que valgan su RLS: ve lo que ve, y el
//     plan lo puede crear porque es admin o logística (133);
//   · la LLAVE DE SERVICIO solo toca la caché de tiempos de viaje, que ningún navegador lee ni escribe (132).
//
// Es la única ruta de la app que puede llamar a Google para el motor. El gasto lo frena el tope de
// `route-times` (por corrida y por día), y casi todo sale de la caché.
// ============================================================

export const runtime = "nodejs";
export const maxDuration = 60;

type Sesion = Extract<Awaited<ReturnType<typeof requireUser>>, { ok: true }>["supabase"];
type CandadosLeidos = Exclude<Awaited<ReturnType<typeof rutasBloqueadasDelDia>>, { fuente: "error" }>;

/**
 * Lo que se lee de la base para planificar un día, con la sesión de quien llama: las órdenes pendientes, Ajustes, los
 * choferes, sus ausencias, lo que escribió el publicado y los candados 🔒. Lo usa planificar (POST) y, desde D-NEXT, el
 * primer ajuste sobre un plan PUBLICADO, para saber qué órdenes siguen siendo las que ese plan conoció (`route-plan/copia`).
 * `extra`: columnas de la orden que hacen falta además de las del motor. Solo LEE.
 */
async function leeElDia(supabase: Sesion, fecha: string, extra = ""): Promise<{ ok: true; datos: DatosDelDia; candados: CandadosLeidos } | { ok: false; respuesta: NextResponse }> {
  const [ordenes, ajustes, choferes, deChofer, ausencias, publicado] = await Promise.all([
    // Con `priority` (147) si la base la tiene; si aún no, sin ella y todas normales (`leeOrdenesDelDia`).
    leeOrdenesDelDia((columnas) => supabase.from("deliveries").select(columnas).eq("delivery_date", fecha).in("stage", [...ETAPAS_RUTEABLES]), extra),
    // El catálogo de requisitos y lo que tiene cada camión (151, D-418), si la base ya los tiene; si no, sin ellos.
    leeConOpcionales((columnas) => supabase.from("settings").select(columnas).eq("id", 1).maybeSingle(), COLUMNAS_DE_AJUSTES, ["delivery_requirements"]),
    supabase.from("profiles").select("id, full_name, role").eq("role", "driver"),
    leeConOpcionales((columnas) => supabase.from("driver_settings").select(columnas), COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER),
    supabase.from("driver_availability").select("driver_id, start_date, end_date"),
    supabase.from("route_plans").select("writes").eq("plan_date", fecha).eq("status", "published").maybeSingle(),
  ]);
  const fallo = ordenes.error ?? ajustes.error ?? choferes.error ?? deChofer.error ?? ausencias.error ?? publicado.error;
  if (fallo || !ajustes.data) return { ok: false, respuesta: NextResponse.json({ error: "Could not read the day.", detail: fallo?.message ?? "no settings" }, { status: 500 }) };

  // Las rutas bloqueadas 🔒 de ese día (149, D-414): el motor no las toca. Sin la tabla, planifica como antes y lo dice;
  // con otro fallo, NO sigue: planificar sin saber qué está bloqueado movería rutas que alguien bloqueó.
  const candados = await rutasBloqueadasDelDia(supabase as unknown as ClienteDeCandados, fecha);
  if (candados.fuente === "error") return { ok: false, respuesta: NextResponse.json({ error: "Could not read the locked routes.", detail: candados.detalle }, { status: 500 }) };

  const nombrePorId = new Map((choferes.data ?? []).map((c) => [c.id as string, String(c.full_name ?? "")]));
  return {
    ok: true, candados,
    datos: {
      ordenes: (ordenes.data ?? []) as unknown as DatosDelDia["ordenes"],
      choferes: (choferes.data ?? []) as DatosDelDia["choferes"],
      ajustesDeChofer: (deChofer.data ?? []) as unknown as DatosDelDia["ajustesDeChofer"],
      settings: ajustes.data as unknown as DatosDelDia["settings"],
      publicadoAntes: ((publicado.data?.writes ?? []) as DatosDelDia["publicadoAntes"]) ?? [],
      noDisponibles: [...unavailableDriverNames((ausencias.data ?? []) as { driver_id: string; start_date: string; end_date: string }[], nombrePorId, fecha)],
      bloqueadas: candados.fuente === "base" ? candados.rutas : [],
    },
  };
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let fecha = "";
  try { fecha = String(((await req.json()) as { date?: unknown }).date ?? ""); } catch { /* cae en la validación */ }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: "A date (YYYY-MM-DD) is required." }, { status: 400 });

  // Quién planifica. La base lo vuelve a comprobar al guardar (133); esto es para decirlo claro y pronto.
  const { data: yo } = await supabase.from("profiles").select("role, visible_stores").eq("id", user.id).maybeSingle();
  if (!yo || !["admin", "logistics"].includes(String(yo.role))) return NextResponse.json({ error: "Only admin or logistics can plan routes." }, { status: 403 });

  const dia = await leeElDia(supabase, fecha);
  if (!dia.ok) return dia.respuesta;
  const candados = dia.candados;

  // Lo que alguien fijó a mano en el borrador vigente de esa fecha: planificar de nuevo lo respeta.
  const { data: borradorVigente } = await supabase.from("route_plans").select("id").eq("plan_date", fecha).eq("status", "draft").neq("source", "manual_import").order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: paradasFijadas } = borradorVigente
    ? await supabase.from("route_plan_stops").select("driver_id, seq, kind, order_ref, pinned").eq("plan_id", borradorVigente.id).eq("pinned", true)
    : { data: null };

  const datos: DatosDelDia = { ...dia.datos, fijadas: estadoDeParadas((paradasFijadas ?? []) as Parameters<typeof estadoDeParadas>[0]).secuencias };

  // Tiempos de viaje: Google si hay llave, y siempre los dos respaldos detrás.
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

  const borrador = await planificaElDia(datos, fecha, BUSINESS_TZ, { cache, proveedores, ahoraISO: new Date().toISOString() });

  // Guardar, con la sesión de quien planifica. Quien crea el plan puede leerlo, así que pedirlo de vuelta no
  // choca con ninguna política.
  const { data: fila, error: alGuardar } = await supabase.from("route_plans").insert(borrador.plan).select("id, version").maybeSingle();
  if (alGuardar || !fila) return NextResponse.json({ error: "Could not save the plan.", detail: alGuardar?.message }, { status: 500 });
  if (borrador.paradas.length) {
    const { error: alGuardarParadas } = await supabase.from("route_plan_stops").insert(borrador.paradas.map((p) => ({ ...p, plan_id: fila.id })));
    if (alGuardarParadas) {
      // Un plan sin sus paradas no sirve: se descarta, que es lo que la base deja hacer con un borrador.
      await supabase.from("route_plans").update({ status: "discarded" }).eq("id", fila.id);
      return NextResponse.json({ error: "Could not save the stops.", detail: alGuardarParadas.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true, plan_id: fila.id, version: fila.version,
    // A quien publica no se le marcan tiendas (131): no vería órdenes que tendría que escribir.
    warnTiendasMarcadas: Array.isArray(yo.visible_stores) && yo.visible_stores.length > 0,
    status: "draft",
    // «base»: el plan respetó los candados compartidos; «sin_tabla»: la 149 no está y el motor no los conoce.
    candados: candados.fuente,
    resumen: resumenDelPlan(borrador.plan, borrador.paradas.length, borrador.plan.input.entrada.ordenes),
    rutas: vistaDelPlan(borrador.paradas, borrador.plan.input.entrada.ordenes, borrador.plan.result.partes),
    choferes: choferesDelPlan(borrador.plan.input.entrada.choferes),
    porque: porQueDelPlan(borrador.plan.result, borrador.plan.input.entrada.choferes, borrador.paradas, borrador.plan.input.entrada.ordenes),
  });
}

// ------------------------------------------------------------
// GET ?date=YYYY-MM-DD — el plan vigente de esa fecha, para enseñarlo: el último borrador o publicado.
// Solo LEE, con la sesión de quien mira: qué planes ve cada rol lo decide la RLS de la 133 (almacén, solo
// lo publicado; chofer y ventas, nada). Quien no ve ninguno recibe `plan: null`, no un error.
// ------------------------------------------------------------
const COLUMNAS_DE_PARADA =
  "driver_id, driver_name, seq, kind, delivery_id, order_ref, label, place, window_start, window_end, is_hard, eta, etd, wait_min, service_min, late_min, load_after, leg_minutes, leg_miles, pinned";

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const fecha = new URL(req.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: "A date (YYYY-MM-DD) is required." }, { status: 400 });
  // `?status=published`: el plan PUBLICADO aunque haya un borrador más nuevo encima. Lo pide el Gestor para saber qué
  // etiquetas P/D llevan las rutas que ese plan escribió (`route-plan/lectura-de-ruta`). Sin él, el último que haya.
  const soloPublicado = new URL(req.url).searchParams.get("status") === "published";

  const { data: fila, error } = await supabase.from("route_plans")
    .select("id, version, status, published_at, writes, result, ordenes:input->entrada->ordenes, choferes:input->entrada->choferes, total_minutes, total_miles, late_minutes, provider, traffic, converged")
    .eq("plan_date", fecha).in("status", soloPublicado ? ["published"] : ["draft", "published"]).neq("source", "manual_import").order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not read the plan.", detail: error.message }, { status: 500 });
  if (!fila) return NextResponse.json({ ok: true, plan: null });

  const { data: paradas, error: alLeerParadas } = await supabase.from("route_plan_stops").select(COLUMNAS_DE_PARADA).eq("plan_id", fila.id);
  if (alLeerParadas) return NextResponse.json({ error: "Could not read the stops.", detail: alLeerParadas.message }, { status: 500 });

  const { data: yo } = await supabase.from("profiles").select("visible_stores").eq("id", user.id).maybeSingle();
  const plan = fila as unknown as FilaDePlan & { ordenes: { id: string; builder?: boolean; prioridad?: PrioridadDeOrden | null }[] | null; choferes: { id: string; nombre: string }[] | null; id: string; version: number; status: string; published_at: string | null };
  const filas = (paradas ?? []) as unknown as ParadaGuardada[];
  return NextResponse.json({
    ok: true,
    plan: {
      plan_id: plan.id, version: plan.version, status: plan.status, published_at: plan.published_at,
      warnTiendasMarcadas: Array.isArray(yo?.visible_stores) && yo.visible_stores.length > 0,
      resumen: resumenDelPlan(plan, filas.length, plan.ordenes),
      rutas: vistaDelPlan(filas, plan.ordenes ?? [], plan.result?.partes ?? {}),
      choferes: choferesDelPlan(plan.choferes),
      porque: porQueDelPlan(plan.result, plan.choferes, filas, plan.ordenes),
      copia: plan.result?.copiaDelPublicado ?? null,
    },
  });
}

// ------------------------------------------------------------
// PATCH { plan_id, movimiento } — ajustar a mano un BORRADOR: subir o bajar una parada, pasar una orden a otro
// chofer, fijarla o soltarla. Qué es un movimiento válido y cómo se revalida vive en `route-plan/ajuste`.
//
// El cliente manda el MOVIMIENTO, no las secuencias: el servidor parte de las paradas guardadas, así que nadie
// puede colar una ruta con órdenes de más o de menos.
//
// No llama a ningún proveedor de tiempos ni al motor de planificar: revalida con la matriz y el tráfico que el
// plan ya guardó. Y no pisa el plan: guarda uno NUEVO (`manual_edit`, hijo del anterior) y descarta el anterior
// solo cuando el nuevo está entero. Todo con la sesión de quien ajusta; la RLS y el guard de la 133 deciden.
//
// Desde D-NEXT también un PUBLICADO: el primer ajuste crea un BORRADOR NUEVO —copia del publicado, con el movimiento
// aplicado— y el publicado NO se toca: sigue siendo el vigente, con sus avisos ya dados, hasta que se publique la copia por
// el camino de siempre (`./publish`). La copia refresca su foto y aparta lo que ya no está pendiente (`route-plan/copia`).
// Si ya hay un borrador más nuevo de esa fecha, no se hace otra copia: 409, y la pantalla relee el vigente.
// ------------------------------------------------------------
export async function PATCH(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let cuerpo: { plan_id?: unknown; movimiento?: unknown } = {};
  try { cuerpo = (await req.json()) as typeof cuerpo; } catch { /* cae en la validación */ }
  const planId = String(cuerpo.plan_id ?? "");
  const movimiento = movimientoValido(cuerpo.movimiento);
  if (!/^[0-9a-f-]{36}$/i.test(planId) || !movimiento) return NextResponse.json({ error: "A plan_id and a valid move are required." }, { status: 400 });

  const { data: yo } = await supabase.from("profiles").select("role, visible_stores").eq("id", user.id).maybeSingle();
  if (!yo || !["admin", "logistics"].includes(String(yo.role))) return NextResponse.json({ error: "Only admin or logistics can adjust routes." }, { status: 403 });

  const { data: fila, error } = await supabase.from("route_plans")
    .select("id, status, source, version, plan_date, algorithm_version, params, input, result, provider, traffic, converged, writes").eq("id", planId).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not read the plan.", detail: error.message }, { status: 500 });
  if (!fila) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  if (!["draft", "published"].includes(String(fila.status)) || fila.source === "manual_import") return NextResponse.json({ error: "NOT_DRAFT" }, { status: 409 });
  const esPublicado = fila.status === "published";
  if (esPublicado) {
    const { data: encima } = await supabase.from("route_plans").select("id").eq("plan_date", fila.plan_date).eq("status", "draft").neq("source", "manual_import").gt("version", fila.version).limit(1).maybeSingle();
    if (encima) return NextResponse.json({ error: "DRAFT_EXISTS" }, { status: 409 });
  }

  const [paradas, ajustes] = await Promise.all([
    supabase.from("route_plan_stops").select("driver_id, seq, kind, order_ref, pinned").eq("plan_id", planId),
    supabase.from("settings").select("stores").eq("id", 1).maybeSingle(),
  ]);
  if (paradas.error || ajustes.error) return NextResponse.json({ error: "Could not read the stops.", detail: (paradas.error ?? ajustes.error)?.message }, { status: 500 });

  let guardado = fila as unknown as PlanGuardado;
  if (esPublicado) {
    // La copia: la foto con el `updated_at` de hoy de lo que sigue siendo del plan, y sin lo que ya no está pendiente.
    const dia = await leeElDia(supabase, String(fila.plan_date), ", route_seq, load_no");
    if (!dia.ok) return dia.respuesta;
    const fresca = entradaDelDia(dia.datos);
    const copia = fotoDeLaCopia({
      fotos: guardado.input.ordenes ?? [], guardadas: guardado.input.entrada?.ordenes ?? [], puntosGuardados: guardado.input.puntos ?? {},
      frescas: fresca.entrada.ordenes, puntosFrescos: fresca.puntos,
      ahora: dia.datos.ordenes as unknown as OrdenAhora[], escritas: (fila.writes ?? []) as EscrituraDeOrden[],
    });
    // `copia.fotos` ya viene sin lo que no está pendiente: así revalidar no lo escribe (`revalida` filtra por la foto).
    guardado = {
      ...guardado, input: { ...guardado.input, ordenes: copia.fotos },
      result: { ...guardado.result, copiaDelPublicado: { version: Number(fila.version), noSeReescriben: copia.noSeReescriben, cambiaron: copia.cambiaron } },
    };
  }
  const choferes = (guardado.input?.entrada?.choferes ?? []).map((c) => c.id);
  // Lo que ya no está pendiente no se mueve (D-NEXT). En un borrador del motor la lista está vacía.
  const noSeMueven = new Set(guardado.result?.copiaDelPublicado?.noSeReescriben ?? []);
  const estado = aplicaMovimiento(estadoDeParadas((paradas.data ?? []) as Parameters<typeof estadoDeParadas>[0]), movimiento, choferes, noSeMueven);
  if ("error" in estado) return NextResponse.json({ error: "BAD_MOVE", detail: estado.error }, { status: 400 });

  const ajustado = revalida(guardado, estado, planId, (ajustes.data?.stores ?? []) as NamedLocation[]);
  const { data: nueva, error: alGuardar } = await supabase.from("route_plans").insert(ajustado.plan).select("id, version").maybeSingle();
  if (alGuardar || !nueva) return NextResponse.json({ error: "Could not save the plan.", detail: alGuardar?.message }, { status: 500 });
  if (ajustado.paradas.length) {
    const { error: alGuardarParadas } = await supabase.from("route_plan_stops").insert(ajustado.paradas.map((p) => ({ ...p, plan_id: nueva.id })));
    if (alGuardarParadas) {
      await supabase.from("route_plans").update({ status: "discarded" }).eq("id", nueva.id);
      return NextResponse.json({ error: "Could not save the stops.", detail: alGuardarParadas.message }, { status: 500 });
    }
  }
  // El nuevo está entero: ahora sí, el anterior deja de ser el vigente. Si esto fallara quedan dos borradores y
  // manda el de versión más alta —el nuevo—, que es lo que `GET` enseña. Un PUBLICADO no se descarta: lo sustituye
  // publicar la copia, y hasta entonces es lo que tiene cada chofer (D-NEXT).
  if (!esPublicado) await supabase.from("route_plans").update({ status: "discarded" }).eq("id", planId);

  return NextResponse.json({
    ok: true, plan_id: nueva.id, version: nueva.version, status: "draft",
    warnTiendasMarcadas: Array.isArray(yo.visible_stores) && yo.visible_stores.length > 0,
    resumen: resumenDelPlan(ajustado.plan, ajustado.paradas.length, ajustado.plan.input.entrada.ordenes),
    rutas: vistaDelPlan(ajustado.paradas, ajustado.plan.input.entrada.ordenes, ajustado.plan.result.partes),
    choferes: choferesDelPlan(ajustado.plan.input.entrada.choferes),
    porque: porQueDelPlan(ajustado.plan.result, ajustado.plan.input.entrada.choferes, ajustado.paradas, ajustado.plan.input.entrada.ordenes),
    copia: ajustado.plan.result.copiaDelPublicado ?? null,
  });
}
