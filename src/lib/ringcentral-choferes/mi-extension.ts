/** D-1212: el nombre como clave (sin acentos, mayúsculas ni espacios de más). */
const clave = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

/** La extensión de la persona en la lista de choferes de RingCentral, emparejada por nombre completo; `null` si no está. */
export function extensionDeLaPersona(nombre: string, filas: readonly { extension_number: string | null; name: string | null }[]): string | null {
  const k = clave(nombre);
  if (!k) return null;
  const f = filas.find((x) => clave(x.name) === k);
  return f?.extension_number ? String(f.extension_number) : null;
}
