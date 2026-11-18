import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";

/**
 * La puerta de las rutas de comunicaciones de RingCentral: sesión + rol `admin` del hub (`profiles.role`), el mismo
 * criterio que `/api/invite`. Las grabaciones de la línea del dueño son sensibles, así que ni el gerente de RR. HH.
 * entra. Devuelve el cliente de la sesión (para que RLS de `recruiting.rc_comms`, que es solo admin, haga de segunda
 * puerta) o la respuesta lista para devolver: 401 sin sesión, 403 si no es admin, 503 si no se pudo comprobar.
 */
export async function requireAdminDeRc(): Promise<
  | { ok: true; supabase: Extract<Awaited<ReturnType<typeof requireUser>>, { ok: true }>["supabase"] }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const { data: yo, error } = await auth.supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (error) return { ok: false, response: NextResponse.json({ error: "Could not check your access." }, { status: 503 }) };
  if (yo?.role !== "admin") return { ok: false, response: NextResponse.json({ error: "Admin only." }, { status: 403 }) };
  return { ok: true, supabase: auth.supabase };
}
