/**
 * Cambiar la contraseña desde «Mi perfil» (D-NEXT): la única pantalla que lo hace.
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
  | "no_guardada";

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
export function mensajeDeContrasena(codigo: CodigoContrasena, t: (en: string, es: string) => string): string {
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
    case "no_guardada":
      return t("The password could not be saved. Try again.", "No se pudo guardar la contraseña. Inténtalo otra vez.");
  }
}
