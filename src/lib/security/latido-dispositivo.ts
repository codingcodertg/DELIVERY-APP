/**
 * Cada cuánto un aparato le dice a Seguridad «sigo aquí» (D-1004, aviso de Supabase «running out of Disk IO Budget»,
 * 12 nov). Cada aviso son dos UPDATE (security_devices + security_device_users, ~22 000 cada una): antes cada 2 min y
 * en CADA cambio de ruta; ahora cada 5 min, y al cambiar de ruta solo si pasó 1 min desde el último. «En vivo» en
 * Seguridad usa una ventana de 60 min (vivo-de-usuarios.ts), así que sigue igual; los puntos por app (289) van por días.
 */
export const LATIDO_DISPOSITIVO_MS = 5 * 60_000;
export const MIN_ENTRE_RUTAS_MS = 60_000;

/** ¿Avisar ahora? `porRuta` = lo dispara un cambio de ruta (con su mínimo); si no, es el reloj de 5 min. */
export function tocaAvisar(ultimoMs: number | null, ahoraMs: number, porRuta: boolean): boolean {
  if (ultimoMs === null || ahoraMs < ultimoMs) return true;
  return ahoraMs - ultimoMs >= (porRuta ? MIN_ENTRE_RUTAS_MS : LATIDO_DISPOSITIVO_MS);
}
