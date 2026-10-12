import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { adminKey } from "@/lib/erp/supabase/admin";
import { COOKIE_RETORNO } from "@/lib/impersonation-cookie";
import { RASTRO_DE_SUPLANTACION, leerSuplantacion, type PruebaDeSuplantacion } from "@/lib/vista-movil-acceso";

/**
 * Lo que la vista móvil lee en el servidor (D-278, D-516). La regla está en `vista-movil-acceso.ts`,
 * probada con datos; aquí solo se le da Supabase.
 */

/**
 * La sesión y su perfil. Con `cache` porque lo piden el layout (la puerta) y la página (la pantalla de
 * inicio del rol, para el marco sin ruta): una sola lectura por petición.
 */
export const perfilDeLaVistaMovil = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, perfil: null, errorPerfil: null } as const;
  const { data: perfil, error: errorPerfil } = await supabase
    .from("profiles")
    .select("role, module_access")
    .eq("id", user.id)
    .maybeSingle();
  return { user, perfil, errorPerfil } as const;
});

/**
 * La suplantación en curso, si la hay y es de esta sesión. **Con la llave de servicio**, por dos motivos:
 * el rastro (`security_events`) solo lo puede leer un admin, y la sesión aquí es la de la otra persona; y
 * así la lectura no depende de lo que algún día se cierre de la RLS de `profiles` (A-2g).
 *
 * Solo se llama cuando la sesión NO es de un admin, y `leerSuplantacion` no pregunta nada a la base si no
 * hay cookie de vuelta para este usuario.
 */
export async function suplantacionEnCurso(usuarioId: string): Promise<PruebaDeSuplantacion | null> {
  const galletas = await cookies();
  const servicio = () =>
    createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, adminKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  return leerSuplantacion({
    cookie: galletas.get(COOKIE_RETORNO)?.value,
    usuarioId,
    rolDe: async (id) => {
      const { data, error } = await servicio().from("profiles").select("role").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data?.role as string | undefined) ?? null;
    },
    ultimoRastro: async (adminId, uid) => {
      const { data, error } = await servicio()
        .from("security_events")
        .select("kind, created_at")
        .eq("actor_id", adminId)
        .eq("target_id", uid)
        .in("kind", [...RASTRO_DE_SUPLANTACION])
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as { kind: string; created_at: string } | undefined) ?? null;
    },
  });
}
