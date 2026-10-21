import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSSRClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { adminKey } from "@/lib/erp/supabase/admin";
import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";
import { impersonacionActiva } from "@/lib/impersonation-flag";
import { candidatosParaSaltar, esAdmin } from "@/lib/impersonation";

/**
 * Lo que la burbuja general necesita del servidor, en UNA ida (D-NEXT, 2026-10-21):
 *
 * - `adminReal`: la sesión es de un admin y NO está dentro de otra identidad (sin cookie de retorno). Solo entonces
 *   salen Cambiar usuario, Vista móvil y Modo enseñanza. El dueño: «la opción de Switch User, Mobile View y Teaching
 *   Mode solo para administradores».
 * - `habilitado`: además, la función de entrar como otro está encendida en este servidor (`IMPERSONATION_ENABLED`).
 * - `users` y `stores`: la lista para el panel, filtrada con la misma regla que `/api/impersonate` aplicará después
 *   (`puedeEntrarComo`: nunca otro admin). Vacía si no procede.
 *
 * Fuera de Entregas no hay `DataProvider` con `users` y `settings.stores`: por eso la lista se pide aquí, igual que
 * `switch/candidates` lo hace para el banner mientras se suplanta.
 */
export async function GET() {
  const nada = { adminReal: false, habilitado: false, users: [], stores: [] };
  const guardado = desempaquetar((await cookies()).get(COOKIE_RETORNO)?.value ?? null);
  if (guardado) return NextResponse.json(nada);
  const ssr = await createSSRClient();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return NextResponse.json(nada);
  const { data: perfil } = await ssr.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!esAdmin(perfil?.role)) return NextResponse.json(nada);
  const habilitado = impersonacionActiva();
  if (!habilitado) return NextResponse.json({ ...nada, adminReal: true });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, adminKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [{ data: perfiles, error }, { data: ajustes }] = await Promise.all([
    admin.from("profiles").select("id, full_name, role, store").order("full_name"),
    admin.from("settings").select("stores").eq("id", 1).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ ...nada, adminReal: true, habilitado: true });
  const users = candidatosParaSaltar({ id: user.id, rol: perfil?.role }, perfiles ?? []);
  return NextResponse.json({ adminReal: true, habilitado: true, users, stores: (ajustes?.stores ?? []) as { name: string }[] });
}
