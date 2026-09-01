/**
 * ¿Este fallo es el del bundle viejo? (D-155)
 *
 * Cuando se despliega, los ficheros de JavaScript cambian de nombre (llevan un hash). Una
 * pestaña abierta desde antes tiene el HTML viejo, que pide un fichero que ya no existe — y lo
 * que se ve es un error cualquiera al pintar, muchas veces de la forma "cannot read properties
 * of undefined (reading 'length')". No hay nada roto en el código: hay media aplicación nueva y
 * media vieja en la misma pestaña, y por eso **recargar lo arregla siempre**.
 *
 * Se reconoce por el mensaje. No es elegante, pero el navegador no da otra cosa: no hay código
 * de error y cada motor lo redacta a su manera. De ahí que la lista tenga su propia prueba —
 * es una lista de cadenas, y una lista de cadenas solo la defiende un test.
 *
 * Vive aparte del `ErrorBoundary` por dos motivos: es una función pura sin nada de React, y el
 * test no puede importar un `.tsx`.
 */
export function isStaleChunkError(e: { name?: string; message?: string } | null | undefined): boolean {
  const m = `${e?.name ?? ""} ${e?.message ?? ""}`.toLowerCase();
  if (!m.trim()) return false;
  return m.includes("chunkloaderror")
    || m.includes("loading chunk")
    || m.includes("loading css chunk")
    || m.includes("dynamically imported module")
    || m.includes("importing a module script failed");
}

export const STALE_CHUNK_RELOAD_KEY = "rdz.chunk-reload";

/** Cuánto tiene que pasar para volver a permitir una recarga automática. */
export const STALE_CHUNK_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * ¿Se puede recargar sola la página, o ya se intentó hace nada?
 *
 * La primera versión guardaba un simple "ya recargué", y estaba mal en los dos sentidos:
 *
 *   · **Se quedaba corta.** Aquí se despliega varias veces al día. Una pestaña que lleva
 *     abierta desde la mañana se recuperaría del primer despliegue y de ninguno más.
 *   · **Y aun así podía dar un bucle**, si se limpiaba la marca al montar: montar, limpiar,
 *     reventar, recargar, montar…
 *
 * Con la HORA de la última recarga las dos cosas se arreglan a la vez: se recarga otra vez
 * cuando ha pasado un rato —o sea, cuando es otro despliegue— y nunca dos veces seguidas,
 * que es cuando el fallo no era el bundle viejo.
 *
 * `sessionStorage` puede lanzar (modo privado, cookies bloqueadas); si no se puede leer se
 * permite la recarga, porque el caso normal es el bueno y una recarga de más no rompe nada.
 */
export function canAutoReload(now: number = Date.now()): boolean {
  try {
    const previa = Number(sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) ?? 0);
    return !previa || now - previa > STALE_CHUNK_COOLDOWN_MS;
  } catch {
    return true;
  }
}

/** Deja constancia de que se recarga ahora. Si el almacén no deja escribir, se recarga igual. */
export function markAutoReload(now: number = Date.now()): void {
  try { sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(now)); } catch { /* da igual */ }
}
