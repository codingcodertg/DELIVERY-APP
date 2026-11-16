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

/**
 * El último «sigo aquí» que mandó CUALQUIER pestaña de este navegador. Sin esto, cada pestaña abierta avisaba por su
 * cuenta: el mismo aparato, dos UPDATE cada una cada cinco minutos. Con la clave compartida, la primera que avisa
 * manda y las demás ven el aviso reciente y se callan. Una carrera exacta entre dos pestañas puede colar un aviso de
 * más; no es un bloqueo, es coalescencia.
 */
export const CLAVE_ULTIMO_LATIDO = "rtg-latido-dispositivo-ultimo";

/** La marca guardada, o null si no hay ninguna o el almacenamiento no está (modo privado, bloqueado). */
export function ultimoLatidoGuardado(storage: Pick<Storage, "getItem"> | null | undefined): number | null {
  try {
    const v = storage?.getItem(CLAVE_ULTIMO_LATIDO);
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Anota el último aviso para las demás pestañas. Sin almacenamiento no pasa nada: cada pestaña avisa como antes. */
export function guardaUltimoLatido(storage: Pick<Storage, "setItem"> | null | undefined, ahoraMs: number): void {
  try { storage?.setItem(CLAVE_ULTIMO_LATIDO, String(ahoraMs)); } catch { /* sin almacenamiento: ver arriba */ }
}

/** El más reciente de dos marcas, ignorando las que no hay. */
export function ultimaMarca(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}
