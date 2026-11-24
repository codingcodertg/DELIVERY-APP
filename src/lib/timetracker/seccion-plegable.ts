/**
 * Cada sección de la bandeja de Pendientes se puede plegar (D-NEXT, ayuda de Roberto,
 * 24 nov 2026: «que cada tabla tenga un desplegable y solo se vea cuando la abro yo»).
 *
 * La decisión de si una sección está abierta tiene dos fuentes, y gana la elección de la
 * persona: si ya abrió o cerró esa sección, se recuerda en el navegador y manda sobre todo lo
 * demás. Si nunca la tocó, manda el valor por defecto: las secciones de pendientes se abren solo
 * si tienen algo pendiente; el historial y las excepciones empiezan cerradas.
 */

/** La clave de localStorage de una sección. Una por sección, para que una no pise a otra. */
export function claveDeEleccion(seccion: string): string {
  return "tt_bandeja_abierta_" + seccion;
}

/**
 * ¿Está abierta? `recordado` = null si la persona nunca la plegó ni la desplegó.
 * `abreConPendientes` marca las secciones que empiezan abiertas cuando hay algo que revisar.
 */
export function seccionAbierta(o: { abreConPendientes: boolean; hayPendientes: boolean; recordado: boolean | null }): boolean {
  if (o.recordado !== null) return o.recordado;
  return o.abreConPendientes && o.hayPendientes;
}

/** Lee la elección guardada. Cualquier cosa que no sea «1» o «0» (o un fallo del almacén) cuenta como sin elección. */
export function leerEleccion(almacen: Pick<Storage, "getItem"> | null, clave: string): boolean | null {
  try {
    const v = almacen?.getItem(clave);
    if (v === "1") return true;
    if (v === "0") return false;
    return null;
  } catch {
    // Navegador con el almacenamiento bloqueado: la sección vuelve a su valor por defecto.
    return null;
  }
}

/** Guarda la elección. Si el almacén no deja escribir, la sección simplemente no lo recuerda. */
export function guardarEleccion(almacen: Pick<Storage, "setItem"> | null, clave: string, abierta: boolean): void {
  try {
    almacen?.setItem(clave, abierta ? "1" : "0");
  } catch {
    // Sin almacenamiento: la elección dura lo que la pantalla.
  }
}
