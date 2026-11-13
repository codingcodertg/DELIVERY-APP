/**
 * EL ESTÁNDAR DE TABLAS de RTG Hub (dueño, 12 nov 2026: «en toda la app las columnas… el mismo estilo que Deliveries»).
 * Reglas PURAS (sin React) de lo que cada persona guarda de una tabla: qué columnas ve y en qué orden.
 * El componente es `src/components/TablaEstandar.tsx`; la guía, `docs/ESTANDAR-DE-TABLAS.md`.
 */
export interface VistaDeTabla { orden: string[]; ocultas: string[] }

/** Lo guardado, limpio: sin claves que ya no existen ni repetidas; las columnas nuevas entran al final. */
export function ordenLimpio(guardado: unknown, claves: readonly string[]): string[] {
  const lista = Array.isArray(guardado) ? guardado.filter((k): k is string => typeof k === "string") : [];
  const orden = lista.filter((k, i) => claves.includes(k) && lista.indexOf(k) === i);
  for (const k of claves) if (!orden.includes(k)) orden.push(k);
  return orden;
}

/**
 * La vista de una persona a partir de lo guardado. Sin nada guardado: todas en su orden, menos las `ocultasDeEntrada`.
 * Una columna `fija` nunca queda oculta. Una columna nueva (que lo guardado no conocía) nace visible salvo que sea
 * de las ocultas de entrada.
 */
export function vistaLimpia(guardado: unknown, claves: readonly string[], fijas: readonly string[] = [], ocultasDeEntrada: readonly string[] = []): VistaDeTabla {
  const g = (guardado && typeof guardado === "object" ? guardado : {}) as { orden?: unknown; ocultas?: unknown; conocidas?: unknown };
  const conocidas = Array.isArray(g.conocidas) ? g.conocidas.filter((k): k is string => typeof k === "string") : null;
  const guardadas = Array.isArray(g.ocultas) ? g.ocultas.filter((k): k is string => typeof k === "string") : null;
  const ocultas = new Set<string>();
  for (const k of claves) {
    if (fijas.includes(k)) continue;
    const nueva = !conocidas || !conocidas.includes(k);
    if (guardadas && !nueva ? guardadas.includes(k) : ocultasDeEntrada.includes(k)) ocultas.add(k);
  }
  return { orden: ordenLimpio(g.orden, claves), ocultas: [...ocultas] };
}

/** Soltar `desde` sobre `sobre`: queda en el lugar de `sobre` (igual que en Órdenes). */
export function sueltaEnOrden(orden: readonly string[], desde: string, sobre: string): string[] {
  const i = orden.indexOf(desde), j = orden.indexOf(sobre);
  if (desde === sobre || i < 0 || j < 0) return [...orden];
  const sin = orden.filter((k) => k !== desde);
  sin.splice(sin.indexOf(sobre) + (i < j ? 1 : 0), 0, desde);
  return sin;
}

/** Las flechas ↑ ↓ del ⚙ Columnas: un lugar arriba o abajo; en los extremos no se mueve. */
export function mueveEnOrden(orden: readonly string[], clave: string, delta: -1 | 1): string[] {
  const i = orden.indexOf(clave), j = i + delta;
  if (i < 0 || j < 0 || j >= orden.length) return [...orden];
  const n = [...orden];
  [n[i], n[j]] = [n[j], n[i]];
  return n;
}

export const claveDeVista = (id: string) => `rtg:tabla:${id}:vista`;
export const claveDeAnchos = (id: string) => `rtg:tabla:${id}:anchos`;

/**
 * La casilla de «todas» de una tabla con selección (`TablaEstandar`, prop `seleccion`): si todas las filas que la tabla
 * lista ahora ya están marcadas, la quita (vacía); si no, marca esas. Igual que la cola de revisión del ERP desde siempre.
 */
export function alternaTodas(clavesListadas: readonly string[], marcadas: ReadonlySet<string>): Set<string> {
  const todas = clavesListadas.length > 0 && clavesListadas.every((k) => marcadas.has(k));
  return todas ? new Set() : new Set(clavesListadas);
}
