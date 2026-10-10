import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoAEntregas } from "@/lib/constants";
import type { UserRole } from "@/lib/types";

/**
 * La puerta de las rutas API (D-172, hallazgo A-4 de la auditoría).
 *
 * Diez rutas no la tenían: `/api/notify`, `/api/call`, `/api/help` y los siete proxies de
 * mapas. Y el middleware **salta `/api/`** a propósito (`lib/route-guard.ts`, `skipsSession`, para
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
  | { ok: true; user: { id: string; email?: string; user_metadata?: Record<string, unknown> }; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  // `user_metadata` viaja para quien lo necesita: la marca de «cambia tu contraseña» (D-486).
  return { ok: true, user: { id: user.id, email: user.email ?? undefined, user_metadata: user.user_metadata }, supabase };
}

/**
 * La misma puerta, más el módulo de ENTREGAS — para las rutas que gastan dinero fuera (D-NEXT).
 *
 * `requireUser` dice «has entrado» y deja el rol a cada ruta (ver arriba). Dos rutas no lo
 * decidieron nunca: `/api/notify` manda SMS y correos de verdad por RingCentral/Resend, y
 * `/api/call` llama por teléfono — las dos valían para **cualquier** sesión, incluida una que solo
 * tuviera el módulo de fichaje y nada que hacer en Entregas (hallazgo S-5 de la auditoría del
 * 2026-10-09). Era además la única superficie de la app que, llamada a mano, rompía por diseño la
 * regla permanente del proyecto de no provocar efectos en terceros.
 *
 * El corte es el módulo, no el rol: `tieneAccesoAEntregas` es el espejo en el cliente de
 * `has_deliveries_access()` (083) — admin siempre, y el resto solo con 'deliveries' concedido.
 * No se añade lista de roles porque dentro de Entregas **todos** los roles tienen hoy un botón
 * real que llega a estas rutas (el chofer llama al cliente desde su ficha, y crear una orden
 * manda el SMS de seguimiento). Una lista sería «todos menos almacén», y a un almacenista con el
 * permiso `create` concedido le rompería el SMS que su propia orden dispara.
 *
 * Un fallo al LEER el perfil contesta 503, no 403: no se concede nada, pero tampoco se le dice a
 * nadie que no tiene permiso cuando lo que pasó es que no se pudo comprobar. Es el mismo criterio
 * que la geocerca de D-NEXT, en el otro extremo de la app.
 */
export async function requireDeliveries(): Promise<
  | (Extract<Awaited<ReturnType<typeof requireUser>>, { ok: true }> & { role: UserRole })
  | { ok: false; response: NextResponse }
> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const { data: yo, error } = await auth.supabase
    .from("profiles")
    .select("role, module_access")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error) {
    return { ok: false, response: NextResponse.json({ error: "Could not check your access." }, { status: 503 }) };
  }
  if (!yo || !tieneAccesoAEntregas({ role: yo.role as UserRole, module_access: yo.module_access as string[] | null })) {
    return { ok: false, response: NextResponse.json({ error: "Deliveries access is required." }, { status: 403 }) };
  }
  return { ...auth, role: yo.role as UserRole };
}
