/**
 * Un fallo de RED es el que no dejó llegar la petición o no dejó volver la respuesta (el navegador lo dice con
 * `TypeError: Failed to fetch` y parecidos). Un error de la base siempre trae un `code` (42501, PGRST301, 23505...).
 */
const MENSAJES_DE_RED = [
  "failed to fetch",
  "networkerror",
  "network request failed",
  "load failed",
  "fetch failed",
  "the network connection was lost",
  "timeout",
  "timed out",
  "aborted",
];

/** ¿Este error es de RED (la petición no llegó o no volvió), y no una respuesta de la base? */
export function esFalloDeRed(error: { message?: string | null; code?: string | null; status?: number | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code) return false;
  const mensaje = (error.message ?? "").toLowerCase();
  return MENSAJES_DE_RED.some((texto) => mensaje.includes(texto));
}

/** Las esperas entre intentos, en ms. Tres intentos en total. */
export const ESPERAS_DE_REINTENTO_MS: readonly number[] = [400, 1200];

/**
 * Corre `escribe` y, mientras su resultado traiga un fallo de RED, espera y lo repite (como mucho `esperas.length` veces más).
 * Un error que NO es de red (permiso, regla de la base) no se repite: se devuelve tal cual. Nunca lanza: si `escribe` lanza,
 * eso cuenta como fallo de red con ese mensaje.
 */
export async function conReintentosDeRed<T extends { error: { message: string; code?: string | null } | null }>(
  escribe: () => PromiseLike<T>,
  opciones: { esperas?: readonly number[]; espera?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const esperas = opciones.esperas ?? ESPERAS_DE_REINTENTO_MS;
  const espera = opciones.espera ?? ((ms: number) => new Promise<void>((resuelve) => setTimeout(resuelve, ms)));
  for (let intento = 0; ; intento++) {
    let resultado: T;
    let deRed: boolean;
    try {
      resultado = await escribe();
      deRed = esFalloDeRed(resultado.error);
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      resultado = { error: { message: mensaje } } as unknown as T;
      deRed = true;
    }
    if (!deRed || intento >= esperas.length) return resultado;
    await espera(esperas[intento]);
  }
}
