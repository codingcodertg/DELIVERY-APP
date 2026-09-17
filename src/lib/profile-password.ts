/**
 * Cambiar la contraseña desde «Mi perfil» (D-265): la única pantalla que lo hace.
 *
 * Una sola cuenta y una sola contraseña valen para todas las apps del hub, así que hay un solo
 * sitio para cambiarla. Aquí vive lo que se decide sin red: qué se acepta y con qué código se
 * contesta. La ruta `POST /api/profile/password` y el formulario usan esto mismo, para que la
 * pantalla y el servidor no puedan exigir cosas distintas.
 */

/** Lo mismo que pedían los tres formularios que había (Entregas, RR. HH. y Time Tracker). */
export const MIN_CONTRASENA = 6;

export type CodigoContrasena =
  | "falta_actual"
  | "corta"
  | "no_coinciden"
  | "actual_incorrecta"
  | "sin_correo"
  // Supabase rechazó la nueva y dijo por qué (D-271): antes los dos acababan en «no_guardada».
  | "misma_contrasena"
  | "debil"
  | "no_guardada";

/** Por qué Supabase da una contraseña por débil, con los nombres que usa la propia librería. */
export type MotivoDebil = "length" | "characters" | "pwned";

/**
 * El código con el que se contesta cuando Supabase NO guarda la nueva contraseña (D-271).
 *
 * Hasta aquí todo fallo acababa en «no_guardada», cuyo texto es «inténtalo otra vez». Y eso es falso
 * justo en los casos que más pasan: una contraseña igual a la anterior, o más débil de lo que exige el
 * proyecto de Supabase, que puede pedir más de los 6 caracteres que pide la app. Volver a intentarlo
 * con la misma contraseña da el mismo rechazo, así que la persona solo puede leer «no me deja».
 *
 * Se lee `code` y `reasons`, que es como los entrega `auth-js` 2.112.4: `same_password` en un error
 * de API, y `weak_password` en un error de contraseña débil con su lista de razones.
 */
export function codigoDeFalloAlGuardar(error: unknown): { codigo: CodigoContrasena; motivos?: MotivoDebil[] } {
  const e = (error ?? {}) as { code?: unknown; reasons?: unknown };
  if (e.code === "same_password") return { codigo: "misma_contrasena" };
  if (e.code === "weak_password") {
    const validos: MotivoDebil[] = ["length", "characters", "pwned"];
    const motivos = Array.isArray(e.reasons) ? e.reasons.filter((r): r is MotivoDebil => validos.includes(r as MotivoDebil)) : [];
    return { codigo: "debil", motivos };
  }
  return { codigo: "no_guardada" };
}

/**
 * ¿Se puede mandar? Devuelve el primer problema o `null`.
 *
 * `confirmacion` es opcional porque el servidor no la recibe: repetir la contraseña es una ayuda
 * de pantalla contra un error de dedo, no una barrera.
 */
export function validaCambioDeContrasena(a: {
  actual: string;
  nueva: string;
  confirmacion?: string;
}): CodigoContrasena | null {
  if (!a.actual) return "falta_actual";
  if (a.nueva.length < MIN_CONTRASENA) return "corta";
  if (a.confirmacion !== undefined && a.confirmacion !== a.nueva) return "no_coinciden";
  return null;
}

/** El texto de cada código, en los dos idiomas. */
export function mensajeDeContrasena(
  codigo: CodigoContrasena,
  t: (en: string, es: string) => string,
  motivos: MotivoDebil[] = [],
): string {
  switch (codigo) {
    case "falta_actual":
      return t("Enter your current password.", "Escribe tu contraseña actual.");
    case "corta":
      return t(
        `The new password must be at least ${MIN_CONTRASENA} characters.`,
        `La nueva contraseña debe tener al menos ${MIN_CONTRASENA} caracteres.`,
      );
    case "no_coinciden":
      return t("The new passwords don't match.", "Las contraseñas nuevas no coinciden.");
    case "actual_incorrecta":
      return t("Your current password is incorrect.", "La contraseña actual es incorrecta.");
    case "sin_correo":
      return t("This account can't change its password here. Ask an admin.", "Esta cuenta no puede cambiar su contraseña aquí. Pídeselo a un admin.");
    case "misma_contrasena":
      return t("The new password is the same as the current one. Choose a different one.", "La nueva contraseña es igual a la actual. Elige una distinta.");
    case "debil": {
      // Cada motivo dice qué cambiar, no solo que falló.
      const partes = motivos.map((m) =>
        m === "length" ? t("it is too short for this system", "es demasiado corta para este sistema")
          : m === "characters" ? t("it needs a mix of letters, numbers and symbols", "necesita mezclar letras, números y símbolos")
            : t("it appears in a list of leaked passwords", "aparece en una lista de contraseñas filtradas"),
      );
      return partes.length
        ? t(`That password is too weak: ${partes.join("; ")}.`, `Esa contraseña es demasiado débil: ${partes.join("; ")}.`)
        : t("That password is too weak. Try a longer one with letters, numbers and symbols.", "Esa contraseña es demasiado débil. Prueba una más larga, con letras, números y símbolos.");
    }
    case "no_guardada":
      return t("The password could not be saved. Try again.", "No se pudo guardar la contraseña. Inténtalo otra vez.");
  }
}
