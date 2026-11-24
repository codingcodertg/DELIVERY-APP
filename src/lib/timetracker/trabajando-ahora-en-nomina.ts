/**
 * La sección «🟢 Trabajando ahora» dentro de Nómina (2026-11-24). Plegada por defecto.
 *
 * Quién manda, de más a menos:
 *   1. `?vista=ahora` en la URL: abre la sección (lo que mandan las notificaciones y los marcadores
 *      de la antigua pestaña). Vale hasta que la persona la pliegue o despliegue a mano.
 *   2. La última elección de la persona, recordada en el navegador.
 *   3. Cerrada.
 */

/** La clave de localStorage. Valores «1» (abierta) o «0» (cerrada). */
export const CLAVE_AHORA_ABIERTA = "tt_nomina_ahora_abierta";

/** ¿Está abierta? `porUrl` = la URL trae `?vista=ahora`; `recordado` = null si nunca se eligió. */
export function ahoraEstaAbierta(o: { porUrl: boolean; recordado: boolean | null }): boolean {
  if (o.porUrl) return true;
  return o.recordado === true;
}

/** Lee la elección guardada. Cualquier cosa que no sea «1» o «0», o un fallo del almacén, cuenta como sin elección. */
export function leerAhoraAbierta(almacen: Pick<Storage, "getItem"> | null): boolean | null {
  try {
    const v = almacen?.getItem(CLAVE_AHORA_ABIERTA);
    if (v === "1") return true;
    if (v === "0") return false;
    return null;
  } catch {
    return null;
  }
}

/** Guarda la elección. Si el almacén no deja escribir, no se recuerda y ya. */
export function guardarAhoraAbierta(almacen: Pick<Storage, "setItem"> | null, abierta: boolean): void {
  try {
    almacen?.setItem(CLAVE_AHORA_ABIERTA, abierta ? "1" : "0");
  } catch {
    // Sin almacenamiento: la elección dura lo que la pantalla.
  }
}
