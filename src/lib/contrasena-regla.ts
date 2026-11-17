/**
 * La regla de contraseña del hub, en un sitio que puede leer tanto el servidor como la pantalla (sin red, sin
 * `node:crypto`). Supabase Auth exige ahora mínimo 10 caracteres, con letras Y dígitos, y rechaza las contraseñas
 * filtradas. Aquí se dice lo que la app comprueba antes de mandar; lo que Supabase rechace después se traduce en
 * `profile-password.ts`.
 */

/** Mínimo de caracteres. Lo que exige el proyecto de Supabase desde el cambio de política. */
export const MIN_CONTRASENA = 10;

export type FalloDeRegla = "corta" | "sin_letra" | "sin_digito";

/** El primer incumplimiento de la regla, o `null` si la contraseña la cumple. */
export function falloDeRegla(pw: string): FalloDeRegla | null {
  if (pw.length < MIN_CONTRASENA) return "corta";
  if (!/\p{L}/u.test(pw)) return "sin_letra";
  if (!/\d/.test(pw)) return "sin_digito";
  return null;
}

/** El texto de la regla, en los dos idiomas. Se enseña siempre, antes de escribir. */
export function reglaTexto(t: (en: string, es: string) => string): string {
  return t(
    `At least ${MIN_CONTRASENA} characters, with letters and numbers.`,
    `Al menos ${MIN_CONTRASENA} caracteres, con letras y números.`,
  );
}

/** Lo que falta, en los dos idiomas. */
export function mensajeDeRegla(fallo: FalloDeRegla, t: (en: string, es: string) => string): string {
  switch (fallo) {
    case "corta":
      return t(`Use at least ${MIN_CONTRASENA} characters.`, `Usa al menos ${MIN_CONTRASENA} caracteres.`);
    case "sin_letra":
      return t("Add at least one letter.", "Añade al menos una letra.");
    case "sin_digito":
      return t("Add at least one number.", "Añade al menos un número.");
  }
}
