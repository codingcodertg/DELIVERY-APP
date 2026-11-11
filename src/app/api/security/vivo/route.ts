import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { construyeVivo, type UsoCrudoVivo, type DispCrudoVivo } from "@/lib/security/vivo-de-usuarios";
import { construyeUsoPorApp, type FilaUsoCrudo } from "@/lib/security/uso-por-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Quién está en vivo y en qué módulo», para el administrador de permisos (D-944/945). Solo el admin: la RLS de la 229
 * deja leer las tablas de seguridad únicamente a `security_is_admin()`, y aquí además se comprueba el rol para contestar
 * con un aviso en vez de con cero filas. El panel lo pide al abrirse, en vez de que cada página que lo monte tenga que
 * leer la base — así se puede colocar en Seguridad, en RR. HH. o donde sea con solo el perfil del admin.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data: perfil } = await auth.supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (perfil?.role !== "admin") return NextResponse.json({ error: "Only an admin." }, { status: 403 });

  const [{ data: usos }, { data: devices }, { data: porApp }] = await Promise.all([
    auth.supabase.from("security_device_users").select("user_id, device_id, last_seen_at, last_route").order("last_seen_at", { ascending: false }).limit(2000),
    auth.supabase.from("security_devices").select("id, user_agent, kind").limit(1000),
    // 289: el último uso por app, para el punto verde/gris de cada app. Si la 289 no está aplicada, la tabla no existe y
    // `porApp` viene null (se manda {}), así que el panel sigue sin romper.
    auth.supabase.from("app_last_seen").select("user_id, app, last_seen_at").limit(5000),
  ]);
  const vivo = construyeVivo((usos ?? []) as UsoCrudoVivo[], (devices ?? []) as DispCrudoVivo[]);
  const usoPorApp = construyeUsoPorApp((porApp ?? []) as FilaUsoCrudo[]);
  return NextResponse.json({ vivo, usoPorApp });
}
