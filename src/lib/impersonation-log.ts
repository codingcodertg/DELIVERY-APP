import "server-only";

import { createClient } from "@supabase/supabase-js";
import { adminKey } from "@/lib/erp/supabase/admin";
import type { SecurityKind } from "@/lib/security-log";

/**
 * El rastro de «entrar como», que **sí** puede fallar (D-NEXT).
 *
 * Existe al lado de `logSecurity` y no dentro, porque su contrato es el contrario, y esa
 * diferencia es una decisión y no una duplicación:
 *
 *   · `logSecurity` **nunca lanza**, a propósito y bien: *«una línea que falta es un problema
 *     más pequeño que un cambio a medio aplicar»*. Para un restablecimiento de contraseña que ya
 *     ocurrió, eso es correcto.
 *   · Aquí no. **Sin fila no hay sesión.** Una impersonación sin rastro es exactamente lo que no
 *     se puede crear: la sesión todavía no existe cuando se escribe la fila, así que no hay nada
 *     a medio aplicar que proteger — solo hay que no empezar.
 *
 * Por eso devuelve si entró, y quien llama aborta.
 *
 * **Y usa `adminKey()`, no `SUPABASE_SERVICE_ROLE_KEY` a pelo.** Las llaves antiguas con forma
 * de JWT están deshabilitadas en este proyecto y responden 401 (lo dice el cliente del ERP, que
 * ya se lo comió): `adminKey()` prefiere `SUPABASE_SECRET_KEY` y deja la vieja como respaldo.
 * `src/lib/supabase/admin.ts` todavía lee la vieja directamente, y como `logSecurity` se traga
 * los errores, un 401 ahí no se vería. Queda anotado en la entrada; arreglarlo es otra rama.
 */
function clientePublico() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, adminKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Escribe una fila del rastro. Devuelve `true` solo si la base la aceptó.
 *
 * No se traga el error: lo devuelve como `false` y lo deja en el log del servidor, porque quien
 * llama tiene que poder decidir con eso.
 */
export async function apuntarImpersonacion(args: {
  actorId: string | null;
  targetId: string | null;
  targetName: string | null;
  kind: Extract<SecurityKind, "impersonation_start" | "impersonation_end">;
  detail?: string | null;
}): Promise<boolean> {
  try {
    const { error } = await clientePublico().from("security_events").insert({
      actor_id: args.actorId,
      target_id: args.targetId,
      target_name: args.targetName,
      kind: args.kind,
      detail: args.detail ?? null,
    });
    if (error) {
      console.error("[impersonation] no se pudo escribir el rastro:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[impersonation] no se pudo escribir el rastro:", e);
    return false;
  }
}
