/**
 * Quién trabaja AHORA, dentro de la hoja de Nómina (2026-11-25): el nombre de cada persona va en verde si
 * está trabajando y en gris si no, y los que trabajan salen primero. Lógica pura; el conjunto `trabajando`
 * lo arma `idsActivosAhora` (trabajando-ahora-en-nomina.ts).
 */

/** El estado de una persona en la hoja: «si» trabaja ahora, «no» no. Va en `data-trabajando`. */
export type EstadoDeTrabajo = "si" | "no";

/** ¿Está trabajando ahora? Sin dato (conjunto vacío o `undefined`), «no»: el gris es lo seguro. */
export function estadoDeTrabajo(id: string, trabajando: ReadonlySet<string> | undefined): EstadoDeTrabajo {
  return trabajando?.has(id) ? "si" : "no";
}

/**
 * Pone primero a quien trabaja ahora y después al resto. Es estable: dentro de cada grupo queda el orden
 * que traía la lista. `idDe` saca el id de cada elemento (por defecto, el texto mismo o su campo `id`).
 */
export function ordenaTrabajandoPrimero<T>(
  personas: readonly T[],
  trabajando: ReadonlySet<string> | undefined,
  idDe: (p: T) => string = (p) => (typeof p === "string" ? p : (p as unknown as { id: string }).id),
): T[] {
  const si = personas.filter((p) => estadoDeTrabajo(idDe(p), trabajando) === "si");
  const no = personas.filter((p) => estadoDeTrabajo(idDe(p), trabajando) === "no");
  return [...si, ...no];
}
