/**
 * El buscador de órdenes con su «✕» para borrar (D-NEXT).
 *
 * El dueño, el 2026-10-14: *«when i search orders it would be easier to have an x to clear instead of having to
 * backspace»*. Lo pinta `components/BuscadorConBorrar.tsx`, el mismo en las tres búsquedas de órdenes: Órdenes,
 * las dos tablas del Gestor y la barra de Almacén.
 */

/** ¿Se enseña la «✕»? Con cualquier texto, también solo espacios: también esos hay que borrarlos a mano. */
export function hayTextoQueBorrar(valor: string | null | undefined): boolean {
  return (valor ?? "").length > 0;
}

/** La etiqueta accesible del botón. */
export const BORRAR_BUSQUEDA = { en: "Clear search", es: "Borrar búsqueda" } as const;

/** Lo que vale la búsqueda después de pulsar la «✕». */
export const BUSQUEDA_VACIA = "";
