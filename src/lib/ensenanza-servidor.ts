import type { Idioma } from "@/lib/idioma";
import { COOKIE_ENSENANZA, fetchDeEnsenanza, valorDeEnsenanza } from "@/lib/ensenanza-general";

/**
 * El modo enseñanza en los clientes de Supabase del SERVIDOR (D-626). Solo lo importan ficheros de servidor.
 *
 * - Los de sesión (`createClient` de `lib/supabase/server` y `lib/erp/supabase/server`, y el de RR. HH.) ya tienen las
 *   cookies de la petición: le pasan el valor a `fetchDeEnsenanzaConValor`.
 * - Los de servicio (`createAdminClient`) se crean sin petición a mano —y también los usan los cron, que no tienen—:
 *   la cookie se pregunta al hacer cada llamada, y sin petición (cron, script) no hay enseñanza.
 */
export function fetchDeEnsenanzaConValor(idioma: Idioma | null) {
  return fetchDeEnsenanza((i, o) => fetch(i, o), () => idioma);
}

export function fetchDeEnsenanzaDeLaPeticion() {
  return fetchDeEnsenanza((i, o) => fetch(i, o), async () => {
    try {
      const { cookies } = await import("next/headers");
      return valorDeEnsenanza((await cookies()).get(COOKIE_ENSENANZA)?.value);
    } catch {
      return null; // fuera de una petición
    }
  });
}
