import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================
// ¿Los choferes de ESTE plan han entrado alguna vez a la app? — para avisar ANTES de publicar.
//
// Publicar deja un aviso por chofer y su ruta en «Mi ruta». A quien nunca ha iniciado sesión no le llega ni lo
// uno ni lo otro, y nada lo decía (medido el 2026-09-18: tres de cuatro choferes). Esto es un AVISO: no impide
// publicar.
//
// La llave de servicio se usa para UNA cosa —`auth.users` no lo lee ninguna sesión—, con las mismas tres
// condiciones que en `../actuals`, las tres con prueba: el rol se comprueba ANTES de crear ese cliente; los ids
// salen SOLO de las paradas del plan indicado, y ese plan se lee con la SESIÓN de quien pregunta (si su RLS no
// se lo deja ver, 404 y no se pregunta por nadie); y de cada usuario sale un booleano — ni fecha, ni correo.
// Si la consulta de uno falla, es «no se sabe» (`null`), no «nunca».
//
// Solo lee. No escribe nada en ningún sitio.
// ============================================================

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let planId = "";
  try { planId = String(((await req.json()) as { plan_id?: unknown }).plan_id ?? ""); } catch { /* cae en la validación */ }
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return NextResponse.json({ error: "A plan_id is required." }, { status: 400 });

  const { data: yo } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!yo || !["admin", "logistics"].includes(String(yo.role))) return NextResponse.json({ error: "Only admin or logistics can ask this." }, { status: 403 });

  // Con la sesión: si quien pregunta no puede leer ese plan, para él no existe.
  const { data: plan, error } = await supabase.from("route_plans").select("id").eq("id", planId).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not read the plan.", detail: error.message }, { status: 500 });
  if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  const { data: paradas, error: alLeerParadas } = await supabase.from("route_plan_stops").select("driver_id, driver_name").eq("plan_id", plan.id);
  if (alLeerParadas) return NextResponse.json({ error: "Could not read the stops.", detail: alLeerParadas.message }, { status: 500 });
  const nombreDe = new Map<string, string>();
  for (const p of (paradas ?? []) as { driver_id: string | null; driver_name: string }[]) if (p.driver_id) nombreDe.set(p.driver_id, p.driver_name);

  const admin = createAdminClient();
  const choferes: { driver_id: string; nombre: string; ha_entrado: boolean | null }[] = [];
  for (const [id, nombre] of [...nombreDe].sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const { data, error: alPreguntar } = await admin.auth.admin.getUserById(id);
    choferes.push({ driver_id: id, nombre, ha_entrado: alPreguntar || !data?.user ? null : !!data.user.last_sign_in_at });
  }
  return NextResponse.json({ ok: true, plan_id: plan.id, choferes });
}
