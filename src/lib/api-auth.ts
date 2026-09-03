import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * La puerta de las rutas API (D-172, hallazgo A-4 de la auditoría).
 *
 * Diez rutas no la tenían: `/api/notify`, `/api/call`, `/api/help` y los siete proxies de
 * mapas. Y el middleware **salta `/api/`** a propósito (`lib/supabase/middleware.ts:39`, para
 * no redirigir a login una llamada de datos), así que no había nada entre internet y ellas.
 * Medido en la auditoría: cualquiera, sin sesión, podía mandar SMS y hacer llamadas desde
 * el número de la empresa, o quemar la cuota de Google.
 *
 * Es exactamente la comprobación que ya hacían `push`, `invite`, `delete-user`,
 * `reset-password` y `user-identity`, sacada a un sitio para que la próxima ruta no tenga
 * que recordarla. Devuelve el usuario o la respuesta 401 lista para devolver.
 *
 * No mira el rol: eso lo decide cada ruta. Lo único que dice es "has entrado".
 */
export async function requireUser(): Promise<
  | { ok: true; user: { id: string; email?: string }; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  return { ok: true, user: { id: user.id, email: user.email ?? undefined }, supabase };
}
