/**
 * Las columnas de la HOJA de aprobación de merma (borrador, hoja del grupo e imprimible) a gusto de quien la mira
 * (ayuda de Roberto, 12 nov: «need to be able to select what columns the report will show», en el borrador del grupo).
 * El «#» siempre va. Se guarda por persona en este navegador; lo que se oculta tampoco se imprime.
 */
export type ClaveDeHoja = "folio" | "dia" | "producto" | "danadas" | "perdida" | "motivo" | "rompio" | "reporto";

export const COLUMNAS_DE_HOJA: readonly { key: ClaveDeHoja; en: string; es: string; num?: true }[] = [
  { key: "folio", en: "Folio", es: "Folio" },
  { key: "dia", en: "Date broken", es: "Fecha del daño" },
  { key: "producto", en: "Product", es: "Producto" },
  { key: "danadas", en: "Damaged pcs", es: "Pzas dañadas", num: true },
  { key: "perdida", en: "Loss", es: "Pérdida", num: true },
  { key: "motivo", en: "Reason", es: "Motivo" },
  { key: "rompio", en: "Broken by", es: "Lo rompió" },
  { key: "reporto", en: "Reported by", es: "Lo reportó" },
];

const VALIDAS = new Set<string>(COLUMNAS_DE_HOJA.map((c) => c.key));

/** Limpia lo guardado: solo claves que existen, sin repetir. Lo que no se entiende se ignora (se ve todo). */
export function normalizaOcultasDeHoja(x: unknown): ClaveDeHoja[] {
  if (!Array.isArray(x)) return [];
  return x.filter((k, i, a): k is ClaveDeHoja => typeof k === "string" && VALIDAS.has(k) && a.indexOf(k) === i);
}

export function alternaColumnaDeHoja(ocultas: readonly ClaveDeHoja[], key: ClaveDeHoja): ClaveDeHoja[] {
  return ocultas.includes(key) ? ocultas.filter((k) => k !== key) : [...ocultas, key];
}

/**
 * Para el pie «Total»: cuántas celdas visibles van antes de «Pérdida» (más las fijas de la izquierda que pase quien
 * llama: «#», casilla, fotos) y cuántas después. Si «Pérdida» está oculta, `null`: el total va en su propia fila.
 */
export function tramoDelTotal(ocultas: readonly ClaveDeHoja[], fijasIzquierda: number): { antes: number; despues: number } | null {
  if (ocultas.includes("perdida")) return null;
  const i = COLUMNAS_DE_HOJA.findIndex((c) => c.key === "perdida");
  const antes = COLUMNAS_DE_HOJA.slice(0, i).filter((c) => !ocultas.includes(c.key)).length + fijasIzquierda;
  const despues = COLUMNAS_DE_HOJA.slice(i + 1).filter((c) => !ocultas.includes(c.key)).length;
  return { antes, despues };
}

export const claveDeColumnasDeHoja = (uid: string) => `rtg:merma:hoja:columnas:${uid}`;
