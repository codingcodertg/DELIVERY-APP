/**
 * Las secciones plegadas de Nómina (2026-11-24). Cuatro, todas con la misma forma:
 *   - «🟢 Trabajando ahora» (`ahora`): era la pestaña de siempre; se consolidó aquí ese mismo día.
 *   - «📷 Fotos de fichaje» (`fotos`), «⚠️ Excepciones» (`excepciones`) y «🖥 Capturas de escritorio»
 *     (`capturas`): salieron de Auditoría (ayuda de Roberto: «could probably be consolidated into
 *     payroll app»). Cada una conserva su propio selector de persona.
 *
 * Quién manda, de más a menos:
 *   1. `?vista=<sección>` en la URL: abre esa sección (lo que mandan las notificaciones y los
 *      enlaces viejos). Vale hasta que la persona la pliegue o despliegue a mano.
 *   2. La última elección de la persona en esa sección, recordada en el navegador.
 *   3. Cerrada.
 */

/** Las secciones que se pueden abrir por URL. El orden es el de la pantalla, de arriba abajo. */
export const SECCIONES_DE_NOMINA = ["ahora", "fotos", "excepciones", "capturas"] as const;
export type SeccionDeNomina = (typeof SECCIONES_DE_NOMINA)[number];

/** Las claves de localStorage. Valores «1» (abierta) o «0» (cerrada). */
export const CLAVES_SECCION_DE_NOMINA: Record<SeccionDeNomina, string> = {
  ahora: "tt_nomina_ahora_abierta",
  fotos: "tt_nomina_fotos_abierta",
  excepciones: "tt_nomina_excepciones_abierta",
  capturas: "tt_nomina_capturas_abierta",
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
