// ============================================================
// Listas de conteo del Inventario: reglas puras (sin React ni base). Las usan la pantalla, la acción de
// servidor y la semilla del demo, así que van aquí y no repetidas en cada una.
// ============================================================
/** Tope de productos por alta (una búsqueda o «agregar todos»). El servidor lo vuelve a comprobar. */
export const TOPE_DE_ALTA = 200;

export type CantidadLeida = { ok: true; valor: number | null } | { ok: false };

/**
 * La cantidad que escribió la persona. Vacío = «sin contar» (null). Acepta coma o punto decimal (teclado
 * en español). Solo números no negativos y finitos: un «-2» o «3x» no se guarda ni se manda.
 */
export function cantidadDesdeTexto(texto: string): CantidadLeida {
  const limpio = texto.trim().replace(",", ".");
  if (limpio === "") return { ok: true, valor: null };
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(limpio)) return { ok: false };
  const n = Number(limpio);
  if (!Number.isFinite(n) || n > 1e9) return { ok: false };
  return { ok: true, valor: n };
}

/** Diferencia contado − sistema. Sin contar, o sin dato del sistema, no hay diferencia (null). */
export function diferencia(sistema: number | null | undefined, contado: number | null | undefined): number | null {
  if (sistema == null || contado == null) return null;
  // `|| 0` quita el -0 que deja redondear un número negativo muy pequeño.
  return Math.round((Number(contado) - Number(sistema)) * 10000) / 10000 || 0;
}

export type RenglonDeConteo = { counted_qty: number | string | null };

export function resumenDeRenglones(renglones: readonly RenglonDeConteo[]) {
  const contadas = renglones.filter((r) => r.counted_qty !== null && r.counted_qty !== undefined).length;
  return { total: renglones.length, contadas, sinContar: renglones.length - contadas };
}

/** ¿Se puede enviar? Una lista vacía no; una con renglones sin contar tampoco (hay que contarlos o quitarlos). */
export function puedeEnviar(resumen: { total: number; sinContar: number }): { ok: true } | { ok: false; motivo: "vacia" | "sinContar" } {
  if (resumen.total === 0) return { ok: false, motivo: "vacia" };
  if (resumen.sinContar > 0) return { ok: false, motivo: "sinContar" };
  return { ok: true };
}

/** Nombre sugerido para una lista nueva: «Count <tienda> <fecha>». La fecha es la local, AAAA-MM-DD. */
export function nombreDeLista(tienda: string, fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `Count ${tienda} ${y}-${m}-${d}`;
}

/**
 * Qué se agrega con «agregar todos los resultados»: los ids que aún no están en la lista. Si la búsqueda
 * trae más que el tope, no se agrega nada: `excede` lo dice para que la pantalla pida afinar.
 */
export function altaDeResultados(
  total: number,
  ids: readonly number[],
  enLista: ReadonlySet<number>,
): { excede: boolean; nuevos: number[]; yaEnLista: number } {
  if (total > TOPE_DE_ALTA) return { excede: true, nuevos: [], yaEnLista: 0 };
  const nuevos = ids.filter((id) => !enLista.has(id));
  return { excede: false, nuevos, yaEnLista: ids.length - nuevos.length };
}
