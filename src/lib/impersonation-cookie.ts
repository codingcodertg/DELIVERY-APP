import { IMPERSONACION_MINUTOS } from "@/lib/impersonation";

/**
 * La cookie que guarda la sesión del admin mientras está dentro de otra (D-NEXT).
 *
 * Sin esto, «volver a mi cuenta» pediría la contraseña, y un admin que entra treinta veces al
 * día a mirar bugs acabaría no usándolo o dejando la sesión ajena abierta — que es el fallo
 * peor de los dos.
 *
 * **Por qué no va firmada ni cifrada**, que fue lo primero que quise hacer. Lo que guarda es el
 * refresh token **del propio admin**, en **su propio navegador**, junto a la cookie de sesión
 * que ya tenía. Quien pudiera leer esta podría leer aquella, así que una firma no defiende de
 * nadie nuevo: solo añade un secreto más que nadie rota. Lo que sí defiende es `httpOnly`
 * —el JavaScript de la página no la ve—, `secure`, `sameSite` y que **dure poco**.
 *
 * Y lo que de verdad importa es **borrarla**: al volver, al caducar y al cerrar sesión. Una
 * cookie de retorno que sobrevive a la impersonación es una llave de vuelta a una cuenta de
 * admin esperando en un equipo compartido.
 *
 * **Sin `server-only`, y a propósito**: aquí no hay ningún secreto —son un nombre de cookie, un
 * `JSON.parse` tolerante y cuatro atributos— y el middleware, que corre en el Edge, necesita
 * leer la cookie para el respaldo de la caducidad. Lo que sí lleva `server-only` es lo que toca
 * la llave de servicio (`impersonation-log.ts`) y la bandera.
 */

export const COOKIE_RETORNO = "rtg_impersonation_return";

/** Lo que se guarda: lo mínimo para volver, y cuándo empezó esto. */
export type SesionDeVuelta = {
  /** El refresh token del admin. Con él se restaura su sesión sin contraseña. */
  refresh: string;
  /** Id de Auth del admin, para escribir el rastro del regreso sin volver a preguntar. */
  adminId: string;
  /** Id de la persona en la que se entró, por lo mismo. */
  comoId: string;
  /** Cuándo empezó, en epoch ms. Es lo que hace caducar la impersonación. */
  inicio: number;
};

/** Los ajustes de la cookie, en un sitio, para que los tres usos no se separen. */
export const AJUSTES_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  // Un minuto más que la impersonación: la cookie tiene que seguir viva justo cuando toca
  // usarla para devolver al admin, no morirse en el mismo instante.
  maxAge: (IMPERSONACION_MINUTOS + 1) * 60,
};

/** Serializa lo que se guarda. Texto plano a propósito, por el motivo de arriba. */
export function empaquetar(s: SesionDeVuelta): string {
  return JSON.stringify(s);
}

/**
 * Lee lo guardado con tolerancia: JSON roto, forma rara o campos vacíos devuelven `null`.
 *
 * Cualquier duda es `null`, y `null` significa «no hay vuelta»: entonces el regreso cierra
 * sesión y manda al login normal. Nunca deja al admin atascado dentro de otra identidad, que es
 * la única cosa que este camino no puede hacer.
 */
export function desempaquetar(raw: string | null | undefined): SesionDeVuelta | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SesionDeVuelta> | null;
    if (!v || typeof v !== "object") return null;
    if (typeof v.refresh !== "string" || !v.refresh.trim()) return null;
    if (typeof v.adminId !== "string" || !v.adminId.trim()) return null;
    if (typeof v.comoId !== "string" || !v.comoId.trim()) return null;
    if (typeof v.inicio !== "number" || !Number.isFinite(v.inicio) || v.inicio <= 0) return null;
    return { refresh: v.refresh, adminId: v.adminId, comoId: v.comoId, inicio: v.inicio };
  } catch {
    return null;
  }
}
