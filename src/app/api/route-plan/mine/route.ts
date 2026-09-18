import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { misParadas, type ParadaMia } from "@/lib/route-plan/mis-paradas";

// ============================================================
// «Mis paradas» del plan publicado (D-NEXT): lo que el chofer lee de su ruta del día.
//
// Todo pasa por `my_published_stops` (migración 134), por `rpc` y con la SESIÓN de quien llama: la función
// filtra por `auth.uid()` dentro, así que aquí no hay parámetro de chofer ni forma de pedir las de otro. Esta
// ruta no lee `route_plans` ni `route_plan_stops` (el chofer no puede, y no debe), no usa la llave de servicio
// y no escribe nada.
//
// Si la 134 todavía no está aplicada, la función no existe (PGRST202): se contesta «sin plan», no un error. «Mi ruta»
// funciona igual sin esto — sale de las órdenes asignadas.
// ============================================================

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const fecha = new URL(req.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: "A date (YYYY-MM-DD) is required." }, { status: 400 });

  const { data, error } = await auth.supabase.rpc("my_published_stops", { p_date: fecha });
  // PGRST202 = PostgREST no encuentra la funcion: la 134 aun no esta. Cualquier OTRO error es un error, y se dice.
  if (error?.code === "PGRST202") return NextResponse.json({ ok: true, plan: null, sinFuncion: true });
  if (error) return NextResponse.json({ error: "Could not read your stops.", detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, plan: misParadas((data ?? []) as ParadaMia[]) });
}
