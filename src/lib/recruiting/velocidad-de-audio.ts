/** Las velocidades de las grabaciones de RingCentral, como en WhatsApp: un botón a la vista que pasa a la siguiente. */
export const VELOCIDADES_DE_AUDIO = [1, 1.5, 2] as const;
export const CLAVE_DE_VELOCIDAD = "rtg_rc_velocidad";

/** La que sigue al pulsar el botón; tras la última vuelve a 1×. Un valor desconocido también vuelve a 1×. */
export function siguienteVelocidad(actual: number): number {
  const i = VELOCIDADES_DE_AUDIO.indexOf(actual as (typeof VELOCIDADES_DE_AUDIO)[number]);
  return VELOCIDADES_DE_AUDIO[(i + 1) % VELOCIDADES_DE_AUDIO.length];
}

/** Lo guardado en el navegador, validado: solo vale una de la lista. */
export function velocidadGuardada(texto: string | null | undefined): number {
  const n = Number(texto);
  return (VELOCIDADES_DE_AUDIO as readonly number[]).includes(n) ? n : 1;
}

/** El rótulo del botón: «1×», «1.5×», «2×». */
export const rotuloDeVelocidad = (v: number): string => `${v}×`;
