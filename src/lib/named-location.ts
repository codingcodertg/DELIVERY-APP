import type { NamedLocation } from "./types";

/**
 * El registro que se guarda al confirmar el formulario de un lugar en Datos: tiendas, puntos de
 * recolección y sitios de entrega (D-261).
 *
 * **Parte del registro anterior, no de cero.** Hasta D-261 el formulario construía un objeto
 * nuevo con nombre y dirección, y solo añadía lo que conocía —la aprobación automática y el pin
 * verificado—. Cualquier otra clave del lugar **se perdía al editarlo**: el primer admin que
 * cambiara la dirección de una tienda le borraba, sin saberlo, lo que otra pantalla o una carga
 * de datos le hubiera puesto. Medido con la prueba de al lado, en rojo, contra una copia literal
 * de aquel código antes de cambiarlo.
 *
 * Así que ahora lo que el formulario no enseña **se conserva**, y lo que sí enseña se sobrescribe.
 */
export function registroDeLugar(
  prev: NamedLocation | undefined,
  draft: NamedLocation,
  /** `directoryCode`: la lista enseña los campos del directorio (código y extensión). Solo tiendas. */
  opts: { autoApprove?: boolean; directoryCode?: boolean },
): NamedLocation {
  const rec: NamedLocation = { ...(prev ?? {}), name: draft.name.trim(), address: draft.address.trim() };

  if (opts.autoApprove) rec.auto_approve = !!draft.auto_approve;

  // El pin verificado vale solo mientras la dirección sea la misma: editarla exige verificar de
  // nuevo. Se BORRA en vez de dejar el de antes, que ya apuntaría a otro sitio.
  const mismoPin = prev && prev.address === rec.address && prev.lat != null && prev.lng != null;
  if (!mismoPin) { delete rec.lat; delete rec.lng; }

  // El código de directorio (D-261): texto corto que varias tiendas pueden compartir. Vacío
  // significa «sin código», y se quita la clave en vez de guardar una cadena vacía, para que el
  // directorio no tenga que distinguir entre «» y ausente.
  if (opts.directoryCode) {
    const code = (draft.directory_code ?? "").trim();
    if (code) rec.directory_code = code;
    else delete rec.directory_code;
    // La extensión de la tienda para el directorio (D-273): misma regla que el código. Vacía quita la
    // clave, y el directorio no enseña extensión.
    const ext = (draft.directory_ext ?? "").trim();
    if (ext) rec.directory_ext = ext;
    else delete rec.directory_ext;
  }

  return rec;
}
