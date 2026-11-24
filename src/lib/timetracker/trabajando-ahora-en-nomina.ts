/**
 * Las secciones plegadas de Nómina. Desde 2026-11-24 queda una sola: «🟢 Trabajando ahora» (`ahora`),
 * que era la pestaña de siempre. Las de fotos de fichaje, excepciones y capturas de escritorio salieron
 * de Nómina ese mismo día (decisión del dueño), así que ya no se pueden abrir por URL ni guardar.
 *
 * Quién manda, de más a menos:
 *   1. `?vista=<sección>` en la URL: abre esa sección. Vale hasta que la persona la pliegue o despliegue a mano.
 *   2. La última elección de la persona en esa sección, recordada en el navegador.
 *   3. Cerrada.
 */

/** Las secciones que se pueden abrir por URL. */
export const SECCIONES_DE_NOMINA = ["ahora"] as const;
export type SeccionDeNomina = (typeof SECCIONES_DE_NOMINA)[number];

/** Las claves de localStorage. Valores «1» (abierta) o «0» (cerrada). */
export const CLAVES_SECCION_DE_NOMINA: Record<SeccionDeNomina, string> = {
  ahora: "tt_nomina_ahora_abierta",
};

/** La clave de «Trabajando ahora», con el nombre que ya tenía. */
export const CLAVE_AHORA_ABIERTA = CLAVES_SECCION_DE_NOMINA.ahora;

/** La sección que pide la URL (`?vista=…`), o null si no pide ninguna válida. */
export function seccionPorUrl(vista: string | null | undefined): SeccionDeNomina | null {
  return (SECCIONES_DE_NOMINA as readonly string[]).includes(vista ?? "") ? (vista as SeccionDeNomina) : null;
}

/** ¿Está abierta? `porUrl` = la URL pide esta sección; `recordado` = null si nunca se eligió. */
export function seccionEstaAbierta(o: { porUrl: boolean; recordado: boolean | null }): boolean {
  if (o.porUrl) return true;
  return o.recordado === true;
}

/**
 * Lo que la pantalla enseña: la elección de esta visita (`elegida`, null si aún no la hubo) pesa más
 * que todo lo demás; sin ella, manda `seccionEstaAbierta`.
 */
export function seccionAbierta(o: { elegida: boolean | null; porUrl: boolean; recordado: boolean | null }): boolean {
  return o.elegida ?? seccionEstaAbierta(o);
}

/** Lo mismo para «Trabajando ahora», con el nombre de antes. */
export const ahoraEstaAbierta = seccionEstaAbierta;

/** Lee la elección guardada de una sección. Cualquier cosa que no sea «1» o «0», o un fallo del almacén, cuenta como sin elección. */
export function leerSeccionAbierta(almacen: Pick<Storage, "getItem"> | null, seccion: SeccionDeNomina): boolean | null {
  try {
    const v = almacen?.getItem(CLAVES_SECCION_DE_NOMINA[seccion]);
    if (v === "1") return true;
    if (v === "0") return false;
    return null;
  } catch {
    return null;
  }
}

/** Guarda la elección de una sección. Si el almacén no deja escribir, no se recuerda y ya. */
export function guardarSeccionAbierta(almacen: Pick<Storage, "setItem"> | null, seccion: SeccionDeNomina, abierta: boolean): void {
  try {
    almacen?.setItem(CLAVES_SECCION_DE_NOMINA[seccion], abierta ? "1" : "0");
  } catch {
    // Sin almacenamiento: la elección dura lo que la pantalla.
  }
}

/** Lo de siempre para «Trabajando ahora». */
export const leerAhoraAbierta = (almacen: Pick<Storage, "getItem"> | null): boolean | null => leerSeccionAbierta(almacen, "ahora");

/** Lo de siempre para «Trabajando ahora». */
export const guardarAhoraAbierta = (almacen: Pick<Storage, "setItem"> | null, abierta: boolean): void => guardarSeccionAbierta(almacen, "ahora", abierta);
