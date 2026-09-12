import "server-only";

import { createClient } from "@supabase/supabase-js";
import { adminKey } from "@/lib/erp/supabase/admin";

/**
 * Cerrar en el servidor la sesión impersonada, y **solo esa** (D-NEXT).
 *
 * Lo que faltaba en D-243: al volver, `refreshSession` sustituye la sesión en el navegador del
 * admin, pero la del vendedor seguía viva en `auth.sessions` hasta caducar. Una sesión que nadie
 * está usando y que no se puede ver desde ninguna pantalla es exactamente la clase de cosa que
 * no debería sobrevivir a la acción que la creó.
 *
 * **El alcance es lo delicado, y se midió en `@supabase/auth-js` 2.112.4** (`SIGN_OUT_SCOPES =
 * ['global', 'local', 'others']`, y `admin.signOut(jwt, scope)` va a `POST /logout?scope=…` con
 * ese JWT):
 *
 *   · `global` cerraría **todas** las sesiones de esa persona — incluido su teléfono, que está
 *     repartiendo. Un admin mirando un bug echaría a alguien de la calle.
 *   · `others` hace justo lo contrario de lo que se quiere: cierra las suyas de verdad y deja
 *     viva la impersonada.
 *   · `local` cierra **la del JWT que se pasa**, que es la impersonada y ninguna más.
 *
 * Así que `local`, con el token de la sesión impersonada, tomado **antes** de restaurar al admin
 * — después ya no está.
 *
 * Y no bloquea la vuelta: si la revocación falla, el admin recupera igual su cuenta y queda una
 * sesión de más caducando sola. Al revés —negarse a devolverle su cuenta porque no se pudo
 * cerrar la otra— sería dejarlo dentro de una identidad ajena, que es lo único que esta
 * decisión no permite.
 */
export async function revocarSesionImpersonada(accessToken: string | null | undefined): Promise<boolean> {
  const jwt = (accessToken ?? "").trim();
  if (!jwt) return false;
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, adminKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await admin.auth.admin.signOut(jwt, "local");
    if (error) {
      console.error("[impersonation] no se pudo cerrar la sesión impersonada:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[impersonation] no se pudo cerrar la sesión impersonada:", e);
    return false;
  }
}
