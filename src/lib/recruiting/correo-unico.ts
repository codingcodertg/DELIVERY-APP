/**
 * Correo de trabajo único (D-688, arreglo de contratación).
 *
 * Lo puro para decidir si un correo ya está en uso por otra persona, y el aviso bilingüe que se enseña. Se prueba sin
 * base: el servidor solo trae las filas (perfiles y expedientes) y aquí se decide. Así «Contratar» y «Guardar datos»
 * no dejan dos personas con el mismo correo de acceso (lo de Maricella, duplicada por dar clic dos veces).
 */

/** En minúsculas y sin espacios alrededor, para comparar correos como iguales aunque se escriban distinto. */
export function normalizaCorreo(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** Un correo con forma de correo. El mismo patrón que usa /api/invite y la precarga de contratación. */
export function esCorreoValido(email: string | null | undefined): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizaCorreo(email));
}

export type DuenoDeCorreo = { id: string; nombre: string };

/**
 * El primer registro cuyo correo coincide con `email`, ignorando los ids de `exceptIds` (el propio perfil/expediente
 * que se está guardando). Cada fila trae sus correos posibles (de acceso, de contacto, personal…) y basta con que uno
 * coincida. Devuelve quién lo tiene, o `null` si está libre.
 */
export function duenoDelCorreo(
  email: string | null | undefined,
  filas: { id: string; nombre: string | null | undefined; correos: (string | null | undefined)[] }[],
  exceptIds: (string | null | undefined)[] = [],
): DuenoDeCorreo | null {
  const buscado = normalizaCorreo(email);
  if (!buscado) return null;
  const excluir = new Set(exceptIds.filter(Boolean) as string[]);
  for (const fila of filas) {
    if (excluir.has(fila.id)) continue;
    if (fila.correos.some((c) => normalizaCorreo(c) === buscado)) {
      return { id: fila.id, nombre: (fila.nombre ?? "").trim() || "—" };
    }
  }
  return null;
}

/** El aviso de «ese correo ya está en uso por <nombre>», en los dos idiomas, para `t(...)`. */
export function mensajeCorreoEnUso(nombre: string | null | undefined): { en: string; es: string } {
  const limpio = (nombre ?? "").trim();
  return {
    en: `That email is already used by ${limpio || "someone else"}`,
    es: `Ese correo ya está en uso por ${limpio || "otra persona"}`,
  };
}
