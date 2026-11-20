/**
 * Operaciones de almacén (19 nov, reunión con Roberto): el orden de las tiendas en las listas. Primero la tienda de quien
 * mira; luego McAllen, Mission, Edinburg, Weslaco y Brownsville (por nombre de tienda); el resto, en orden alfabético.
 * Sin React: lo usa la página al armar el contexto (todas las listas de tiendas salen igual).
 */

/** El orden fijo después de la tienda propia. La comparación es por nombre, sin mayúsculas ni acentos. */
export const ORDEN_PREFERIDO_DE_TIENDAS = ["McAllen", "Mission", "Edinburg", "Weslaco", "Brownsville"] as const;

function clave(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function ordenarTiendas(tiendas: readonly string[], tiendaPropia: string | null | undefined): string[] {
  const unicas = [...new Set(tiendas.map((t) => t.trim()).filter(Boolean))];
  const propia = tiendaPropia ? clave(tiendaPropia) : null;
  const rango = (t: string): number => {
    const k = clave(t);
    if (propia && k === propia) return 0;
    const i = ORDEN_PREFERIDO_DE_TIENDAS.findIndex((p) => clave(p) === k);
    return i >= 0 ? 1 + i : 100;
  };
  return unicas.sort((a, b) => rango(a) - rango(b) || a.localeCompare(b));
}
