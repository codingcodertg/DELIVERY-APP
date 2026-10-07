import { isPublicPath, type Decision } from "@/lib/route-guard";
import { safeNext } from "@/lib/auth-redirect";

/**
 * Cambiar la contraseña al entrar, obligatorio (D-486).
 *
 * El dueño, 2026-10-06: «ellos tienen su username, pero no tienen email … quiero que me le hagas un
 * password genérico … que sea tracker … Ellos lo van a tener que cambiar cuando hagan first login».
 *
 * **La marca** vive en `auth.users.raw_user_meta_data.must_change_password` (lo que Supabase expone
 * como `user.user_metadata`). Sin migración: es un dato de la cuenta de entrar, no del perfil, y la
 * pone quien da una contraseña que no eligió la persona — el orquestador a mano para los tres
 * choferes, y desde ahora `/api/reset-password` cada vez que un admin pulsa «Poner contraseña nueva».
 *
 * **Lo que esta marca NO es: una barrera contra la propia persona.** `user_metadata` lo puede
 * escribir el propio usuario (`auth.updateUser({ data })`) desde la consola del navegador. Lo que
 * protege es lo de siempre: que nadie siga entrando con una contraseña que conoce media oficina.
 * Quien se salta la pantalla a mano solo se queda con `tracker`, que es justo lo que no le conviene.
 *
 * Aquí vive lo que se decide sin red —quién va a la pantalla, qué contraseña se acepta, qué se dice—
 * para que el middleware, la pantalla y la ruta API no puedan decidir cosas distintas.
 */

/** La pantalla. Inglés, como `/reset-password` y `/no-access`. */
export const RUTA_CAMBIO_OBLIGATORIO = "/change-password";

/** El nombre de la marca en `user_metadata`. */
export const MARCA_CAMBIO = "must_change_password";

/** Lo que se escribe en `user_metadata` para poner la marca (y para quitarla). */
export const PONER_MARCA = { [MARCA_CAMBIO]: true } as const;
export const QUITAR_MARCA = { [MARCA_CAMBIO]: false } as const;

/** La contraseña genérica que se repartió. La nueva no puede contenerla. */
export const CONTRASENA_TEMPORAL = "tracker";

/**
 * 8 y no los 6 de «Mi perfil»: esta es la que se queda para siempre una cuenta que hasta hoy
 * tenía una que sabía todo el mundo. Supabase puede exigir más; si lo hace, se dice por qué.
 */
export const MIN_CONTRASENA_NUEVA = 8;

/** ¿Tiene la marca? Solo `true` cuenta: un texto `"true"` o cualquier otra cosa no obliga a nada. */
export function debeCambiarContrasena(user: { user_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return user?.user_metadata?.[MARCA_CAMBIO] === true;
}

/**
 * ¿Se deja pasar esta navegación, o va a la pantalla de cambiar la contraseña?
 *
 * Pasa: quien no tiene la marca; un admin dentro de la sesión de otra persona con «Entrar como»
 * (D-243), que no sabe ni tiene por qué elegir la contraseña de nadie —ve un aviso en el banner—;
 * la propia pantalla; y lo público (`/login`, `/auth/signout`, el seguimiento del cliente…), entre
 * ello la salida, para que nadie quede encerrado. Las rutas `/api/` ni llegan aquí: el middleware
 * las salta, y cada una se autentica sola.
 */
export function decideCambioObligatorio(a: {
  pathWithSearch: string;
  debeCambiar: boolean;
  suplantando: boolean;
}): Decision {
  if (!a.debeCambiar || a.suplantando) return { kind: "next" };
  const q = a.pathWithSearch.indexOf("?");
  const path = q === -1 ? a.pathWithSearch : a.pathWithSearch.slice(0, q);
  if (path === RUTA_CAMBIO_OBLIGATORIO || path.startsWith(RUTA_CAMBIO_OBLIGATORIO + "/")) return { kind: "next" };
  if (isPublicPath(path)) return { kind: "next" };
  return { kind: "redirect", to: `${RUTA_CAMBIO_OBLIGATORIO}?next=${encodeURIComponent(a.pathWithSearch)}` };
}

/**
 * A dónde va después de cambiarla. `/home` por defecto, que manda a cada uno a su inicio —al
 * chofer, a «Mi ruta» (D-173)—. Un `next` que apunte a la propia pantalla sería un bucle.
 */
export function destinoTrasCambio(next: string | null | undefined): string {
  const d = safeNext(next, "/home");
  if (d === RUTA_CAMBIO_OBLIGATORIO || d.startsWith(RUTA_CAMBIO_OBLIGATORIO + "/") || d.startsWith(RUTA_CAMBIO_OBLIGATORIO + "?")) {
    return "/home";
  }
  return d;
}

export type CodigoCambioObligatorio =
  | "temporal"
  | "corta"
  | "no_coinciden"
  // Los del servidor:
  | "no_hace_falta"
  | "suplantando";

/**
 * ¿Se puede mandar? Devuelve el primer problema o `null`. `confirmacion` es de la pantalla: el
 * servidor no la recibe.
 *
 * «temporal» va primero: quien escribe `tracker` tiene que leer que esa no vale, no que es corta.
 */
export function validaNuevaObligatoria(a: { nueva: string; confirmacion?: string }): CodigoCambioObligatorio | null {
  if (a.nueva.toLowerCase().includes(CONTRASENA_TEMPORAL)) return "temporal";
  if (a.nueva.length < MIN_CONTRASENA_NUEVA) return "corta";
  if (a.confirmacion !== undefined && a.confirmacion !== a.nueva) return "no_coinciden";
  return null;
}

export function mensajeCambioObligatorio(codigo: CodigoCambioObligatorio, t: (en: string, es: string) => string): string {
  switch (codigo) {
    case "temporal":
      return t(
        `Your new password can't contain the temporary one ("${CONTRASENA_TEMPORAL}").`,
        `La nueva contraseña no puede llevar la temporal («${CONTRASENA_TEMPORAL}»).`,
      );
    case "corta":
      return t(
        `Use at least ${MIN_CONTRASENA_NUEVA} characters.`,
        `Usa al menos ${MIN_CONTRASENA_NUEVA} caracteres.`,
      );
    case "no_coinciden":
      return t("The two passwords don't match.", "Las dos contraseñas no coinciden.");
    case "no_hace_falta":
      return t("Your password was already changed. Continue to the app.", "Tu contraseña ya estaba cambiada. Sigue a la app.");
    case "suplantando":
      return t(
        "You're signed in as someone else: their password is theirs to choose.",
        "Estás dentro como otra persona: su contraseña la elige ella.",
      );
  }
}
