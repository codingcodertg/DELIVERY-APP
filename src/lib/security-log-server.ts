import { createAdminClient } from "@/lib/supabase/admin";
import type { SecurityKind } from "@/lib/security-log";

/**
 * Write one line to the security log. SERVER ONLY.
 *
 * **No bloquea, pero ya no calla** (D-NEXT). El contrato de antes era «nunca lanza y nunca
 * bloquea», y la primera mitad sigue siendo correcta por la razón que se escribió entonces: *una
 * línea que falta es un problema más pequeño que un cambio a medio aplicar*. Un restablecimiento
 * de contraseña que ya ocurrió no se deshace porque no se pudiera apuntar.
 *
 * Lo que estaba mal era la segunda mitad. **Un registro que puede fallar en silencio es un
 * registro a medias**: nadie sabe si la ausencia de una línea significa que no pasó nada o que
 * no se pudo escribir, y eso vale para todas las que ya están. Así que ahora devuelve si entró,
 * y deja el motivo en el log del servidor.
 *
 * La excepción, que no cambia: en «entrar como» la regla es **sin fila no hay sesión** (D-243),
 * y esa vive en `impersonation-log.ts` con su propio contrato porque allí la sesión todavía no
 * existe cuando se escribe la fila, así que no hay nada a medio aplicar que proteger.
 */
export async function logSecurity(args: {
  actorId: string | null;
  targetId: string | null;
  targetName: string | null;
  kind: SecurityKind;
  detail?: string | null;
}): Promise<boolean> {
  try {
    const { error } = await createAdminClient().from("security_events").insert({
      actor_id: args.actorId,
      target_id: args.targetId,
      target_name: args.targetName,
      kind: args.kind,
      detail: args.detail ?? null,
    });
    if (error) {
      // Y este camino no existía: `insert()` **no lanza** cuando la base rechaza, devuelve
      // `{ error }`. El `catch` de antes solo cazaba fallos de red, así que un permiso mal
      // puesto o una columna que no cuadra se iban sin dejar nada, ni siquiera en el log.
      console.error(`[security-log] no se pudo apuntar "${args.kind}":`, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[security-log] no se pudo apuntar "${args.kind}":`, e);
    return false;
  }
}
